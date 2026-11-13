// ignore_for_file: avoid_print
// Web版との互換のテスト（ふだんは動かさない）。テストサーバーを先に起こしておく：
//   node ../tools/mock-firebase.js 9199
//   XCOMPAT=push flutter test test/xcompat_test.dart   … Flutter版から送る
//   （Web版でつないで確かめ、Web版で会計する）
//   XCOMPAT=pull flutter test test/xcompat_test.dart   … Web版の会計が Flutter版に届くか
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/calc.dart';
import 'package:nikupos/core/store.dart';
import 'package:nikupos/core/sync.dart';

void main() {
  final mode = Platform.environment['XCOMPAT'];
  const base = 'http://127.0.0.1:9199';
  const proj = 'xcompat';
  setUp(() => deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i));

  Future<AppState> dev(String code) async {
    final s = AppState(Store(MemoryBackend()));
    await s.init();
    s.settings['deviceCode'] = code;
    await s.saveSettings();
    s.attachSync((st) => CloudSync(st.store, onRemote: st.remoteChanged, onStatus: st.remoteChanged)..useTestServer(base));
    s.sync!.stop();
    await s.sync!.connect(apiKey: 'test-key', projectId: proj, email: 'shop@example.com', password: 'pass1234');
    s.sync!.stop();
    return s;
  }

  test('Flutter版から送る', () async {
    final a = await dev('F');
    await a.registerAdmin('tenshu', 'toriniku2026');
    a.settings['storeName'] = 'とり正（Flutterから）';
    await a.saveSettings();
    final p = a.products.firstWhere((x) => x['id'] == 'p11');
    a.addToCart(p);
    a.addToCart(p);
    await a.completeSale(payments(240, 0, 'cash', 1000), '');
    await a.saveReservation({'name': 'Flutter太郎', 'channel': 'phone', 'phone': '09000000000', 'date': localDate(DateTime.now()), 'time': '17:00',
      'items': [{'productId': 'p1', 'name': 'もも肉', 'unit': 'g', 'price': 158, 'qty': 1000, 'taxRate': 8}], 'deposit': 0, 'depositMethod': 'cash'});
    await a.sync!.syncNow();
    expect(a.sync!.pending, 0);
  }, skip: mode != 'push');

  test('Web版の会計が届く', () async {
    final b = await dev('G');
    final web = b.store.sales.where((s) => (s['noLabel'] as String).startsWith('W-')).toList();
    print('WEB_SALES ${web.map((s) => '${s['noLabel']}:${s['totals']['total']}').join(',')}');
    print('SALES ${b.store.sales.length} RESV ${b.reservations.length} STORE ${b.settings['storeName']}');
    expect(web, isNotEmpty);
  }, skip: mode != 'pull');
}
