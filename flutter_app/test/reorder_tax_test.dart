import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/receipt.dart';

import 'app_flow_test.dart' show boot, tapKey, typeNumber, confirmPay;

List<String> orderOf(AppState s) {
  final l = s.products.toList()..sort((a, b) => ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num));
  return l.map((p) => p['id'] as String).toList();
}

Future<void> loginAdmin(WidgetTester t) async {
  await t.tap(find.text('管理'));
  await t.pumpAndSettle();
  await t.enterText(find.byKey(const ValueKey('authId')), 'tenshu');
  await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
  await t.enterText(find.byKey(const ValueKey('authPw2')), 'toriniku2026');
  await t.tap(find.byKey(const ValueKey('authSubmit')));
  await t.pumpAndSettle();
  await t.tap(find.byKey(const ValueKey('recoveryOk')));
  await t.pumpAndSettle();
}

void main() {
  setUp(() => deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i));

  testWidgets('並べ替え：商品を長押しして動かすと、その場所に入り、順番が保存される', (t) async {
    final s = await boot(t, const Size(1280, 800));
    final before = orderOf(s);
    final a = before[0], b = before[3];
    final from = t.getCenter(find.byKey(ValueKey('product-$a')));
    final to = t.getCenter(find.byKey(ValueKey('product-$b')));
    final g = await t.startGesture(from);
    await t.pump(const Duration(milliseconds: 700)); // 長押し
    expect(find.byKey(const ValueKey('reorderBar')), findsOneWidget); // 並べ替え中の表示
    for (var i = 1; i <= 10; i++) {
      await g.moveTo(Offset.lerp(from, to, i / 10)!);
      await t.pump(const Duration(milliseconds: 30));
    }
    await g.up();
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await t.pump(const Duration(milliseconds: 300));
    final after = orderOf(s);
    expect(after.indexOf(a), 3);
    expect(after.sublist(0, 3), [before[1], before[2], before[3]]);
    expect(after.sublist(4), before.sublist(4));
    expect(s.cartEmpty, true); // 長押しで商品はカートに入らない
    // 並べ替え中は、タップしてもカートに入らない
    await t.tap(find.byKey(const ValueKey('product-p11')));
    await t.pump(const Duration(milliseconds: 300));
    expect(s.cartEmpty, true);
    await t.tap(find.byKey(const ValueKey('reorderDone')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('reorderBar')), findsNothing);
    await tapKey(t, 'product-p11');
    expect(s.cartEmpty, false);
  });

  testWidgets('並べ替え：カテゴリで絞ったときも、ほかの商品の位置は変わらない', (t) async {
    final s = await boot(t, const Size(1280, 800));
    final before = orderOf(s);
    final cat = s.categories[1];
    final inCat = before.where((id) => s.products.firstWhere((p) => p['id'] == id)['category'] == cat).toList();
    await t.tap(find.widgetWithText(ChoiceChip, cat));
    await t.pumpAndSettle();
    final from = t.getCenter(find.byKey(ValueKey('product-${inCat.last}')));
    final to = t.getCenter(find.byKey(ValueKey('product-${inCat.first}')));
    final g = await t.startGesture(from);
    await t.pump(const Duration(milliseconds: 700));
    for (var i = 1; i <= 10; i++) {
      await g.moveTo(Offset.lerp(from, to, i / 10)!);
      await t.pump(const Duration(milliseconds: 30));
    }
    await g.up();
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await t.pump(const Duration(milliseconds: 300));
    final after = orderOf(s);
    final afterCat = after.where(inCat.contains).toList();
    expect(afterCat, [inCat.last, ...inCat.sublist(0, inCat.length - 1)]);
    // カテゴリ外の商品どうしの順番は同じ
    expect(after.where((id) => !inCat.contains(id)).toList(), before.where((id) => !inCat.contains(id)).toList());
    await t.tap(find.byKey(const ValueKey('reorderDone')));
    await t.pumpAndSettle();
  });

  testWidgets('外税：商品を外税にすると、会計で消費税が足され、レシートに外税が出る', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await loginAdmin(t);
    await t.tap(find.byKey(const ValueKey('tab-products')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('padmin-p2')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('choice-excl')));
    await t.pumpAndSettle();
    expect(find.textContaining('税抜き・円'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('pPrice')), '98');
    await t.tap(find.byKey(const ValueKey('pSave')));
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await t.pumpAndSettle();
    final p2 = s.products.firstWhere((p) => p['id'] == 'p2');
    expect(p2['priceMode'], 'excl');
    expect(p2['price'], 98);
    await t.pump(const Duration(seconds: 3));

    await t.tap(find.text('レジ'));
    await t.pumpAndSettle();
    await tapKey(t, 'product-p2');
    await typeNumber(t, '200');
    await tapKey(t, 'numOk');
    expect(s.cartTotals.subtotal, 196);
    expect(s.cartTotals.taxExtra, 15);
    expect(s.cartTotals.total, 211);
    expect(find.text('外税（消費税）'), findsOneWidget);
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    final sale = s.store.sales.single;
    expect(sale['totals']['total'], 211);
    expect(sale['totals']['taxExtra'], 15);
    expect((sale['lines'] as List).single['priceMode'], 'excl');
    final lines = receiptLines(sale, s.settings);
    expect(lines.any((l) => l.left == '外税（消費税）' && l.right == '¥15'), true);
    expect(lines.any((l) => l.left.endsWith('（税抜）')), true);
    await tapKey(t, 'nextCustomer');
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('外税：全部の商品をまとめて外税にできる', (t) async {
    final s = await boot(t, const Size(1280, 800));
    await loginAdmin(t);
    await t.tap(find.byKey(const ValueKey('tab-products')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('priceModeAll')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('allExcl')));
    await t.pumpAndSettle();
    await t.tap(find.text('変える'));
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await t.pumpAndSettle();
    expect(s.products.every((p) => p['priceMode'] == 'excl'), true);
    expect(s.settings['priceModeDefault'], 'excl');
    await t.pump(const Duration(seconds: 3));
  });

  Future<void> dragHandle(WidgetTester t, String id, Offset to) async {
    final from = t.getCenter(find.byKey(ValueKey('phandle-$id')));
    final g = await t.startGesture(from);
    await t.pump(const Duration(milliseconds: 50));
    for (var i = 1; i <= 15; i++) {
      await g.moveTo(Offset.lerp(from, Offset(from.dx, to.dy), i / 15)!);
      await t.pump(const Duration(milliseconds: 30));
    }
    await g.up();
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await t.pumpAndSettle();
  }

  testWidgets('管理の商品一覧：≡ を押したまま動かして並べ替え、別のカテゴリへも移せる', (t) async {
    final s = await boot(t, const Size(1280, 1400));
    await loginAdmin(t);
    await t.tap(find.byKey(const ValueKey('tab-products')));
    await t.pumpAndSettle();
    final cat0 = s.categories[0];
    List<String> idsIn(String c) => orderOf(s).where((id) => s.products.firstWhere((p) => p['id'] == id)['category'] == c).toList();
    final before = idsIn(cat0);
    // 1番目を3番目の下へ
    final target = t.getBottomRight(find.byKey(ValueKey('padmin-${before[2]}')));
    await dragHandle(t, before[0], target - const Offset(0, 5));
    final after = idsIn(cat0);
    expect(after.sublist(0, 3), [before[1], before[2], before[0]]);
    expect(after.sublist(3), before.sublist(3));
    // 別のカテゴリ（2番目のカテゴリの最初の商品の下）へ
    final cat1 = s.categories[1];
    final first1 = idsIn(cat1).first;
    final moving = after.last;
    await t.ensureVisible(find.byKey(ValueKey('padmin-$first1')));
    await t.pumpAndSettle();
    await t.ensureVisible(find.byKey(ValueKey('phandle-$moving')));
    await t.pumpAndSettle();
    final to = t.getBottomRight(find.byKey(ValueKey('padmin-$first1')));
    await dragHandle(t, moving, to - const Offset(0, 5));
    expect(s.products.firstWhere((p) => p['id'] == moving)['category'], cat1);
    expect(idsIn(cat1).sublist(0, 2), [first1, moving]);
    expect(find.textContaining('に移しました'), findsOneWidget);
    await t.pump(const Duration(seconds: 3));
  });
}
