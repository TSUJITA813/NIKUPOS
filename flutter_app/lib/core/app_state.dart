// アプリ全体の状態（カート・保留・会計・商品・設定・管理者のログイン・画面レイアウト）

import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'auth.dart';
import 'calc.dart';
import 'closing.dart';
import 'reservation.dart';
import 'sound.dart';
import 'store.dart';
import 'sync.dart';

export 'closing.dart';

/// 画面のレイアウト（端末ごとに選べる）。auto は画面の大きさで自動
enum LayoutMode { auto, phone, tablet }

LayoutMode layoutModeFrom(String? s) =>
    LayoutMode.values.firstWhere((m) => m.name == s, orElse: () => LayoutMode.auto);

String layoutModeLabel(LayoutMode m) => switch (m) {
      LayoutMode.auto => '自動（画面の大きさで切り替え）',
      LayoutMode.phone => 'スマートフォン向け',
      LayoutMode.tablet => 'タブレット向け',
    };

String pad2(int n) => n.toString().padLeft(2, '0');
String localDate(DateTime d) => '${d.year}-${pad2(d.month)}-${pad2(d.day)}';
String timeStr(DateTime d) => '${pad2(d.hour)}:${pad2(d.minute)}';

String yen(num n) {
  final neg = n < 0;
  final s = n.abs().round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');
  return '${neg ? '-' : ''}¥$s';
}

String numStr(num n) => n.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ',');

class AppState extends ChangeNotifier {
  final Store store;
  AppState(this.store);

  // ---------------- 起動 ----------------
  late Json cart;

  /// 表示中のタブ（0:レジ 1:予約 2:売上 3:管理）。予約から「レジへ」で切り替える
  final tab = ValueNotifier<int>(0);
  int _lineSeq = DateTime.now().millisecondsSinceEpoch;
  LayoutMode layoutMode = LayoutMode.auto;

  Future<void> init() async {
    await store.load();
    final c = store.kv('cart');
    cart = c != null ? jsonDecode(c) as Json : _emptyCart();
    layoutMode = layoutModeFrom(store.kv('layoutMode'));
    Sound.enabled = store.kv('soundOn') != '0';
    Sound.volume = double.tryParse(store.kv('soundVol') ?? '') ?? 0.7;
  }

  // ---------------- 操作音（この端末） ----------------
  bool get soundOn => Sound.enabled;
  double get soundVolume => Sound.volume;
  Future<void> setSound({bool? on, double? volume}) async {
    if (on != null) {
      Sound.enabled = on;
      await store.setKv('soundOn', on ? '1' : '0');
    }
    if (volume != null) {
      Sound.volume = volume;
      await store.setKv('soundVol', volume.toStringAsFixed(2));
    }
    notifyListeners();
  }

  Json _emptyCart() => {'lines': <Json>[], 'discount': null};

  List<Json> get products => store.products;
  Json get settings => store.settings;
  String get rounding => (settings['rounding'] ?? 'floor') as String;
  List<String> get categories => ((settings['categories'] ?? const ['その他']) as List).cast<String>();
  List<String> get cashlessTypes {
    final t = (settings['cashlessTypes'] as List?)?.cast<String>() ?? const [];
    return t.isNotEmpty ? t : const ['クレジット', '電子マネー', 'QR決済'];
  }

  Future<void> setLayoutMode(LayoutMode m) async {
    layoutMode = m;
    await store.setKv('layoutMode', m.name);
    notifyListeners();
  }

  // ---------------- カート ----------------
  List<Json> get lines => (cart['lines'] as List).cast<Json>();
  Totals get cartTotals => totals(lines, cart['discount'] as Json?, rounding);
  bool get cartEmpty => lines.isEmpty;

  void _saveCart() {
    store.setKv('cart', jsonEncode(cart));
    notifyListeners();
  }

  Json _newLine(Json p, num qty, [int? price]) => {
        'key': 'L${_lineSeq++}',
        'productId': p['id'],
        'name': p['name'],
        'unit': p['unit'],
        'price': price ?? (p['price'] as num).toInt(),
        'qty': qty,
        'taxRate': p['taxRate'],
        if (p['priceMode'] == 'excl') 'priceMode': 'excl',
        'discount': null,
      };

  /// 個数売りは同じ商品をまとめる。グラム売りは重さ、金額入力は金額を渡す
  void addToCart(Json p, {num? qty, int? price}) {
    if (p['unit'] == 'pc') {
      final same = lines.where((l) => l['productId'] == p['id'] && l['discount'] == null && l['price'] == p['price']);
      if (same.isNotEmpty) {
        same.first['qty'] = (same.first['qty'] as num) + (qty ?? 1);
      } else {
        lines.add(_newLine(p, qty ?? 1));
      }
    } else if (p['unit'] == 'g') {
      lines.add(_newLine(p, qty!));
    } else {
      lines.add(_newLine(p, 1, price));
    }
    Sound.play(Sfx.add);
    _saveCart();
  }

  void updateLine(String key, {num? qty, int? price, Json? discount, bool clearDiscount = false}) {
    final l = lines.firstWhere((x) => x['key'] == key);
    if (qty != null) {
      l['qty'] = qty;
      l.remove('estimated'); // 予約の予定重量を量り直した
    }
    if (price != null) l['price'] = price;
    if (discount != null) l['discount'] = discount;
    if (clearDiscount) l['discount'] = null;
    _saveCart();
  }

  /// 行を取り消す。元に戻せるよう、取り消した行と位置を返す
  ({Json line, int index})? removeLine(String key) {
    final i = lines.indexWhere((x) => x['key'] == key);
    if (i < 0) return null;
    final l = lines.removeAt(i);
    Sound.play(Sfx.remove);
    _saveCart();
    return (line: l, index: i);
  }

  /// 取り消した行を元の位置に戻す
  void restoreLine(Json line, int index) {
    lines.insert(index.clamp(0, lines.length), line);
    Sound.play(Sfx.add);
    _saveCart();
  }

  void setTxDiscount(Json? d) {
    cart['discount'] = d;
    _saveCart();
  }

  void clearCart() {
    cart = _emptyCart();
    Sound.play(Sfx.remove);
    _saveCart();
  }

  // ---------------- 保留 ----------------
  List<Json> get holds => store.holds;

  Future<void> holdCurrent(String memo) async {
    store.holds.add({
      'id': Store.newId('H'),
      'at': DateTime.now().toUtc().toIso8601String(),
      'memo': memo,
      'cart': jsonDecode(jsonEncode(cart)),
    });
    await store.saveHolds();
    log('hold', '会計を保留 ${yen(cartTotals.total)}${memo.isNotEmpty ? '（$memo）' : ''}');
    cart = _emptyCart();
    Sound.play(Sfx.hold);
    _saveCart();
  }

  /// 呼び出す。今のカートに商品があれば、先に保留する
  Future<void> recallHold(String id) async {
    final h = store.holds.firstWhere((x) => x['id'] == id);
    if (!cartEmpty) await holdCurrent('');
    store.holds.removeWhere((x) => x['id'] == id);
    await store.saveHolds();
    cart = h['cart'] as Json;
    for (final l in lines) {
      l['key'] = 'L${_lineSeq++}';
    }
    log('hold', '保留を呼び出し ${yen(cartTotals.total)}');
    Sound.play(Sfx.hold);
    _saveCart();
  }

  Future<void> deleteHold(String id) async {
    store.holds.removeWhere((x) => x['id'] == id);
    await store.saveHolds();
    notifyListeners();
  }

  // ---------------- 会計 ----------------
  int? _costNow(Object? productId, Object? unit) {
    if (unit != 'g' && unit != 'pc') return null;
    final p = products.where((x) => x['id'] == productId);
    final c = p.isEmpty ? null : p.first['cost'] as num?;
    return c == null || c == 0 ? null : c.toInt();
  }

  /// 何件目の取引の画面か（「次のお客様」で増え、画面がめくれるように切り替わる）
  int txnSerial = 0;

  /// 次に付く取引番号（例：A-13）
  String get nextNoLabel {
    final n = ((store.counters['seq'] ?? 0) as num).toInt() + 1;
    final dev = (settings['deviceCode'] ?? '') as String;
    return dev.isEmpty ? '$n' : '$dev-$n';
  }

  /// 次のお客様の会計にする
  void startNewTransaction() {
    txnSerial++;
    notifyListeners();
  }

  /// カートの前受金（予約から読み込んだとき）
  int get cartDeposit => ((cart['deposit'] ?? 0) as num).toInt();

  /// 会計を確定して保存する（保存が終わってから戻る）
  Future<Json> completeSale(Payment p, String ctype) async {
    final t = cartTotals;
    final now = DateTime.now();
    final sale = <String, dynamic>{
      'id': Store.newId('S'),
      'no': 0,
      'at': now.toUtc().toIso8601String(),
      'date': localDate(now),
      'lines': [
        for (final l in lines)
          {
            'productId': l['productId'], 'name': l['name'], 'unit': l['unit'], 'price': l['price'], 'qty': l['qty'],
            'taxRate': l['taxRate'], if (isExcl(l)) 'priceMode': 'excl', 'discount': l['discount'], 'promoName': '', 'promoDiscount': 0,
            'discountAmount': lineDiscount(l, rounding), 'amount': lineAmount(l, rounding),
            'cost': _costNow(l['productId'], l['unit']),
          }
      ],
      'discount': cart['discount'],
      'totals': t.toJson(),
      'method': p.cashless > 0 && p.cash > 0 ? 'split' : p.cashless > 0 ? 'cashless' : 'cash',
      'cashlessType': p.cashless > 0 ? ctype : '',
      'dev': settings['deviceCode'] ?? '',
      'staff': '',
      'received': p.received,
      'change': p.change,
      'refund': p.refund,
      'payments': {'deposit': p.deposit, 'cash': p.cash, 'cashless': p.cashless},
      'customer': cart['customer'] ?? '',
      'reservationId': cart['reservationId'],
      'void': false,
    };
    final n = await store.makeNo('seq');
    sale['no'] = n.no;
    sale['noLabel'] = n.noLabel;
    await store.put('sales', sale); // ここで保存が終わる
    final rid = cart['reservationId'];
    if (rid != null) {
      final r = reservations.where((x) => x['id'] == rid);
      if (r.isNotEmpty) {
        r.first['status'] = 'done';
        r.first['saleId'] = sale['id'];
        r.first['doneAt'] = sale['at'];
        await store.put('reservations', r.first);
      }
    }
    Sound.play(Sfx.done);
    cart = _emptyCart();
    await store.setKv('cart', jsonEncode(cart));
    notifyListeners();
    return sale;
  }

  Future<void> voidSale(Json sale) async {
    sale['void'] = true;
    sale['voidAt'] = DateTime.now().toUtc().toIso8601String();
    await store.put('sales', sale);
    log('void', '取引No.${sale['noLabel'] ?? sale['no']} を取消 ${yen((sale['totals'] as Map)['total'] as num)}');
    notifyListeners();
  }

  // ---------------- 入出金・レジ締め ----------------
  String get myDev => (settings['deviceCode'] ?? '') as String;
  List<Json> get cashmoves => store.all('cashmoves');
  List<Json> get closings => store.all('closings');

  /// この端末の、その日のレジのまとめ
  DrawerSummary drawerOf(String date) => drawerSummary(
        sales: store.sales,
        reservations: reservations,
        cashmoves: cashmoves,
        slips: store.all('slips'),
        receipts: store.all('receipts'),
        date: date,
        dev: myDev,
      );

  ({int amount, String from}) floatOf(String date) =>
      defaultFloat(cashmoves: cashmoves, closings: closings, date: date, dev: myDev, setting: settings['floatDefault']);

  Future<Json> addCashMove(String date, String kind, int amount, {String account = '', int taxRate = 0, String memo = ''}) async {
    final m = <String, dynamic>{
      'id': Store.newId('K'),
      'at': DateTime.now().toUtc().toIso8601String(),
      'date': date,
      'dev': myDev,
      'staff': adminId ?? '',
      'kind': kind,
      'amount': amount,
      'account': account,
      'taxRate': taxRate,
      'memo': memo,
    };
    await store.put('cashmoves', m);
    log('cashmove', '${cashMoveKinds[kind]} ${yen(amount)}${account.isNotEmpty ? '（$account）' : ''}${memo.isNotEmpty ? ' $memo' : ''}');
    notifyListeners();
    sync?.start();
    return m;
  }

  Future<void> deleteCashMove(Json m) async {
    await store.delete('cashmoves', m['id'] as String);
    log('cashmove-delete', '${cashMoveKinds[m['kind']]} ${yen(m['amount'] as num)} を削除');
    notifyListeners();
    sync?.start();
  }

  /// レジ締め（精算）を記録する
  Future<Json> saveClosing(Json c) async {
    c['id'] = Store.newId('Z');
    await store.put('closings', c);
    log('closing', '${c['date']} 精算・実際の現金 ${yen(c['counted'] as num)}・過不足 ${signedYen(c['diff'] as num)}');
    Sound.play(Sfx.done);
    notifyListeners();
    sync?.start();
    return c;
  }

  // ---------------- 予約・取り置き ----------------
  List<Json> get reservations => store.all('reservations');

  /// 予約を保存（新規は番号を付ける）
  Future<Json> saveReservation(Json r) async {
    final isNew = r['id'] == null;
    if (isNew) {
      r['id'] = Store.newId('R');
      final n = await store.makeNo('rseq');
      r['no'] = n.no;
      r['noLabel'] = n.noLabel;
      r['createdAt'] = DateTime.now().toUtc().toIso8601String();
      r['status'] ??= 'reserved';
    }
    await store.put('reservations', r);
    log('reservation', '予約No.${r['noLabel']} ${r['name']} 様（${channelLabels[r['channel']] ?? ''}）を${isNew ? '登録' : '変更'}');
    notifyListeners();
    return r;
  }

  Future<void> toggleReady(Json r) async {
    r['status'] = r['status'] == 'ready' ? 'reserved' : 'ready';
    await store.put('reservations', r);
    notifyListeners();
  }

  /// 予約の取消。refund：前受金を返金する
  Future<void> cancelReservation(Json r, {bool refund = false}) async {
    r['status'] = 'cancelled';
    r['cancelledAt'] = DateTime.now().toUtc().toIso8601String();
    if (refund && ((r['deposit'] ?? 0) as num) > 0) {
      r['depositRefundDate'] = localDate(DateTime.now());
      r['refundDev'] = settings['deviceCode'] ?? '';
    }
    await store.put('reservations', r);
    log('reservation', '予約No.${r['noLabel']} ${r['name']} 様を取消${refund ? '（前受金を返金）' : ''}');
    notifyListeners();
  }

  /// 予約をレジに読み込む（価格は会計時の価格。グラム売りは予定重量で、量り直す）
  /// 同じ予約を保留中なら、保留から呼び出す
  Future<void> loadReservation(Json r) async {
    final held = holds.where((h) => (h['cart'] as Json)['reservationId'] == r['id']);
    if (held.isNotEmpty) {
      await recallHold(held.first['id'] as String);
      return;
    }
    cart = {
      'lines': [
        for (final it in (r['items'] as List).cast<Json>())
          () {
            final pr = products.where((p) => p['id'] == it['productId']);
            final l = <String, dynamic>{
              'key': 'L${_lineSeq++}',
              'productId': it['productId'],
              'name': it['name'],
              'unit': it['unit'],
              'price': pr.isNotEmpty && it['unit'] != 'open' ? pr.first['price'] : it['price'],
              'qty': it['qty'],
              'taxRate': pr.isNotEmpty ? pr.first['taxRate'] : (it['taxRate'] ?? 8),
              if ((pr.isNotEmpty ? pr.first['priceMode'] : it['priceMode']) == 'excl') 'priceMode': 'excl',
              'discount': null,
            };
            if (it['unit'] == 'g') l['estimated'] = true;
            return l;
          }()
      ],
      'discount': null,
      'reservationId': r['id'],
      'reservationNo': r['noLabel'] ?? '${r['no']}',
      'customer': r['name'],
      'deposit': r['depositRefundDate'] != null ? 0 : ((r['deposit'] ?? 0) as num).toInt(),
    };
    _saveCart();
  }

  /// カートの予約が、すでに会計済み・取消なら、予約とのつながり（前受金）を外す。外したら true
  bool unlinkStaleReservation() {
    final rid = cart['reservationId'];
    if (rid == null) return false;
    final r = reservations.where((x) => x['id'] == rid);
    if (r.isNotEmpty && isActiveReservation(r.first)) return false;
    for (final k in ['reservationId', 'reservationNo', 'customer', 'deposit']) {
      cart.remove(k);
    }
    _saveCart();
    return true;
  }

  /// 量り直したら「予定重量」の印を外す
  void markWeighed(String key) {
    final l = lines.firstWhere((x) => x['key'] == key);
    l.remove('estimated');
    _saveCart();
  }

  // ---------------- 商品・設定 ----------------
  /// 全部の商品を内税（incl）・外税（excl）にする。新しく登録する商品もそれに合わせる
  Future<void> setPriceModeAll(String mode) async {
    final changed = <String>[];
    for (final p in products) {
      if ((p['priceMode'] == 'excl') != (mode == 'excl')) {
        if (mode == 'excl') {
          p['priceMode'] = 'excl';
        } else {
          p.remove('priceMode');
        }
        changed.add(p['id'] as String);
      }
    }
    settings['priceModeDefault'] = mode;
    await saveSettings();
    await store.saveProducts(changed);
    log('product', '全部の商品を${mode == 'excl' ? '外税' : '内税'}に変更');
    notifyListeners();
  }

  /// 商品の並べ替え。subset：並べ替えた商品（画面に出ていた分）を新しい順で。
  /// ほかの商品の位置は動かさず、subset が占めていた場所に新しい順で入れ直し、全体を 0,1,2… に振り直す
  Future<void> reorderProducts(List<Json> subset, {List<String> alsoChanged = const []}) async {
    final idx = {for (var i = 0; i < products.length; i++) products[i]['id']: i};
    final full = products.toList()
      ..sort((a, b) {
        final c = ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num);
        return c != 0 ? c : idx[a['id']]!.compareTo(idx[b['id']]!);
      });
    final ids = subset.map((p) => p['id']).toSet();
    var k = 0;
    for (var i = 0; i < full.length; i++) {
      if (ids.contains(full[i]['id'])) full[i] = subset[k++];
    }
    final changed = <String>[...alsoChanged];
    for (var i = 0; i < full.length; i++) {
      if (full[i]['order'] != i) {
        full[i]['order'] = i;
        if (!changed.contains(full[i]['id'])) changed.add(full[i]['id'] as String);
      }
    }
    if (changed.isEmpty) return;
    await store.saveProducts(changed);
    log('product', '商品の並び順を変更');
    notifyListeners();
  }

  Future<void> saveProduct(Json p) async {
    final i = products.indexWhere((x) => x['id'] == p['id']);
    if (i >= 0) {
      products[i] = p;
    } else {
      p['id'] = Store.newId('p');
      p['order'] = products.fold<num>(-1, (m, x) => math.max(m, ((x['order'] ?? 0) as num))) + 1;
      products.add(p);
    }
    await store.saveProducts([p['id'] as String]);
    log('product', '商品を保存：${p['name']}');
    notifyListeners();
  }

  Future<void> deleteProduct(String id) async {
    final p = products.firstWhere((x) => x['id'] == id);
    products.removeWhere((x) => x['id'] == id);
    await store.saveProducts([id]);
    log('product', '商品を削除：${p['name']}');
    notifyListeners();
  }

  Future<void> saveSettings() async {
    await store.saveSettings();
    notifyListeners();
  }

  // ---------------- クラウド同期 ----------------
  /// クラウド同期（main で用意する。テストでは使わないこともある）
  CloudSync? sync;

  /// 別の端末からの変更が届いたとき・同期の状態が変わったとき
  void remoteChanged() => notifyListeners();

  /// クラウド同期を用意する（起動時）
  void attachSync(CloudSync Function(AppState s) make) {
    sync = make(this);
    sync!.load();
    sync!.start();
  }

  // ---------------- 操作ログ ----------------
  void log(String action, String detail) {
    final now = DateTime.now();
    store.put('logs', {
      'id': Store.newId('G'),
      'at': now.toUtc().toIso8601String(),
      'date': localDate(now),
      'dev': settings['deviceCode'] ?? '',
      'staff': adminId ?? '',
      'action': action,
      'detail': detail,
    });
  }

  // ---------------- 管理者 ----------------
  String? adminId;
  DateTime _lastActive = DateTime.now();
  List<Json> get admins => ((settings['admins'] as List?) ?? const []).cast<Json>();
  int get adminTimeoutMin => int.tryParse(store.kv('adminTimeout') ?? '') ?? 15;

  bool get isAdmin {
    if (adminId == null) return false;
    if (!admins.any((a) => a['id'] == adminId)) return false;
    if (DateTime.now().difference(_lastActive).inMinutes >= adminTimeoutMin) {
      logout(auto: true);
      return false;
    }
    return true;
  }

  void touch() => _lastActive = DateTime.now();

  FailCounter get _fails => FailCounter.fromJson(store.kv('adminFails'));
  Duration get lockedFor => _fails.lockedFor(DateTime.now());

  Future<void> _addFail() async {
    final f = _fails..addFail(DateTime.now());
    await store.setKv('adminFails', f.toJson());
  }

  Future<void> _resetFails() => store.setKv('adminFails', (FailCounter(0, 0)).toJson());

  /// 最初の管理者を登録。回復用コードを返す（このときだけ表示する）
  Future<String> registerAdmin(String id, String password) async {
    final acc = await makeAccount(id, password);
    final code = newRecoveryCode();
    settings['admins'] = [acc];
    settings['adminRecovery'] = await makeRecovery(code);
    // まだクラウドにつないでいない端末：あとでつないだとき、お店の管理者がいればそちらを使う
    if (sync == null || !sync!.enabled) {
      settings['adminsLocal'] = true;
    } else {
      settings.remove('adminsLocal');
    }
    await saveSettings();
    adminId = acc['id'] as String;
    touch();
    log('admin-register', adminId!);
    notifyListeners();
    return code;
  }

  /// ログイン。成功で null、失敗で理由を返す
  Future<String?> login(String id, String password) async {
    final wait = lockedFor;
    if (wait > Duration.zero) return '何度も間違えたため、${(wait.inSeconds / 60).ceil()}分ほど待ってからやり直してください。';
    final nid = normId(id);
    final acc = admins.where((a) => a['id'] == nid);
    final ok = acc.isNotEmpty
        ? await checkPassword(acc.first, password)
        : await derive(password, 'dummy-salt').then((_) => false); // IDが違うときも同じだけ時間をかける
    if (!ok) {
      await _addFail();
      Sound.play(Sfx.error);
      log('admin-fail', 'ID「$nid」でログインに失敗');
      return 'IDかパスワードが違います。';
    }
    await _resetFails();
    adminId = nid;
    touch();
    log('admin-login', nid);
    notifyListeners();
    return null;
  }

  void logout({bool auto = false}) {
    if (adminId != null) log('admin-logout', '$adminId${auto ? '（一定時間操作がなかったため）' : ''}');
    adminId = null;
    notifyListeners();
  }

  /// 回復用コードでパスワードを再設定。成功で新しい回復用コード、失敗で例外（理由）
  Future<String> resetWithCode(String code, String id, String newPassword) async {
    final wait = lockedFor;
    if (wait > Duration.zero) throw '何度も間違えたため、${(wait.inSeconds / 60).ceil()}分ほど待ってからやり直してください。';
    final rec = settings['adminRecovery'] as Json?;
    if (rec == null) throw '回復用コードが設定されていません。';
    final nid = normId(id);
    if (!admins.any((a) => a['id'] == nid)) throw 'その管理者IDはありません。';
    if (!await checkRecovery(rec, code)) {
      await _addFail();
      log('admin-fail', '回復用コードが違う');
      throw '回復用コードが違います。';
    }
    await _resetFails();
    final acc = await makeAccount(nid, newPassword);
    final newCode = newRecoveryCode();
    settings['admins'] = [for (final a in admins) a['id'] == nid ? acc : a];
    settings['adminRecovery'] = await makeRecovery(newCode);
    await saveSettings();
    adminId = nid;
    touch();
    log('admin-reset', '$nid のパスワードを回復用コードで再設定');
    notifyListeners();
    return newCode;
  }

  /// パスワードの変更（今のパスワードが必要）
  Future<String?> changePassword(String current, String newPassword) async {
    final me = admins.firstWhere((a) => a['id'] == adminId);
    if (!await checkPassword(me, current)) return '今のパスワードが違います。';
    final acc = await makeAccount(adminId!, newPassword);
    settings['admins'] = [for (final a in admins) a['id'] == adminId ? acc : a];
    await saveSettings();
    log('admin-password', adminId!);
    return null;
  }

  Future<void> setAdminTimeout(int min) async {
    await store.setKv('adminTimeout', '$min');
    notifyListeners();
  }
}
