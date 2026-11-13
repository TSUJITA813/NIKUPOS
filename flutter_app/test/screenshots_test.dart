// 画面の見た目を確かめるための画像を作る（ふだんのテストでは動かさない）
//   SCREENSHOTS=1 flutter test test/screenshots_test.dart --update-goldens
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/store.dart';
import 'package:nikupos/main.dart';

import 'app_flow_test.dart' show tapKey, typeNumber, confirmPay;

Future<void> loadFont(String family, String path) async {
  final bytes = File(path).readAsBytesSync();
  await (FontLoader(family)..addFont(Future.value(ByteData.view(bytes.buffer)))).load();
}

void main() {
  final on = Platform.environment['SCREENSHOTS'] == '1';
  setUpAll(() async {
    if (!on) return;
    await loadFont('Roboto', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf');
    await loadFont('MaterialIcons', '/opt/sdk/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  });
  setUp(() => deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i));

  Future<AppState> start(WidgetTester t, Size size) async {
    t.view.physicalSize = size;
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final s = AppState(Store(MemoryBackend()));
    await t.runAsync(s.init);
    await t.pumpWidget(NikuposApp(state: s));
    await t.pumpAndSettle();
    return s;
  }

  Future<void> shot(WidgetTester t, String name) async {
    await t.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('shots/$name.png'));
  }

  testWidgets('スマホ', (t) async {
    final s = await start(t, const Size(390, 844));
    await tapKey(t, 'product-p1');
    await typeNumber(t, '500');
    await shot(t, 'phone_weight');
    await tapKey(t, 'numOk');
    await tapKey(t, 'product-p11');
    await tapKey(t, 'product-p11');
    await shot(t, 'phone_register');
    await tapKey(t, 'openCart');
    await shot(t, 'phone_cart');
    await t.tap(find.text('閉じる ▼'));
    await t.pumpAndSettle();
    await tapKey(t, 'payMini');
    await t.tap(find.text('併用'));
    await t.pumpAndSettle();
    await typeNumber(t, '500');
    await t.tap(find.text('お預かり'));
    await t.pumpAndSettle();
    await shot(t, 'phone_pay_split');
    await tapKey(t, 'quick-1000');
    await confirmPay(t);
    await shot(t, 'phone_done');
    await tapKey(t, 'nextCustomer');
    await shot(t, 'phone_next_customer');
    await t.tap(find.text('売上'));
    await shot(t, 'phone_sales');
    await t.tap(find.text('管理'));
    await shot(t, 'phone_admin_register');
    await t.enterText(find.byKey(const ValueKey('authId')), 'tenshu');
    await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
    await t.enterText(find.byKey(const ValueKey('authPw2')), 'toriniku2026');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('recoveryOk')));
    await t.pumpAndSettle();
    await t.tap(find.text('設定'));
    await t.pumpAndSettle();
    await t.drag(find.byType(ListView).last, const Offset(0, -260));
    await shot(t, 'phone_settings_sound');
    await t.tap(find.text('レジ'));
    await t.pumpAndSettle();
    await s.setLayoutMode(LayoutMode.tablet);
    await t.tap(find.text('レジ'));
    await shot(t, 'phone_forced_tablet');
    await t.pump(const Duration(seconds: 3));
  }, skip: !on);

  testWidgets('予約（電話）', (t) async {
    final s = await start(t, const Size(390, 844));
    final today = DateTime.now();
    String d(int n) { final x = DateTime(today.year, today.month, today.day + n); return '${x.year}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}'; }
    await s.saveReservation({'name': '山田', 'channel': 'phone', 'phone': '090-1234-5678', 'date': d(-10), 'time': '16:00', 'items': [
      {'productId': 'p1', 'name': 'もも肉', 'unit': 'g', 'price': 158, 'qty': 1500, 'taxRate': 8},
      {'productId': 'p11', 'name': '焼き鳥 もも', 'unit': 'pc', 'price': 120, 'qty': 10, 'taxRate': 8},
    ], 'deposit': 0, 'depositMethod': 'cash'});
    await s.saveReservation({'name': '居酒屋とりまる', 'channel': 'fax', 'fax': '03-9999-0001', 'date': d(0), 'time': '15:30', 'items': [
      {'productId': 'p13', 'name': 'つくね', 'unit': 'pc', 'price': 140, 'qty': 40, 'taxRate': 8},
    ], 'deposit': 2000, 'depositMethod': 'cash', 'depositDate': d(-1), 'note': '串に刺した状態で'});
    await s.saveReservation({'name': '佐藤', 'channel': 'phone', 'phone': '080-2222-3333', 'date': d(0), 'time': '17:00', 'items': [
      {'productId': 'p4', 'name': '手羽先', 'unit': 'g', 'price': 118, 'qty': 2000, 'taxRate': 8},
    ], 'deposit': 0, 'depositMethod': 'cash', 'status': 'ready'});
    await t.tap(find.byKey(const ValueKey('nav-予約')));
    await shot(t, 'phone_resv_list');
    await tapKey(t, 'newPhone');
    await t.enterText(find.byKey(const ValueKey('rPhone')), '09012345678');
    await t.pumpAndSettle();
    await tapKey(t, 'sameAsLast');
    await shot(t, 'phone_resv_form');
    await t.pump(const Duration(seconds: 3));
  }, skip: !on);

  testWidgets('タブレット', (t) async {
    final s = await start(t, const Size(1280, 800));
    for (final p in s.products) {
      if (p['id'] == 'p1') p['cost'] = 900;
      if (p['id'] == 'p11') p['cost'] = 50;
      if (p['id'] == 'p2') p['cost'] = 520;
    }
    for (final pid in ['product-p11', 'product-p11', 'product-p12']) {
      await tapKey(t, pid);
    }
    await tapKey(t, 'product-p2');
    await typeNumber(t, '1200');
    await tapKey(t, 'numOk');
    await shot(t, 'tablet_register');
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    await tapKey(t, 'nextCustomer');
    await tapKey(t, 'product-p10');
    await typeNumber(t, '300');
    await tapKey(t, 'numOk');
    await tapKey(t, 'payBtn');
    await t.tap(find.text('キャッシュレス'));
    await t.pumpAndSettle();
    await confirmPay(t);
    await tapKey(t, 'nextCustomer');
    await t.tap(find.text('管理'));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const ValueKey('authId')), 'tenshu');
    await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
    await t.enterText(find.byKey(const ValueKey('authPw2')), 'toriniku2026');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    await shot(t, 'tablet_recovery');
    await tapKey(t, 'recoveryOk');
    await shot(t, 'tablet_dashboard');
    await t.tap(find.text('設定'));
    await shot(t, 'tablet_settings');
    await t.tap(find.text('商品・価格'));
    await shot(t, 'tablet_products');
    await t.pump(const Duration(seconds: 3));
  }, skip: !on);

  testWidgets('レジ締め・端末の設定', (t) async {
    final s = await start(t, const Size(390, 844));
    s.settings['floatDefault'] = 10000;
    s.settings['zip'] = '123-4567';
    s.settings['address'] = '東京都鶏町1-2-3';
    await tapKey(t, 'product-p11');
    await tapKey(t, 'payMini');
    await t.tap(find.byKey(const ValueKey('choice-cashless')));
    await t.pumpAndSettle();
    await confirmPay(t);
    await t.tap(find.text('レシートを見る'));
    await shot(t, 'phone_receipt');
    await t.tap(find.text('閉じる'));
    await tapKey(t, 'nextCustomer');
    await t.pump(const Duration(seconds: 3));
    await t.tap(find.byKey(const ValueKey('nav-売上')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('choice-cash')));
    await shot(t, 'phone_cashmoves');
    await tapKey(t, 'cm-out');
    await shot(t, 'phone_cashmove_dialog');
    await t.tap(find.text('キャンセル'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('choice-close')));
    await shot(t, 'phone_closing');
    await t.drag(find.byType(Scrollable).first, const Offset(0, -700));
    await shot(t, 'phone_closing2');
    await t.drag(find.byType(Scrollable).first, const Offset(0, -900));
    await shot(t, 'phone_closing3');
    await t.tap(find.byKey(const ValueKey('deviceSettings')));
    await shot(t, 'phone_device_settings');
  }, skip: !on);
}
