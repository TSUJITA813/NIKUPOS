import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/receipt.dart';
import 'package:nikupos/core/store.dart';

import 'app_flow_test.dart' show boot, tapKey, typeNumber, confirmPay, reveal;

List<Json> _l(Object? v) => ((v as List?) ?? const []).cast<Json>();

void main() {
  setUp(() => deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i));

  test('あるべき現金の計算が Web版と同じ（60通り）', () {
    final cases = (jsonDecode(File('test/fixtures/drawer.json').readAsStringSync()) as List).cast<Json>();
    for (final c in cases) {
      final d = c['data'] as Json;
      final r = drawerSummary(
        sales: _l(d['sales']),
        reservations: _l(d['reservations']),
        cashmoves: _l(d['cashmoves']),
        slips: _l(d['slips']),
        receipts: _l(d['receipts']),
        date: c['date'] as String,
        dev: c['dev'] as String?,
      );
      final e = c['expect'] as Json;
      final got = {
        'expected': r.float + r.drawerCash,
        'float': r.float,
        'drawerCash': r.drawerCash,
        'cash': r.sum.cash,
        'total': r.sum.total,
        'cashIn': r.cashIn,
        'cashOut': r.cashOut,
        'depositInCash': r.depositInCash,
        'depositRefundCash': r.depositRefundCash,
        'wholesaleCash': r.wholesaleCash,
        'cashlessBy': r.sum.cashlessBy,
      };
      expect(got, e, reason: 'date=${c['date']} dev=${c['dev']}');
    }
  });

  test('金種の合計・準備金の初期値・郵便番号', () {
    expect(countCash({'10000': 1, '1000': 3, '100': 4, '5': 2, '1': 1}), 13411);
    expect(defaultFloat(cashmoves: [], closings: [], date: '2026-11-02', dev: 'A', setting: 30000), (amount: 30000, from: '端末の設定'));
    final closings = [
      {'date': '2026-11-01', 'dev': 'A', 'at': '2026-11-01T12:00:00.000Z', 'keep': 25000},
      {'date': '2026-11-01', 'dev': 'B', 'at': '2026-11-01T13:00:00.000Z', 'keep': 9000},
    ];
    expect(defaultFloat(cashmoves: [], closings: closings, date: '2026-11-02', dev: 'A', setting: 30000).amount, 25000);
    final moves = [{'date': '2026-11-02', 'dev': 'A', 'kind': 'float', 'amount': 27000, 'at': '2026-11-02T00:00:00.000Z'}];
    expect(defaultFloat(cashmoves: moves, closings: closings, date: '2026-11-02', dev: 'A', setting: 30000).amount, 27000);
    expect(normZip('１２３４５６７'), '123-4567');
    expect(normZip('123-4567'), '123-4567');
    expect(addressLine({'zip': '123-4567', 'address': '東京都'}), '〒123-4567 東京都');
    expect(addressLine({'zip': '', 'address': '東京都'}), '東京都');
  });

  testWidgets('入出金とレジ締め：準備金・出金・会計 → 数えて精算、記録が残る', (t) async {
    final s = await boot(t, const Size(1280, 900));
    s.settings['floatDefault'] = 10000;
    // 会計：焼き鳥 120 を現金で
    await tapKey(t, 'product-p11');
    await tapKey(t, 'payBtn');
    await tapKey(t, 'quick-exact');
    await confirmPay(t);
    await tapKey(t, 'nextCustomer');
    await t.pump(const Duration(seconds: 3));

    await t.tap(find.text('売上'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('choice-cash')));
    await t.pumpAndSettle();
    // 出金 500（消耗品費）
    await tapKey(t, 'cm-out');
    await typeNumber(t, '500');
    await t.tap(find.byKey(const ValueKey('cmOk')));
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await t.pumpAndSettle();
    final m = s.cashmoves.single;
    expect(m['kind'], 'out');
    expect(m['amount'], 500);
    expect(m['account'], '消耗品費');
    expect(m['taxRate'], 10);
    await t.pump(const Duration(seconds: 3));

    await t.tap(find.byKey(const ValueKey('choice-close')));
    await t.pumpAndSettle();
    // あるべき現金 = 10,000 + 120 - 500 = 9,620
    expect(find.text('¥9,620'), findsWidgets);
    await reveal(t, find.byKey(const ValueKey('den-1000')));
    await t.enterText(find.byKey(const ValueKey('den-1000')), '9');
    await t.enterText(find.byKey(const ValueKey('den-500')), '1');
    await t.enterText(find.byKey(const ValueKey('den-100')), '1');
    await t.enterText(find.byKey(const ValueKey('den-10')), '2');
    await t.pumpAndSettle();
    expect(find.text('±0円'), findsWidgets);
    await reveal(t, find.byKey(const ValueKey('keep')));
    await t.enterText(find.byKey(const ValueKey('keep')), '8000');
    await tapKey(t, 'closeDo');
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await t.pumpAndSettle();
    final c = s.closings.single;
    expect(c['expected'], 9620);
    expect(c['counted'], 9620);
    expect(c['diff'], 0);
    expect(c['keep'], 8000);
    expect(c['denoms'], {'1000': 9, '500': 1, '100': 1, '10': 2});
    expect((c['sales'] as Map)['total'], 120);
    expect(c['cashOut'], 500);
    expect(find.text('レジ締めレポート（精算）'), findsOneWidget);
    await tapKey(t, 'reportClose');
    expect(find.textContaining('レジ締め済み'), findsOneWidget);
    // 次の日の準備金は、残した額になる
    final next = localDate(DateTime.now().add(const Duration(days: 1)));
    expect(s.floatOf(next).amount, 8000);
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('この端末の設定はパスワードなしで開け、管理の設定に郵便番号がある', (t) async {
    final s = await boot(t, const Size(390, 844));
    await t.tap(find.byKey(const ValueKey('deviceSettings')));
    await t.pumpAndSettle();
    await reveal(t, find.byKey(const ValueKey('set-floatDefault')));
    await t.enterText(find.byKey(const ValueKey('set-floatDefault')), '30000');
    await t.enterText(find.byKey(const ValueKey('set-deviceCode')), 'A');
    await tapKey(t, 'deviceSave');
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    expect(s.settings['floatDefault'], 30000);
    expect(s.settings['deviceCode'], 'A');
    expect(s.nextNoLabel, 'A-1');
    await t.pump(const Duration(seconds: 3));
    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();

    await t.tap(find.byKey(const ValueKey('nav-管理')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const ValueKey('authId')), 'tenshu');
    await t.enterText(find.byKey(const ValueKey('authPw')), 'toriniku2026');
    await t.enterText(find.byKey(const ValueKey('authPw2')), 'toriniku2026');
    await t.tap(find.byKey(const ValueKey('authSubmit')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('recoveryOk')));
    await t.pumpAndSettle();
    await t.tap(find.text('設定'));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('soundOn')), findsNothing); // 操作音は「この端末の設定」へ移した
    await t.enterText(find.byKey(const ValueKey('set-zip')), '１２３４５６７');
    await t.enterText(find.byKey(const ValueKey('set-address')), '東京都鶏町1-2-3');
    await tapKey(t, 'settingsSave');
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    expect(s.settings['zip'], '123-4567');
    final lines = receiptLines({
      'at': DateTime.now().toUtc().toIso8601String(),
      'no': 1,
      'lines': [],
      'totals': {'subtotal': 0, 'discount': 0, 'total': 0, 'byRate': []},
      'method': 'cash',
    }, s.settings);
    expect(lines.any((l) => l.left == '〒123-4567 東京都鶏町1-2-3'), true);
    expect(sharedSettings.contains('zip') && sharedSettings.contains('logo'), true);
    await t.pump(const Duration(seconds: 3));
  });
}
