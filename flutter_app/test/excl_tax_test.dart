import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/calc.dart';

void main() {
  test('外税：むね肉 98円/100g（税抜）× 200g → 196円＋消費税15円＝211円', () {
    final t = totals([
      {'unit': 'g', 'price': 98, 'qty': 200, 'taxRate': 8, 'priceMode': 'excl'},
    ], null, 'floor');
    expect(t.subtotal, 196);
    expect(t.taxExtra, 15);
    expect(t.total, 211);
    expect(t.byRate.single.toJson(), {'rate': 8, 'amount': 211, 'tax': 15});
  });

  test('内税と外税がまざっても、消費税は税率ごとに1回だけ計算する', () {
    final t = totals([
      {'unit': 'pc', 'price': 120, 'qty': 1, 'taxRate': 8}, // 内税 120（うち税 8）
      {'unit': 'pc', 'price': 101, 'qty': 3, 'taxRate': 8, 'priceMode': 'excl'}, // 外税 303 → 税 24
      {'unit': 'pc', 'price': 5, 'qty': 1, 'taxRate': 10, 'priceMode': 'excl'}, // 外税 5 → 税 0
    ], null, 'floor');
    expect(t.taxExtra, 24);
    expect(t.total, 120 + 303 + 5 + 24);
    expect(t.byRate.map((r) => r.toJson()).toList(), [
      {'rate': 8, 'amount': 447, 'tax': 8 + 24},
      {'rate': 10, 'amount': 5, 'tax': 0},
    ]);
  });

  test('外税のない会計は、前の版と同じ結果（前の版で作った答え 500通り）', () {
    final f = Platform.environment['OLD_CALC'];
    if (f == null) return;
    final data = jsonDecode(File(f).readAsStringSync()) as Map<String, dynamic>;
    for (final c in (data['cases'] as List).cast<Map<String, dynamic>>()) {
      final lines = (c['lines'] as List).map((x) => Map<String, dynamic>.from(x as Map)).toList();
      final t = totals(lines, c['discount'] == null ? null : Map<String, dynamic>.from(c['discount'] as Map), c['mode'] as String).toJson()..remove('taxExtra');
      expect(t, c['totals']);
    }
  });
}
