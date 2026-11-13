// クラウド同期（Web版 js/sync.js と同じしくみ・同じ保存形式）
//
// 保存先：Firebase（Google）の Cloud Firestore。REST API を使う。
//   shops/{ログインしたお店のユーザーID}/records/{種類~ID}
//     col: データの種類, id, d: 内容(JSON文字列), del: 削除済みか, dev: 送った端末, _u: サーバーが受け取った時刻
// 動き：
//   - この端末での変更は「送信待ち」に入れ、まとめて送る
//   - 30秒ごとと変更の直後に、サーバーの新しい変更を受け取って反映する
//   - 通信できない間もレジは使える。つながったときに送受信する
//   - 同じデータが両方の端末で変更された場合は、後から変更した方を採用する
// Web版・Androidアプリ・管理画面（Web）が、同じお店のデータを共有できる。

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'store.dart';

enum SyncState { off, idle, syncing, offline, error }

class SyncError implements Exception {
  final int status;
  final String message;
  SyncError(this.status, this.message);
  @override
  String toString() => message;
}

class CloudSync {
  final Store store;
  final http.Client client;
  final void Function() onRemote; // 別の端末の変更が届いたら画面を新しくする
  final void Function() onStatus;

  CloudSync(this.store, {http.Client? client, required this.onRemote, required this.onStatus}) : client = client ?? http.Client();

  static const pollInterval = Duration(seconds: 30);
  static const pushBatch = 400; // Firestore の1回の書き込みは500件まで
  static const pullLimit = 1000;

  // cfg: { enabled, apiKey, projectId, email, uid, refreshToken, cursor, cursorInclusive, fullUpload, lastSync,
  //        authBase, tokenBase, fsBase（テスト用に差し替え可能） }
  Json cfg = {'enabled': false};
  List<String> outbox = [];
  final Set<String> _inflight = {}, _requeue = {};
  String? _idToken;
  DateTime _idExp = DateTime.fromMillisecondsSinceEpoch(0);
  bool _busy = false, _again = false;
  Timer? _timer;
  SyncState state = SyncState.off;
  String error = '';

  bool get enabled => cfg['enabled'] == true;
  int get pending => outbox.length + ((cfg['fullUpload'] as List?)?.length ?? 0);
  String get lastSync => (cfg['lastSync'] ?? '') as String;

  void load() {
    final c = store.kv('sync');
    if (c != null) cfg = jsonDecode(c) as Json;
    final o = store.kv('syncOutbox');
    if (o != null) outbox = (jsonDecode(o) as List).cast<String>();
    state = enabled ? SyncState.idle : SyncState.off;
    store.onLocalChange = enqueue;
  }

  Future<void> _saveCfg() => store.setKv('sync', jsonEncode(cfg));
  Future<void> _saveOutbox() => store.setKv('syncOutbox', jsonEncode(outbox));

  void _set(SyncState s, [String err = '']) {
    state = s;
    error = err;
    onStatus();
  }

  String get _authBase => (cfg['authBase'] ?? 'https://identitytoolkit.googleapis.com') as String;
  String get _tokenBase => (cfg['tokenBase'] ?? 'https://securetoken.googleapis.com') as String;
  String get _fsBase => (cfg['fsBase'] ?? 'https://firestore.googleapis.com') as String;
  String get _dbPath => 'projects/${cfg['projectId']}/databases/(default)/documents';
  String get _shopPath => '$_dbPath/shops/${cfg['uid']}';

  Future<dynamic> _postJson(String url, Object body, [String? token]) async {
    final res = await client.post(Uri.parse(url),
        headers: {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'}, body: jsonEncode(body));
    dynamic b;
    try {
      b = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      b = null;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final e = b is Map ? b['error'] : null;
      throw SyncError(res.statusCode, (e is Map ? (e['message'] ?? e['status']) : null)?.toString() ?? 'HTTP ${res.statusCode}');
    }
    return b;
  }

  // ---------- ログイン ----------
  Future<Json> _signIn(String apiKey, String email, String password) async =>
      (await _postJson('$_authBase/v1/accounts:signInWithPassword?key=${Uri.encodeQueryComponent(apiKey)}',
          {'email': email, 'password': password, 'returnSecureToken': true})) as Json;

  Future<String> _token() async {
    if (_idToken != null && DateTime.now().isBefore(_idExp.subtract(const Duration(minutes: 1)))) return _idToken!;
    final res = await client.post(Uri.parse('$_tokenBase/v1/token?key=${Uri.encodeQueryComponent(cfg['apiKey'] as String)}'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'grant_type=refresh_token&refresh_token=${Uri.encodeQueryComponent(cfg['refreshToken'] as String)}');
    dynamic b;
    try {
      b = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {}
    if (res.statusCode != 200) {
      final e = b is Map ? b['error'] : null;
      throw SyncError(res.statusCode, (e is Map ? e['message'] : e)?.toString() ?? 'HTTP ${res.statusCode}');
    }
    _idToken = b['id_token'] as String;
    _idExp = DateTime.now().add(Duration(seconds: int.tryParse('${b['expires_in']}') ?? 3600));
    if (b['refresh_token'] != null && b['refresh_token'] != cfg['refreshToken']) {
      cfg['refreshToken'] = b['refresh_token'];
      await _saveCfg();
    }
    return _idToken!;
  }

  // ---------- 送信 ----------
  void enqueue(String col, List<String> ids) {
    if (!enabled) return;
    for (final id in ids) {
      final k = '$col|$id';
      if (_inflight.contains(k)) _requeue.add(k);
      if (!outbox.contains(k)) outbox.add(k);
    }
    _saveOutbox();
    onStatus();
    _schedule(const Duration(milliseconds: 1500));
  }

  Json _encode(String key) {
    final i = key.indexOf('|');
    final col = key.substring(0, i), id = key.substring(i + 1);
    final rec = store.syncGet(col, id);
    return {
      'update': {
        'name': '$_dbPath/shops/${cfg['uid']}/records/${Uri.encodeComponent('$col~$id')}',
        'fields': {
          'col': {'stringValue': col},
          'id': {'stringValue': id},
          'd': {'stringValue': rec != null ? jsonEncode(rec) : ''},
          'del': {'booleanValue': rec == null},
          'dev': {'stringValue': (store.settings['deviceCode'] ?? '') as String},
        },
      },
      'updateTransforms': [
        {'fieldPath': '_u', 'setToServerValue': 'REQUEST_TIME'}
      ],
    };
  }

  Future<bool> _pushOnce() async {
    final full = (cfg['fullUpload'] as List?)?.cast<String>();
    List<String> keys;
    var fromFull = false;
    if (outbox.isNotEmpty) {
      keys = outbox.take(pushBatch).toList();
    } else if (full != null && full.isNotEmpty) {
      keys = full.take(pushBatch).toList();
      fromFull = true;
    } else {
      return false;
    }
    if (!fromFull) _inflight.addAll(keys);
    try {
      final t = await _token();
      await _postJson('$_fsBase/v1/$_dbPath:commit', {'writes': keys.map(_encode).toList()}, t);
    } catch (e) {
      _inflight.removeAll(keys);
      _requeue.removeAll(keys);
      rethrow;
    }
    if (fromFull) {
      final rest = full!.skip(keys.length).toList();
      cfg['fullUpload'] = rest.isEmpty ? null : rest;
      await _saveCfg();
    } else {
      // 送信中に同じデータがまた変更された場合に備え、送った分だけ取り除く
      outbox = outbox.skip(keys.length).toList();
      for (final k in keys) {
        _inflight.remove(k);
        if (_requeue.remove(k) && !outbox.contains(k)) outbox.add(k);
      }
      await _saveOutbox();
    }
    return true;
  }

  // ---------- 受信 ----------
  ({String col, String id, bool del, Json? data, String? u})? _decode(Json doc) {
    final f = (doc['fields'] ?? {}) as Json;
    String? sv(String k) => (f[k] as Map?)?['stringValue'] as String?;
    final col = sv('col'), id = sv('id');
    final del = (f['del'] as Map?)?['booleanValue'] == true;
    Json? data;
    if (!del && (sv('d') ?? '').isNotEmpty) {
      try {
        data = jsonDecode(sv('d')!) as Json;
      } catch (_) {
        return null;
      }
    }
    if (col == null || id == null) return null;
    return (col: col, id: id, del: del, data: data, u: (f['_u'] as Map?)?['timestampValue'] as String?);
  }

  Future<bool> _pullOnce() async {
    final q = <String, dynamic>{
      'from': [
        {'collectionId': 'records'}
      ],
      'orderBy': [
        {'field': {'fieldPath': '_u'}, 'direction': 'ASCENDING'}
      ],
      'limit': pullLimit,
    };
    if (cfg['cursor'] != null) {
      q['where'] = {
        'fieldFilter': {
          'field': {'fieldPath': '_u'},
          'op': cfg['cursorInclusive'] == true ? 'GREATER_THAN_OR_EQUAL' : 'GREATER_THAN',
          'value': {'timestampValue': cfg['cursor']},
        }
      };
    }
    final t = await _token();
    final rows = ((await _postJson('$_fsBase/v1/$_shopPath:runQuery', {'structuredQuery': q}, t)) as List?) ?? const [];
    final withDoc = rows.where((r) => r is Map && r['document'] != null).toList();
    final docs = withDoc.map((r) => _decode((r as Map)['document'] as Json)).whereType<({String col, String id, bool del, Json? data, String? u})>().toList();
    if (docs.isNotEmpty) {
      final r = await store.applyRemote([for (final d in docs) (col: d.col, id: d.id, del: d.del, data: d.data)]);
      // 手元の方が新しかったものは送り直す
      if (r.stale.isNotEmpty) {
        for (final k in r.stale) {
          if (!outbox.contains(k)) outbox.add(k);
        }
        await _saveOutbox();
      }
      if (r.changed > 0) onRemote();
      cfg['cursor'] = docs.last.u ?? cfg['cursor'];
    }
    final more = withDoc.length >= pullLimit;
    // 続きがあるときは、同じ時刻のデータを取りこぼさないよう同じ時刻から読む（全件が同じ時刻なら次の時刻から）
    cfg['cursorInclusive'] = more && !(docs.isNotEmpty && docs.first.u == docs.last.u);
    await _saveCfg();
    return more;
  }

  Future<void> _pullAll() async {
    for (var n = 0; n < 200 && await _pullOnce(); n++) {}
  }

  // ---------- 同期の実行 ----------
  Future<void> syncNow() async {
    if (!enabled) return;
    if (_busy) {
      _again = true;
      return;
    }
    _busy = true;
    _set(SyncState.syncing);
    try {
      for (var i = 0; i < 50 && await _pushOnce(); i++) {}
      for (var i = 0; i < 50 && await _pullOnce(); i++) {}
      // 受け取ったときに送り直すものが出たら送る
      for (var i = 0; i < 50 && await _pushOnce(); i++) {}
      cfg['lastSync'] = DateTime.now().toUtc().toIso8601String();
      await _saveCfg();
      _set(SyncState.idle);
    } on SyncError catch (e) {
      if ((e.status == 400 || e.status == 401) && RegExp('TOKEN|token|INVALID_REFRESH|USER_DISABLED|USER_NOT_FOUND').hasMatch(e.message)) {
        _idToken = null;
        _set(SyncState.error, 'ログインの有効期限が切れました。設定画面でもう一度接続してください。');
      } else if (e.status == 403) {
        _set(SyncState.error, 'データへのアクセスが許可されていません。Firestoreのルール設定を確認してください。');
      } else {
        _set(SyncState.error, '同期エラー：${e.message}');
      }
    } catch (_) {
      _set(SyncState.offline); // 通信できない
    } finally {
      _busy = false;
      if (_again) {
        _again = false;
        _schedule(const Duration(milliseconds: 500));
      } else {
        _schedule(pollInterval);
      }
    }
  }

  void _schedule(Duration d) {
    if (!enabled) return;
    _timer?.cancel();
    _timer = Timer(d, syncNow);
  }

  /// 起動時
  void start() {
    if (!enabled) return;
    _schedule(const Duration(milliseconds: 300));
  }

  void stop() => _timer?.cancel();

  /// ログインできるか確かめるだけ（保存しない）
  Future<void> checkLogin(String apiKey, String email, String password) => _signIn(apiKey, email, password);

  /// 接続（ログイン）。cloud：この端末のデータを消してクラウドのデータを使う
  /// 先にクラウドのデータを全部受け取り（新しい方を採用）、その後でこの端末のデータを送る
  Future<void> connect({required String apiKey, required String projectId, required String email, required String password, bool cloudOnly = false}) async {
    final b = await _signIn(apiKey, email, password);
    cfg = {
      'enabled': true, 'apiKey': apiKey, 'projectId': projectId, 'email': email,
      'uid': b['localId'], 'refreshToken': b['refreshToken'], 'cursor': null, 'cursorInclusive': false, 'fullUpload': null,
      'authBase': cfg['authBase'], 'tokenBase': cfg['tokenBase'], 'fsBase': cfg['fsBase'],
    };
    _idToken = b['idToken'] as String?;
    _idExp = DateTime.now().add(Duration(seconds: int.tryParse('${b['expiresIn']}') ?? 3600));
    outbox = [];
    await _saveOutbox();
    await _saveCfg();
    _busy = true;
    _set(SyncState.syncing);
    try {
      if (cloudOnly) await store.clearLocalData();
      await _pullAll();
      if (!cloudOnly) cfg['fullUpload'] = store.syncAllKeys();
      await _saveCfg();
    } catch (e) {
      _busy = false;
      cfg['enabled'] = false;
      await _saveCfg();
      _set(SyncState.off);
      rethrow;
    }
    _busy = false;
    await syncNow();
  }

  /// この端末のデータを全部送り直す
  Future<void> resendAll() async {
    if (!enabled) return;
    cfg['fullUpload'] = store.syncAllKeys();
    await _saveCfg();
    await syncNow();
  }

  Future<void> disconnect() async {
    _timer?.cancel();
    cfg = {'enabled': false, 'authBase': cfg['authBase'], 'tokenBase': cfg['tokenBase'], 'fsBase': cfg['fsBase']};
    _idToken = null;
    outbox = [];
    await _saveCfg();
    await _saveOutbox();
    _set(SyncState.off);
  }

  /// テスト用：同期先をテスト用サーバーにする
  void useTestServer(String base) {
    cfg['authBase'] = base;
    cfg['tokenBase'] = base;
    cfg['fsBase'] = base;
  }
}
