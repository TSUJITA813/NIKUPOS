import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/calc.dart';
import 'package:nikupos/core/reservation.dart';

void main() {
  final d = jsonDecode(File('test/fixtures/reservation_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final rs = (d['R'] as List).map((e) => jsonDecode(jsonEncode(e)) as Json).toList();

  test('仕込み集計・概算金額が Web版と一致', () {
    final p = prepSummary(rs, '2026-11-20');
    final web = d['prep'] as Map;
    expect(p.count, web['count']);
    expect([for (final it in p.items) {'productId': it.productId, 'name': it.name, 'unit': it.unit, 'qty': it.qty, 'reservations': it.reservations}], web['items']);
    expect([for (final r in rs) reservationEstimate(r, 'floor')], d['est']);
  });

  test('電話番号・FAX番号でお客様を探す', () {
    final list = <Json>[
      {'id': 'A', 'name': '山田', 'phone': '090-1234-5678', 'createdAt': '2026-10-01', 'date': '2026-10-02'},
      {'id': 'B', 'name': '山田', 'phone': '09012345678', 'createdAt': '2026-11-01', 'date': '2026-11-02'},
      {'id': 'C', 'name': '居酒屋とりまる', 'phone': '', 'fax': '03-1111-2222', 'createdAt': '2026-11-03', 'date': '2026-11-04'},
    ];
    expect(normPhone('０９０−１２３４−５６７８'), '09012345678');
    expect(findCustomer(list, '090 1234 5678').map((r) => r['id']), ['B', 'A']); // 新しい順
    expect(findCustomer(list, '5678').map((r) => r['id']), ['B', 'A']); // 下4桁でも
    expect(findCustomer(list, '0311112222').single['name'], '居酒屋とりまる'); // FAX番号でも
    expect(findCustomer(list, '12'), isEmpty); // 短すぎるときは探さない
    expect(itemQtyLabel({'unit': 'g', 'qty': 1200}), '1,200g');
    expect(itemQtyLabel({'unit': 'open', 'price': 1000, 'qty': 1}), '金額 ¥1,000');
  });
}
