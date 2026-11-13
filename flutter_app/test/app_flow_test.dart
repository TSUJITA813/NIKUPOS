import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/calc.dart';
import 'package:nikupos/core/store.dart';
import 'package:nikupos/main.dart';

Future<AppState> boot(WidgetTester t, Size size, {MemoryBackend? backend}) async {
  t.view.physicalSize = size;
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final s = AppState(Store(backend ?? MemoryBackend()));
  await t.runAsync(s.init);
  await t.pumpWidget(NikuposApp(state: s));
  await t.pumpAndSettle();
  return s;
}

/// 画面の外（スクロールの先）にある部品も探す（縦にスクロールできる所を上下に動かす）
Future<void> reveal(WidgetTester t, Finder f) async {
  if (f.evaluate().isNotEmpty) return;
  final scrollables = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).evaluate().toList().reversed;
  for (final e in scrollables) {
    for (final dy in [300.0, -300.0]) {
      for (var i = 0; i < 12 && f.evaluate().isEmpty; i++) {
        await t.drag(find.byWidget(e.widget), Offset(0, dy));
        await t.pumpAndSettle();
      }
      if (f.evaluate().isNotEmpty) return;
    }
  }
}

Future<void> tapKey(WidgetTester t, String key) async {
  final f = find.byKey(ValueKey(key));
  await reveal(t, f);
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

Future<void> typeNumber(WidgetTester t, String digits) async {
  for (final ch in digits.split('')) {
    await tapKey(t, 'key-$ch');
  }
}

/// 会計確定（保存の待ちがあるので実時間で待つ）
Future<void> confirmPay(WidgetTester t) async {
  await t.tap(find.byKey(const ValueKey('payOk')));
  await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
  await t.pumpAndSettle();
}

void main() {
  setUp(() => deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i));
  testWidgets('スマートフォン：個数売り・グラム売り・併用の会計', (t) async {
    final s = await boot(t, const Size(390, 844));
    expect(find.byType(NavigationBar), findsOneWidget);
    await tapKey(t, 'product-p11');
    await tapKey(t, 'product-p11'); // 焼き鳥 120 × 2
    await tapKey(t, 'product-p1'); // もも 158/100g
    await typeNumber(t, '500');
    await tapKey(t, 'numOk');
    expect(s.cartTotals.total, 240 + 790);
    expect(find.text('¥1,030'), findsWidgets);

    await tapKey(t, 'payMini');
    await t.tap(find.text('併用'));
    await t.pumpAndSettle();
    await typeNumber(t, '500'); // クレジット 500
    await t.tap(find.text('お預かり'));
    await t.pumpAndSettle();
    await tapKey(t, 'quick-1000'); // 現金 530 に 1,000円
    await confirmPay(t);
    expect(find.byKey(const ValueKey('doneBig')), findsOneWidget);
    expect(find.text('¥470'), findsOneWidget); // おつり
    final sale = s.store.sales.single;
    expect(sale['method'], 'split');
    expect(sale['payments'], {'deposit': 0, 'cash': 530, 'cashless': 500});
    expect(sale['cashlessType'], 'クレジット');
    expect(sale['noLabel'], '1');
    await tapKey(t, 'nextCustomer');
    expect(s.cartEmpty, true);
  });

  testWidgets('保留と呼び出し・入れ替え', (t) async {
    final s = await boot(t, const Size(390, 844));
    await tapKey(t, 'product-p13'); // つくね
    await tapKey(t, 'openCart');
    await tapKey(t, 'holdBtn');
    await t.enterText(find.byKey(const ValueKey('holdMemo')), '赤い服の方');
    await tapKey(t, 'holdOk');
    expect(s.cartEmpty, true);
    expect(s.holds.single['memo'], '赤い服の方');
    // 次のお客様の会計中に、保留と入れ替え（カートを閉じてから）
    await t.tap(find.text('閉じる ▼'));
    await t.pumpAndSettle();
    await tapKey(t, 'product-p11');
    await tapKey(t, 'openCart');
    await tapKey(t, 'holdBtn');
    await tapKey(t, 'recall-0');
    expect(s.lines.single['name'], 'つくね');
    expect(s.holds.length, 1);
    expect(((s.holds.single['cart'] as Json)['lines'] as List).single['name'], '焼き鳥 もも');
    await t.pump(const Duration(seconds: 3)); // 知らせが消えるまで
  });

  testWidgets('商品の検索（ひらがな・半角カナ）', (t) async {
    await boot(t, const Size(390, 844));
    await t.enterText(find.byKey(const ValueKey('prodSearch')), 'ﾃﾊﾞ');
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('product-p4')), findsOneWidget); // 手羽先
    expect(find.byKey(const ValueKey('product-p5')), findsOneWidget); // 手羽元
    expect(find.byKey(const ValueKey('product-p1')), findsNothing);
  });

  testWidgets('タブレット：カートが横に並び、レイアウトを切り替えられる', (t) async {
    final s = await boot(t, const Size(1280, 800));
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byKey(const ValueKey('payBtn')), findsOneWidget); // 右側のカート
    await s.setLayoutMode(LayoutMode.phone);
    await t.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byKey(const ValueKey('payMini')), findsOneWidget);
    await s.setLayoutMode(LayoutMode.tablet);
    await t.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
  });

  testWidgets('スマートフォンでもタブレット向けを選べる', (t) async {
    final s = await boot(t, const Size(390, 844));
    await s.setLayoutMode(LayoutMode.tablet);
    await t.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
  });

  testWidgets('管理：登録・回復用コード・ダッシュボード・ログアウト・ログイン', (t) async {
    final s = await boot(t, const Size(1280, 800));
    // 会計を1件（原価つき）
    s.products.firstWhere((p) => p['id'] == 'p11')['cost'] = 50;
    await tapKey(t, 'product-p11');
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    await tapKey(t, 'nextCustomer');

    await t.tap(find.text('管理'));
    await t.pumpAndSettle();
    expect(find.text('🔒 管理者の登録'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('authId')), 'Tenshu');
    await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
    await t.enterText(find.byKey(const ValueKey('authPw2')), 'toriniku2026');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    final code = (t.widget(find.byKey(const ValueKey('recoveryCode'))) as SelectableText).data!;
    expect(RegExp(r'^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$').hasMatch(code), true);
    await tapKey(t, 'recoveryOk');
    expect(s.isAdmin, true);
    expect(s.admins.single['id'], 'tenshu');
    expect(s.settings.toString().contains('toriniku2026'), false);
    // ダッシュボード：焼き鳥 120（税抜 111）、原価 50 → 粗利 61
    expect(find.text('¥120'), findsWidgets);
    expect(find.textContaining('¥61'), findsWidgets);

    await tapKey(t, 'logout');
    expect(find.text('🔒 管理画面にログイン'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('authId')), 'tenshu');
    await t.enterText(find.byKey(const ValueKey('authPw')), 'wrong-pass');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    expect(find.text('IDかパスワードが違います。'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    expect(find.text('ダッシュボード'), findsOneWidget);
    await t.pump(const Duration(seconds: 3)); // 知らせが消えるまで
  });

  testWidgets('売上：取引の取消で売上から除かれる', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await tapKey(t, 'product-p12');
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    await tapKey(t, 'nextCustomer');
    await t.tap(find.text('売上'));
    await t.pumpAndSettle();
    expect(summarizeDay(s.store.sales, localDate(DateTime.now())).total, 130);
    await t.tap(find.byKey(ValueKey('sale-${s.store.sales.single['id']}')));
    await t.pumpAndSettle();
    await t.tap(find.text('取引を取消'));
    await t.pumpAndSettle();
    await t.tap(find.text('取り消す'));
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await t.pumpAndSettle();
    expect(s.store.sales.single['void'], true);
    expect(summarizeDay(s.store.sales, localDate(DateTime.now())).total, 0);
  });

  testWidgets('保存：会計は保存されてから完了になり、開き直しても残る', (t) async {
    final backend = MemoryBackend();
    final s = await boot(t, const Size(390, 844), backend: backend);
    await tapKey(t, 'product-p11');
    await tapKey(t, 'payMini');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    expect(backend.docs['sales']!.length, 1);
    final s2 = AppState(Store(backend));
    await t.runAsync(s2.init);
    expect(s2.store.sales.single['totals']['total'], 120);
    expect(s2.cartEmpty, true);
    expect(s.store.counters['seq'], 1);
  });
}
