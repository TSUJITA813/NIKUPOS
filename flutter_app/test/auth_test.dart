import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/auth.dart';

void main() {
  test('PBKDF2 が Node.js（Web版の WebCrypto と同じ方式）と一致', () {
    final cases = jsonDecode(File('test/fixtures/pbkdf2.json').readAsStringSync()) as List;
    for (final c in cases) {
      expect(pbkdf2Hex(c[0] as String, c[1] as String, c[2] as int), c[3], reason: '${c[0]} / ${c[2]}回');
    }
  });

  test('回復用コード・ID・失敗回数', () {
    final code = newRecoveryCode();
    expect(RegExp(r'^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$').hasMatch(code), true);
    expect(normCode(code.toLowerCase().replaceAll('-', ' ')), code.replaceAll('-', ''));
    expect(validId('Tenshu'), true);
    expect(validId('ab'), false);
    expect(validId('店主'), false);
    final f = FailCounter(0, 0);
    final now = DateTime(2026, 11, 13, 10);
    for (var i = 0; i < 4; i++) {
      f.addFail(now);
    }
    expect(f.lockedFor(now), Duration.zero);
    f.addFail(now);
    expect(f.lockedFor(now), const Duration(minutes: 1));
    f.addFail(now);
    expect(f.lockedFor(now), const Duration(minutes: 2));
  });
}
