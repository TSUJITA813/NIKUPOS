// データの保存。端末内の SQLite に、Web版と同じ形（JSON）で保存する。
//  kv   ：商品マスタ・設定・番号・保留など（キーと値）
//  docs ：売上・操作ログなどの記録（種類ごと、IDごと）
// 書き込みは保存が終わるまで待てる（会計の完了は保存が終わってから表示する）。

import 'dart:convert';
import 'dart:math';


import 'types.dart';
export 'types.dart';


/// 保存先（本番は SQLite、テストはメモリ）
abstract class Backend {
  Future<Map<String, String>> loadKv();
  Future<void> putKv(String key, String value);
  Future<Map<String, List<Json>>> loadDocs();
  Future<void> putDoc(String col, Json doc);
  Future<void> deleteDoc(String col, String id);
}

class MemoryBackend implements Backend {
  final kv = <String, String>{};
  final docs = <String, Map<String, String>>{};
  @override
  Future<Map<String, String>> loadKv() async => Map.of(kv);
  @override
  Future<void> putKv(String key, String value) async => kv[key] = value;
  @override
  Future<Map<String, List<Json>>> loadDocs() async =>
      {for (final e in docs.entries) e.key: e.value.values.map((s) => jsonDecode(s) as Json).toList()};
  @override
  Future<void> putDoc(String col, Json doc) async => (docs[col] ??= {})[doc['id'] as String] = jsonEncode(doc);
  @override
  Future<void> deleteDoc(String col, String id) async => docs[col]?.remove(id);
}

// ---------------- 初期データ ----------------

const _defaultProducts = [
  ['もも肉', '生肉', 'g', 158, 8, '#e8846b', 1300, true],
  ['むね肉', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
  ['ささみ', '生肉', 'g', 128, 8, '#f4c1ad', 1000, true],
  ['手羽先', '生肉', 'g', 118, 8, '#e8846b', 950, true],
  ['手羽元', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
  ['ひき肉', '生肉', 'g', 108, 8, '#f4c1ad', 850, true],
  ['砂肝', '生肉', 'g', 128, 8, '#c96a5a', 1000, true],
  ['レバー', '生肉', 'g', 98, 8, '#a8564a', 700, true],
  ['鶏皮', '生肉', 'g', 68, 8, '#f4c1ad', 450, true],
  ['唐揚げ', '惣菜', 'g', 248, 8, '#d9a441', 0, false],
  ['焼き鳥 もも', '惣菜', 'pc', 120, 8, '#b8743a', 0, false],
  ['焼き鳥 ねぎま', '惣菜', 'pc', 130, 8, '#b8743a', 0, false],
  ['つくね', '惣菜', 'pc', 140, 8, '#b8743a', 0, false],
  ['チキンカツ', '惣菜', 'pc', 200, 8, '#d9a441', 0, false],
  ['手羽先唐揚げ', '惣菜', 'pc', 90, 8, '#d9a441', 0, false],
  ['鶏ガラ', 'その他', 'pc', 100, 8, '#9aa3ab', 80, true],
  ['卵（10個）', 'その他', 'pc', 280, 8, '#e9d27a', 0, false],
  ['その他食品', 'その他', 'open', 0, 8, '#8fa3b8', 0, false],
  ['レジ袋', 'その他', 'pc', 5, 10, '#7f8c8d', 0, false],
];

List<Json> defaultProducts() => [
      for (var i = 0; i < _defaultProducts.length; i++)
        {
          'id': 'p${i + 1}',
          'name': _defaultProducts[i][0],
          'category': _defaultProducts[i][1],
          'unit': _defaultProducts[i][2],
          'price': _defaultProducts[i][3],
          'taxRate': _defaultProducts[i][4],
          'color': _defaultProducts[i][5],
          'order': i,
          'wsPrice': _defaultProducts[i][6],
          'trackStock': _defaultProducts[i][7],
          'minStock': 0,
        }
    ];

Json defaultSettings() => {
      'storeName': '鶏肉の店',
      'address': '',
      'tel': '',
      'invoiceNo': '',
      'footer': 'お買い上げありがとうございました',
      'categories': ['生肉', '惣菜', 'その他'],
      'rounding': 'floor',
      'cashlessTypes': ['クレジット', '電子マネー', 'QR決済'],
      'deviceCode': '',
      'fixedCosts': <Json>[],
    };

// ---------------- 保存の窓口 ----------------

/// Web版と同じ形の時刻（ミリ秒まで・UTC）。新しい方を採用するときの比べ方を Web版とそろえる
String nowIso() {
  final n = DateTime.now().toUtc();
  return DateTime.utc(n.year, n.month, n.day, n.hour, n.minute, n.second, n.millisecond).toIso8601String();
}

/// 全端末で共通にする設定（Web版の SHARED_SETTINGS と同じ＋FAX番号）。それ以外は端末ごと
const sharedSettings = [
  'storeName', 'zip', 'address', 'tel', 'fax', 'invoiceNo', 'logo', 'logoSize', 'footer', 'categories', 'rounding', 'bankInfo', 'feeMax', 'acct',
  'cashlessTypes', 'promos', 'staff', 'permissions', 'fixedCosts', 'admins', 'adminRecovery',
];

class Store {
  final Backend backend;
  Store(this.backend);

  late List<Json> products;
  late Json settings;
  late Json counters;
  List<Json> holds = [];
  final Map<String, List<Json>> _docs = {};
  final Map<String, String> _kvCache = {};
  String _sharedSnap = '';

  /// この端末で変わったデータ（クラウド同期に送る）。col: 種類、ids: ID
  void Function(String col, List<String> ids)? onLocalChange;

  /// この端末で使う種類。ほかの種類（Web版の卸・在庫など）も、届いたらそのまま保存しておく
  static const collections = ['sales', 'logs', 'cashmoves', 'closings', 'reservations'];

  Future<void> load() async {
    final kv = await backend.loadKv();
    _kvCache.addAll(kv);
    products = kv['products'] != null ? (jsonDecode(kv['products']!) as List).cast<Json>() : defaultProducts();
    settings = {...defaultSettings(), if (kv['settings'] != null) ...(jsonDecode(kv['settings']!) as Json)};
    counters = kv['counters'] != null ? jsonDecode(kv['counters']!) as Json : {};
    holds = kv['holds'] != null ? (jsonDecode(kv['holds']!) as List).cast<Json>() : [];
    final docs = await backend.loadDocs();
    for (final e in docs.entries) {
      _docs[e.key] = e.value;
    }
    for (final c in collections) {
      _docs.putIfAbsent(c, () => []);
    }
    _sharedSnap = _sharedJson();
  }

  String? kv(String key) => _kvCache[key];
  Future<void> setKv(String key, String value) {
    _kvCache[key] = value;
    return backend.putKv(key, value);
  }

  String _sharedJson() => jsonEncode({for (final k in sharedSettings) k: settings[k]});

  void _changed(String col, List<String> ids) => onLocalChange?.call(col, ids);

  /// 商品マスタを保存。changedIds：変わった商品（同期に送る。削除した商品も）
  Future<void> saveProducts([List<String> changedIds = const []]) {
    final m = nowIso();
    for (final id in changedIds) {
      final p = products.where((x) => x['id'] == id);
      if (p.isNotEmpty) p.first['_m'] = m;
    }
    if (changedIds.isNotEmpty) _changed('products', changedIds);
    return setKv('products', jsonEncode(products));
  }

  /// 設定を保存。全端末で共通の設定が変わっていれば、同期に送る
  Future<void> saveSettings() {
    final snap = _sharedJson();
    if (snap != _sharedSnap) {
      _sharedSnap = snap;
      settings['_sharedM'] = nowIso();
      _changed('config', ['shared']);
    }
    return setKv('settings', jsonEncode(settings));
  }

  Future<void> saveHolds() => setKv('holds', jsonEncode(holds));

  List<Json> all(String col) => _docs.putIfAbsent(col, () => []);
  List<Json> get sales => all('sales');

  /// 追加・更新（保存が終わるまで待てる）
  Future<void> put(String col, Json doc) {
    doc['_m'] = nowIso();
    final list = all(col);
    final i = list.indexWhere((x) => x['id'] == doc['id']);
    if (i >= 0) {
      list[i] = doc;
    } else {
      list.add(doc);
    }
    _changed(col, [doc['id'] as String]);
    return backend.putDoc(col, doc);
  }

  Future<void> delete(String col, String id) {
    all(col).removeWhere((x) => x['id'] == id);
    _changed(col, [id]);
    return backend.deleteDoc(col, id);
  }

  // ---------------- クラウド同期用 ----------------

  /// 送る内容（null なら削除済み）
  Json? syncGet(String col, String id) {
    if (col == 'products') {
      final p = products.where((x) => x['id'] == id);
      return p.isEmpty ? null : p.first;
    }
    if (col == 'config') {
      if (id != 'shared') return null;
      return {'id': 'shared', '_m': settings['_sharedM'] ?? '', for (final k in sharedSettings) k: settings[k]};
    }
    final d = all(col).where((x) => x['id'] == id);
    return d.isEmpty ? null : d.first;
  }

  /// 最初に全部送るときの一覧
  List<String> syncAllKeys() => [
        for (final e in _docs.entries)
          for (final d in e.value) '${e.key}|${d['id']}',
        for (final p in products) 'products|${p['id']}',
        'config|shared',
      ];

  /// 別の端末からの変更をまとめて反映（新しい方を採用）。
  /// 戻り値：changed＝反映した件数、stale＝手元の方が新しかったもの（送り直す）
  Future<({int changed, List<String> stale})> applyRemote(List<({String col, String id, bool del, Json? data})> docs) async {
    var n = 0;
    final stale = <String>[];
    var productsChanged = false, settingsChanged = false;
    String m(Json? x) => (x?['_m'] ?? '') as String;
    for (final d in docs) {
      if (d.col == 'products') {
        final i = products.indexWhere((p) => p['id'] == d.id);
        if (d.del) {
          if (i >= 0) {
            products.removeAt(i);
            n++;
            productsChanged = true;
          }
        } else if (i >= 0 && m(products[i]).compareTo(m(d.data)) > 0) {
          stale.add('products|${d.id}');
        } else if (i < 0 || m(products[i]).compareTo(m(d.data)) < 0) {
          if (i >= 0) {
            products[i] = d.data!;
          } else {
            products.add(d.data!);
          }
          n++;
          productsChanged = true;
        }
      } else if (d.col == 'config') {
        if (d.id != 'shared' || d.data == null) continue;
        // クラウドにつなぐ前にこの端末だけで登録した管理者は、お店の管理者（クラウド側）があればそちらに合わせる
        if (settings['adminsLocal'] == true) {
          final ra = d.data!['admins'];
          if (ra is List && ra.isNotEmpty) {
            settings['admins'] = ra;
            settings['adminRecovery'] = d.data!['adminRecovery'];
            n++;
            settingsChanged = true;
          }
          settings.remove('adminsLocal');
          settingsChanged = true;
        }
        final local = (settings['_sharedM'] ?? '') as String;
        if (local.compareTo(m(d.data)) > 0) {
          stale.add('config|shared');
        } else if (local.compareTo(m(d.data)) < 0) {
          for (final k in sharedSettings) {
            if (d.data!.containsKey(k)) settings[k] = d.data![k];
          }
          settings['_sharedM'] = m(d.data);
          n++;
          settingsChanged = true;
        }
      } else {
        final list = all(d.col);
        final i = list.indexWhere((x) => x['id'] == d.id);
        if (d.del) {
          if (i >= 0) {
            list.removeAt(i);
            await backend.deleteDoc(d.col, d.id);
            n++;
          }
        } else if (i >= 0 && m(list[i]).compareTo(m(d.data)) > 0) {
          stale.add('${d.col}|${d.id}');
        } else if (i < 0 || m(list[i]).compareTo(m(d.data)) < 0) {
          if (i >= 0) {
            list[i] = d.data!;
          } else {
            list.add(d.data!);
          }
          await backend.putDoc(d.col, d.data!);
          n++;
        }
      }
    }
    if (productsChanged) await setKv('products', jsonEncode(products));
    if (settingsChanged) {
      _sharedSnap = _sharedJson();
      await setKv('settings', jsonEncode(settings));
    }
    return (changed: n, stale: stale);
  }

  /// 保存しているデータをすべて消す（クラウドのデータで置き換えるとき）
  Future<void> clearLocalData() async {
    for (final e in _docs.entries) {
      for (final d in e.value.toList()) {
        await backend.deleteDoc(e.key, d['id'] as String);
      }
      e.value.clear();
    }
  }

  static final _rand = Random.secure();

  /// Web版と同じ形のID（記号＋時刻＋乱数）
  static String newId(String prefix) {
    final t = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
    final r = List.generate(4, (_) => _rand.nextInt(36).toRadixString(36)).join();
    return '$prefix$t$r';
  }

  /// 取引番号（端末の記号があれば頭に付ける。例：A-12）
  Future<({int no, String noLabel})> makeNo(String key) async {
    final n = ((counters[key] ?? 0) as num).toInt() + 1;
    counters[key] = n;
    await setKv('counters', jsonEncode(counters));
    final dev = (settings['deviceCode'] ?? '') as String;
    return (no: n, noLabel: dev.isEmpty ? '$n' : '$dev-$n');
  }
}
