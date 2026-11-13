import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/calc.dart';

/// Web版（js/calc.js）と同じ結果になることを、800通りの会計（外税を含む）で確かめる
void main() {
  final data = jsonDecode(File('test/fixtures/calc_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final cases = (data['cases'] as List).cast<Map<String, dynamic>>();

  test('合計・税額・行金額が Web版と一致（${cases.length}通り）', () {
    for (final c in cases) {
      final lines = (c['lines'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      final t = totals(lines, c['discount'] == null ? null : Map<String, dynamic>.from(c['discount'] as Map), c['mode'] as String);
      expect(t.toJson(), c['totals'], reason: jsonEncode(c));
      expect(lines.map((l) => lineAmount(l, c['mode'] as String)).toList(), c['lineAmounts']);
    }
  });

  test('支払い（現金・キャッシュレス・併用・前受金）が Web版と一致', () {
    for (final c in cases) {
      final a = (c['pay']['args'] as List);
      final o = c['pay']['out'] as Map;
      final p = payments(a[0] as int, a[1] as int, a[2] as String, a[3] as int, a[4] as int);
      expect([p.due, p.deposit, p.cash, p.cashless, p.received, p.change, p.refund],
          [o['due'], o['deposit'], o['cash'], o['cashless'], o['received'], o['change'], o['refund']], reason: jsonEncode(c['pay']));
    }
  });

  test('商品の検索が Web版と一致', () {
    for (final s in (data['search'] as List)) {
      expect(matchProduct(Map<String, dynamic>.from(s['p'] as Map), s['q'] as String), s['hit'], reason: jsonEncode(s));
    }
  });
}
