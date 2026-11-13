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
    await t.tap(find.text('売上'));
    await shot(t, 'phone_sales');
    await t.tap(find.text('管理'));
    await shot(t, 'phone_admin_register');
    await s.setLayoutMode(LayoutMode.tablet);
    await t.tap(find.text('レジ'));
    await shot(t, 'phone_forced_tablet');
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
}
