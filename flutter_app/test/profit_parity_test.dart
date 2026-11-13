import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/calc.dart';
import 'package:nikupos/core/profit.dart';

/// Web版（js/profit.js）と同じ利益になることを、400件の売上で確かめる
void main() {
  final d = jsonDecode(File('test/fixtures/profit_cases.json').readAsStringSync()) as Map<String, dynamic>;
  List<Json> list(String k) => (d[k] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  Map<String, Object> pick(ProfitResult r, Period p) => {
        'sales': r.sales, 'excl': jsRound(r.excl), 'tax': r.tax, 'count': r.count, 'cost': jsRound(r.cost),
        'covered': jsRound(r.covered), 'uncovered': jsRound(r.uncovered), 'gross': r.gross, 'grossEst': r.grossEst,
        'expenses': r.expenses, 'fixed': r.fixed, 'profit': r.profit,
        'buckets': [for (final k in bucketKeys(p)) [k.toString(), jsRound(r.buckets[k]!.excl), jsRound(r.buckets[k]!.cost), r.buckets[k]!.gross, r.buckets[k]!.count]],
      };
  for (final c in (d['out'] as List)) {
    test('${c['kind']} ${c['label']}', () {
      final p = period(c['kind'] as String, c['base'] as String, c['off'] as int);
      expect([p.from, p.to, p.label], [c['from'], c['to'], c['label']]);
      final r = computeProfit(sales: list('sales'), cashmoves: list('cashmoves'), products: list('products'), fixedCosts: list('fixedCosts'), p: p);
      expect(pick(r, p), c['all']);
      final ru = computeProfit(sales: list('sales'), cashmoves: list('cashmoves'), products: list('products'), fixedCosts: list('fixedCosts'), p: p,
          until: DateTime.parse(c['until'] as String), fixedUntil: '2026-11-12');
      expect(pick(ru, p), c['upto']);
    });
  }
  test('前の期間（同じところまで）', () {
    final prev = previousPeriod(period('month', '2026-03-31'), DateTime(2026, 3, 31, 12));
    expect(prev.period.from, '2026-02-01');
    expect(prev.until!.isAfter(DateTime(2026, 2, 28, 23, 59, 59)), false);
    expect(previousPeriod(period('day', '2026-11-12'), DateTime(2026, 11, 12, 15)).period.from, '2026-11-05');
  });
}
