// アプリ全体の状態（カート・保留・会計・商品・設定・管理者のログイン・画面レイアウト）

import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'auth.dart';
import 'calc.dart';
import 'store.dart';

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
  int _lineSeq = DateTime.now().millisecondsSinceEpoch;
  LayoutMode layoutMode = LayoutMode.auto;

  Future<void> init() async {
    await store.load();
    final c = store.kv('cart');
    cart = c != null ? jsonDecode(c) as Json : _emptyCart();
    layoutMode = layoutModeFrom(store.kv('layoutMode'));
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
    _saveCart();
  }

  void updateLine(String key, {num? qty, int? price, Json? discount, bool clearDiscount = false}) {
    final l = lines.firstWhere((x) => x['key'] == key);
    if (qty != null) l['qty'] = qty;
    if (price != null) l['price'] = price;
    if (discount != null) l['discount'] = discount;
    if (clearDiscount) l['discount'] = null;
    _saveCart();
  }

  void removeLine(String key) {
    lines.removeWhere((x) => x['key'] == key);
    _saveCart();
  }

  void setTxDiscount(Json? d) {
    cart['discount'] = d;
    _saveCart();
  }

  void clearCart() {
    cart = _emptyCart();
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
    clearCart();
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
            'taxRate': l['taxRate'], 'discount': l['discount'], 'promoName': '', 'promoDiscount': 0,
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
      'customer': '',
      'void': false,
    };
    final n = await store.makeNo('seq');
    sale['no'] = n.no;
    sale['noLabel'] = n.noLabel;
    await store.put('sales', sale); // ここで保存が終わる
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

  // ---------------- 商品・設定 ----------------
  Future<void> saveProduct(Json p) async {
    final i = products.indexWhere((x) => x['id'] == p['id']);
    if (i >= 0) {
      products[i] = p;
    } else {
      p['id'] = Store.newId('p');
      p['order'] = products.length;
      products.add(p);
    }
    await store.saveProducts();
    log('product', '商品を保存：${p['name']}');
    notifyListeners();
  }

  Future<void> deleteProduct(String id) async {
    final p = products.firstWhere((x) => x['id'] == id);
    products.removeWhere((x) => x['id'] == id);
    await store.saveProducts();
    log('product', '商品を削除：${p['name']}');
    notifyListeners();
  }

  Future<void> saveSettings() async {
    await store.saveSettings();
    notifyListeners();
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
