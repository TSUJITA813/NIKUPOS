// クラウド同期のテスト。開発用のテストサーバー（tools/mock-firebase.js：Firebase のしくみを真似たもの）を使う
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/app_state.dart';
import 'package:nikupos/core/auth.dart';
import 'package:nikupos/core/calc.dart';
import 'package:nikupos/core/store.dart';
import 'package:nikupos/core/sync.dart';

late Process server;
late String base;
var projectSeq = 0;

Future<AppState> device(String code) async {
  final s = AppState(Store(MemoryBackend()));
  await s.init();
  s.settings['deviceCode'] = code;
  await s.saveSettings();
  s.attachSync((st) => CloudSync(st.store, onRemote: st.remoteChanged, onStatus: st.remoteChanged)..useTestServer(base));
  s.sync!.stop();
  return s;
}

Future<void> connect(AppState s, String project, {bool cloudOnly = false}) async {
  s.sync!.useTestServer(base);
  await s.sync!.connect(apiKey: 'test-key', projectId: project, email: 'shop@example.com', password: 'pass1234', cloudOnly: cloudOnly);
  s.sync!.stop();
}

Future<void> settle(List<AppState> ds) async {
  for (var i = 0; i < 3; i++) {
    for (final d in ds) {
      await d.sync!.syncNow();
      d.sync!.stop();
    }
  }
}

Future<Json> sell(AppState s, String pid, {num? qty}) async {
  final p = s.products.firstWhere((x) => x['id'] == pid);
  s.addToCart(p, qty: qty);
  final t = s.cartTotals.total;
  return s.completeSale(payments(t, s.cartDeposit, 'cash', t), '');
}

void main() {
  setUpAll(() async {
    deriveImpl = (p, s, i) async => pbkdf2Hex(p, s, i);
    final port = 9300 + DateTime.now().millisecond % 500;
    base = 'http://127.0.0.1:$port';
    server = await Process.start('node', ['../tools/mock-firebase.js', '$port']);
    final ready = Completer<void>();
    server.stdout.transform(utf8.decoder).listen((l) { if (!ready.isCompleted && l.contains('mock firebase')) ready.complete(); });
    await ready.future.timeout(const Duration(seconds: 10));
  });
  tearDownAll(() => server.kill());

  String project() => 'flutter-test-${DateTime.now().millisecondsSinceEpoch}-${projectSeq++}';

  test('2台で売上・予約・商品・設定・管理者を共有する', () async {
    final proj = project();
    final a = await device('A');
    // A：管理者を登録（まだクラウドにつないでいない）・原価と価格を変更・売上・予約
    await a.registerAdmin('tenshu', 'toriniku2026');
    final momo = a.products.firstWhere((p) => p['id'] == 'p1');
    momo['price'] = 168;
    momo['cost'] = 900;
    await a.saveProduct(momo);
    a.settings['storeName'] = '鳥正';
    await a.saveSettings();
    final sale = await sell(a, 'p11');
    await a.saveReservation({'name': '山田', 'channel': 'phone', 'phone': '09011112222', 'date': '2026-11-20', 'time': '16:00',
      'items': [{'productId': 'p1', 'name': 'もも肉', 'unit': 'g', 'price': 168, 'qty': 1000, 'taxRate': 8}], 'deposit': 500, 'depositMethod': 'cash'});
    await connect(a, proj);
    expect(a.sync!.state, SyncState.idle);
    expect(a.sync!.pending, 0);

    // B：新しい端末でつなぐ → Aのデータが届く
    final b = await device('B');
    await connect(b, proj);
    expect(b.store.sales.single['id'], sale['id']);
    expect(b.store.sales.single['noLabel'], 'A-1');
    expect(b.reservations.single['name'], '山田');
    expect(b.products.firstWhere((p) => p['id'] == 'p1')['price'], 168);
    expect(b.products.firstWhere((p) => p['id'] == 'p1')['cost'], 900);
    expect(b.settings['storeName'], '鳥正');
    expect(b.settings['deviceCode'], 'B'); // 端末ごとの設定は共有しない
    expect(await b.login('tenshu', 'toriniku2026'), isNull); // Aで登録した管理者でログインできる

    // B で売上・価格変更 → A に届く
    final sale2 = await sell(b, 'p12');
    final ne = b.products.firstWhere((p) => p['id'] == 'p12');
    ne['price'] = 150;
    await b.saveProduct(ne);
    await settle([b, a]);
    expect(a.store.sales.map((x) => x['noLabel']).toSet(), {'A-1', 'B-1'});
    expect(a.store.sales.firstWhere((x) => x['id'] == sale2['id'])['totals']['total'], 130);
    expect(a.products.firstWhere((p) => p['id'] == 'p12')['price'], 150);

    // 商品の削除も届く
    await a.deleteProduct('p19');
    await settle([a, b]);
    expect(b.products.any((p) => p['id'] == 'p19'), false);
  });

  test('両方の端末で同じ予約を変えたら、後から変えた方になる（古い変更で上書きしない）', () async {
    final proj = project();
    final a = await device('A');
    final b = await device('B');
    await connect(a, proj);
    final r = await a.saveReservation({'name': '佐藤', 'channel': 'fax', 'fax': '0311112222', 'date': '2026-11-21', 'time': '', 'items': <Json>[], 'deposit': 0, 'depositMethod': 'cash'});
    await settle([a]);
    await connect(b, proj);
    // A がオフラインで先にメモを変える（まだ送らない）
    final ra = a.reservations.firstWhere((x) => x['id'] == r['id']);
    ra['note'] = 'Aのメモ（古い）';
    await a.store.put('reservations', ra);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    // B が後から変えて送る
    final rb = b.reservations.firstWhere((x) => x['id'] == r['id']);
    rb['note'] = 'Bのメモ（新しい）';
    await b.store.put('reservations', rb);
    await settle([b]);
    // A がつながる → 自分の古い変更を送ってしまっても、受け取ったときに新しい方に直して送り直す
    await settle([a, b, a, b]);
    expect(a.reservations.firstWhere((x) => x['id'] == r['id'])['note'], 'Bのメモ（新しい）');
    expect(b.reservations.firstWhere((x) => x['id'] == r['id'])['note'], 'Bのメモ（新しい）');
  });

  test('あとから同期につないだ端末の仮の管理者は、お店の管理者に置き換わる', () async {
    final proj = project();
    final shop = await device('A');
    await shop.registerAdmin('tenshu', 'toriniku2026');
    await connect(shop, proj);
    final tablet = await device('B');
    await tablet.registerAdmin('temp', 'temppass1');
    expect(tablet.settings['adminsLocal'], true);
    await connect(tablet, proj);
    await settle([tablet, shop]);
    expect(tablet.admins.map((a) => a['id']), ['tenshu']);
    expect(shop.admins.map((a) => a['id']), ['tenshu']);
    expect(await tablet.login('temp', 'temppass1'), isNotNull);
    expect(await tablet.login('tenshu', 'toriniku2026'), isNull);
  });

  test('「この端末のデータは使わない」でつなぐと、クラウドのデータに合わせる', () async {
    final proj = project();
    final a = await device('A');
    await sell(a, 'p11');
    await connect(a, proj);
    final b = await device('B');
    await sell(b, 'p13'); // B だけの売上（送らない）
    await connect(b, proj, cloudOnly: true);
    await settle([b, a]);
    expect(b.store.sales.single['noLabel'], 'A-1');
    expect(a.store.sales.length, 1);
  });

  test('間違ったパスワード・つながらないとき', () async {
    final a = await device('A');
    expect(() => a.sync!.checkLogin('test-key', 'shop@example.com', 'wrong'), throwsA(isA<SyncError>()));
    a.sync!.useTestServer('http://127.0.0.1:1'); // 誰も待っていない
    await expectLater(a.sync!.checkLogin('test-key', 'shop@example.com', 'pass1234'), throwsA(anything));
  });

  test('Web版と同じ保存形式（shops/ユーザーID/records/種類~ID）', () async {
    final proj = project();
    final a = await device('A');
    await connect(a, proj);
    final sale = await sell(a, 'p11');
    await settle([a]);
    // サーバーのデータを直接読む
    final login = jsonDecode((await HttpClient().postUrl(Uri.parse('$base/v1/accounts:signInWithPassword?key=test-key')).then((r) {
      r.headers.contentType = ContentType.json;
      r.write(jsonEncode({'email': 'shop@example.com', 'password': 'pass1234', 'returnSecureToken': true}));
      return r.close();
    }).then((res) => res.transform(utf8.decoder).join()))) as Map;
    final req = await HttpClient().postUrl(Uri.parse('$base/v1/projects/$proj/databases/(default)/documents/shops/shopUid001:runQuery'));
    req.headers.set('Authorization', 'Bearer ${login['idToken']}');
    req.headers.contentType = ContentType.json;
    req.write(jsonEncode({'structuredQuery': {'from': [{'collectionId': 'records'}], 'orderBy': [{'field': {'fieldPath': '_u'}, 'direction': 'ASCENDING'}]}}));
    final rows = jsonDecode(await (await req.close()).transform(utf8.decoder).join()) as List;
    final names = rows.map((r) => (r['document']['name'] as String).split('/records/').last).toSet();
    expect(names.contains('sales~${sale['id']}'), true);
    expect(names.contains('config~shared'), true);
    expect(names.contains('products~p1'), true);
    final rec = rows.firstWhere((r) => (r['document']['name'] as String).endsWith('sales~${sale['id']}'))['document']['fields'] as Map;
    expect(rec['col']['stringValue'], 'sales');
    expect(rec['dev']['stringValue'], 'A');
    expect(rec['del']['booleanValue'], false);
    final d = jsonDecode(rec['d']['stringValue'] as String) as Map;
    expect(d['totals']['total'], 120);
    expect(RegExp(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$').hasMatch(d['_m'] as String), true); // Web版と同じ時刻の形
  });
}
