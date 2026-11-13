import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/app_state.dart' show localDate;
import 'package:nikupos/core/sound.dart';

import 'app_flow_test.dart' show boot, tapKey, typeNumber, confirmPay, reveal;

String displayed(WidgetTester t, String label) {
  // AmountDisplay（ラベルと値）の値を読む
  final row = find.ancestor(of: find.text(label), matching: find.byType(Row)).first;
  final texts = find.descendant(of: row, matching: find.byType(Text)).evaluate().map((e) => (e.widget as Text).data).toList();
  return texts.last ?? '';
}

void main() {
  setUp(() {
    deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i);
    Sound.last = null;
  });

  testWidgets('テンキー：1字消す・全部消す（C）', (t) async {
    await boot(t, const Size(390, 844));
    await tapKey(t, 'product-p1');
    await typeNumber(t, '1234');
    expect(displayed(t, '重さ'), '1,234 g');
    expect(Sound.last, Sfx.key);
    await tapKey(t, 'key-BS');
    expect(displayed(t, '重さ'), '123 g');
    await tapKey(t, 'key-C');
    expect(displayed(t, '重さ'), '0 g');
    await typeNumber(t, '500');
    await tapKey(t, 'numOk');
    expect(Sound.last, Sfx.add);
  });

  testWidgets('カート：横スライドで取消・元に戻す', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await tapKey(t, 'product-p11');
    await tapKey(t, 'product-p12');
    await tapKey(t, 'product-p13');
    expect(s.lines.map((l) => l['name']), ['焼き鳥 もも', '焼き鳥 ねぎま', 'つくね']);
    final key = s.lines[1]['key'];
    await t.drag(find.byKey(ValueKey('line-$key')), const Offset(-500, 0));
    await t.pumpAndSettle();
    expect(s.lines.map((l) => l['name']), ['焼き鳥 もも', 'つくね']);
    expect(Sound.last, Sfx.remove);
    expect(find.text('焼き鳥 ねぎま を取り消しました'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('undoBtn')));
    await t.pumpAndSettle();
    expect(s.lines.map((l) => l['name']), ['焼き鳥 もも', '焼き鳥 ねぎま', 'つくね']); // 元の位置に戻る
    // 右へのスライドでも取り消せる
    await t.drag(find.byKey(ValueKey('line-${s.lines[0]['key']}')), const Offset(500, 0));
    await t.pumpAndSettle();
    expect(s.lines.length, 2);
    await t.pump(const Duration(seconds: 5));
  });

  testWidgets('操作音：会計完了・保留・設定でオフ', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await tapKey(t, 'product-p11');
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    expect(Sound.last, Sfx.done);
    await tapKey(t, 'nextCustomer');
    // 上の 🔊 ボタンでオフ → 端末に保存される
    await tapKey(t, 'soundToggle');
    expect(s.soundOn, false);
    expect(s.store.kv('soundOn'), '0');
    await tapKey(t, 'soundToggle');
    expect(s.soundOn, true);
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('電話の予約：受付→2回目は前回と同じ→レジで前受金を精算', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await t.tap(find.text('予約'));
    await t.pumpAndSettle();
    await tapKey(t, 'newPhone');
    await t.enterText(find.byKey(const ValueKey('rPhone')), '090-1234-5678');
    await t.enterText(find.byKey(const ValueKey('rName')), '山田');
    await tapKey(t, 'rAddItem');
    await tapKey(t, 'pick-p11');
    await typeNumber(t, '10');
    await tapKey(t, 'numOk');
    await tapKey(t, 'rAddItem');
    await tapKey(t, 'pick-p1');
    await typeNumber(t, '1000');
    await tapKey(t, 'numOk');
    expect(find.text('¥2,780'), findsOneWidget); // 焼き鳥 1,200 ＋ もも 1kg 1,580
    await t.tap(find.text('なし')); // 前受金
    await t.pumpAndSettle();
    await typeNumber(t, '1000');
    await tapKey(t, 'numOk');
    await tapKey(t, 'rSave');
    final r1 = s.reservations.single;
    expect(r1['channel'], 'phone');
    expect(r1['noLabel'], '1');
    expect(r1['deposit'], 1000);
    expect(r1['depositDate'], localDate(DateTime.now()));
    expect(find.byKey(ValueKey('resv-${r1['id']}')), findsOneWidget);
    expect(find.byKey(const ValueKey('resvBadge')), findsOneWidget);

    // 同じ番号から2回目：前回のお客様が出て、前回と同じ内容にできる
    await tapKey(t, 'newPhone');
    await t.enterText(find.byKey(const ValueKey('rPhone')), '09012345678');
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('pastCustomer')), findsOneWidget);
    await tapKey(t, 'sameAsLast');
    expect(find.text('¥2,780'), findsOneWidget);
    await tapKey(t, 'rSave');
    expect(s.reservations.length, 2);
    expect(s.reservations[1]['name'], '山田');

    // 1件目をレジへ → もも肉は予定重量 → 量り直して会計（前受金 1,000円を充当）
    await tapKey(t, 'checkout-${r1['id']}');
    expect(s.tab.value, 0);
    expect(s.cartDeposit, 1000);
    expect(find.byKey(const ValueKey('cartResv')), findsOneWidget);
    expect(find.text('予定重量・要計量'), findsNothing); // 文の一部として表示
    final momo = s.lines.firstWhere((l) => l['productId'] == 'p1');
    expect(momo['estimated'], true);
    await t.tap(find.textContaining('予定重量・要計量'));
    await t.pumpAndSettle();
    await typeNumber(t, '1100');
    await tapKey(t, 'numOk');
    expect(s.lines.firstWhere((l) => l['productId'] == 'p1')['estimated'], isNull);
    expect(s.cartTotals.total, 1200 + 1738); // もも 1,100g
    await tapKey(t, 'payBtn');
    expect(displayed(t, 'お支払い残額'), '¥1,938');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    final sale = s.store.sales.single;
    expect(sale['payments'], {'deposit': 1000, 'cash': 1938, 'cashless': 0});
    expect(sale['customer'], '山田');
    expect(s.reservations.firstWhere((r) => r['id'] == r1['id'])['status'], 'done');
    await tapKey(t, 'nextCustomer');
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('FAXの予約：FAX番号が必要・取消で前受金を返金', (t) async {
    final s = await boot(t, const Size(390, 844));
    await t.tap(find.byKey(const ValueKey('nav-予約')));
    await t.pumpAndSettle();
    await tapKey(t, 'newFax');
    expect(find.byKey(const ValueKey('rFax')), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('rName')), '居酒屋とりまる');
    await tapKey(t, 'rAddItem');
    await tapKey(t, 'pick-p13');
    await typeNumber(t, '20');
    await tapKey(t, 'numOk');
    await tapKey(t, 'rSave');
    expect(find.byKey(const ValueKey('rMsg')), findsOneWidget); // FAX番号がない
    expect(s.reservations, isEmpty);
    await t.enterText(find.byKey(const ValueKey('rFax')), '03-9999-0001');
    await tapKey(t, 'rSave');
    // 保存後「確認書を出しますか？」→ キャンセル
    expect(find.textContaining('ご予約確認書を印刷・共有'), findsOneWidget);
    await t.tap(find.text('キャンセル').last);
    await t.pumpAndSettle();
    final r = s.reservations.single;
    expect(r['fax'], '03-9999-0001');
    expect(r['channel'], 'fax');
    // 取消
    r['deposit'] = 500;
    await t.tap(find.text('取消'));
    await t.pumpAndSettle();
    await t.tap(find.text('前受金を返金して取消'));
    await t.pumpAndSettle();
    expect(r['status'], 'cancelled');
    expect(r['depositRefundDate'], localDate(DateTime.now()));
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('保留中の予約は、もう一度レジへで保留から呼び出す', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await s.saveReservation({'name': '佐藤', 'channel': 'phone', 'phone': '0311112222', 'date': localDate(DateTime.now()), 'time': '', 'items': [
      {'productId': 'p11', 'name': '焼き鳥 もも', 'unit': 'pc', 'price': 120, 'qty': 2, 'taxRate': 8},
    ], 'deposit': 0, 'depositMethod': 'cash'});
    await t.pumpAndSettle();
    final r = s.reservations.single;
    await t.tap(find.text('予約'));
    await t.pumpAndSettle();
    await tapKey(t, 'checkout-${r['id']}');
    await tapKey(t, 'holdBtn');
    await tapKey(t, 'holdOk');
    expect(s.cartEmpty, true);
    await t.tap(find.text('予約'));
    await t.pumpAndSettle();
    await reveal(t, find.byKey(ValueKey('checkout-${r['id']}')));
    await tapKey(t, 'checkout-${r['id']}');
    expect(s.holds, isEmpty);
    expect(s.cart['reservationId'], r['id']);
    expect(s.lines.single['qty'], 2);
    await t.pump(const Duration(seconds: 3));
  });
}
