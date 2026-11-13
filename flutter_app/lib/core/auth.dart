// 管理者のID・パスワード（Web版と同じ方式：PBKDF2-HMAC-SHA256・21万回）
// パスワードそのものは保存せず、変換した値だけを保存する。Web版のバックアップの管理者もそのまま使える。

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

import 'types.dart';
export 'types.dart';


const pbkdf2Iterations = 210000;

String _hex(List<int> b) => b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

/// PBKDF2-HMAC-SHA256（32バイト）。salt は文字列（UTF-8）
String pbkdf2Hex(String password, String salt, int iterations) {
  final hmac = Hmac(sha256, utf8.encode(password));
  final s = Uint8List.fromList([...utf8.encode(salt), 0, 0, 0, 1]);
  var u = hmac.convert(s).bytes;
  final out = Uint8List.fromList(u);
  for (var i = 1; i < iterations; i++) {
    u = hmac.convert(u).bytes;
    for (var j = 0; j < out.length; j++) {
      out[j] ^= u[j];
    }
  }
  return _hex(out);
}

String _deriveArgs(List<Object> a) => pbkdf2Hex(a[0] as String, a[1] as String, a[2] as int);

/// 計算のしかた。アプリでは画面が止まらないよう別の処理（Isolate）で計算する。
/// 画面のテストでは同じ計算をその場で行う（テスト用の時計の中では別の処理の結果が届かないため）
Future<String> Function(String password, String salt, int iterations) deriveImpl =
    (p, s, i) => compute(_deriveArgs, <Object>[p, s, i]);

Future<String> derive(String password, String salt, [int iterations = pbkdf2Iterations]) => deriveImpl(password, salt, iterations);

final _rand = Random.secure();
String randomHex(int bytes) => _hex(List.generate(bytes, (_) => _rand.nextInt(256)));

/// 比べるときに時間で差が出ないように
bool sameText(String a, String b) {
  if (a.length != b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) {
    r |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return r == 0;
}

String normId(String id) => id.trim().toLowerCase();
bool validId(String id) => RegExp(r'^[a-z0-9_.\-@]{3,}$').hasMatch(normId(id));

/// 回復用コード（紛らわしい 0/O/1/I は使わない）。例：ABCD-EFGH-JKLM
String newRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  final b = StringBuffer();
  for (var i = 0; i < 12; i++) {
    b.write(chars[_rand.nextInt(chars.length)]);
    if (i == 3 || i == 7) b.write('-');
  }
  return b.toString();
}

String normCode(String c) => c.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

Future<Json> makeAccount(String id, String password) async {
  final salt = randomHex(16);
  final h = await derive(password, salt);
  return {'id': normId(id), 'salt': salt, 'hash': h, 'iter': pbkdf2Iterations, 'createdAt': DateTime.now().toUtc().toIso8601String()};
}

Future<bool> checkPassword(Json acc, String password) async {
  final h = await derive(password, acc['salt'] as String, ((acc['iter'] ?? pbkdf2Iterations) as num).toInt());
  return sameText(h, acc['hash'] as String);
}

Future<Json> makeRecovery(String code) async {
  final salt = randomHex(16);
  return {'salt': salt, 'hash': await derive(normCode(code), salt), 'iter': pbkdf2Iterations, 'at': DateTime.now().toUtc().toIso8601String()};
}

Future<bool> checkRecovery(Json rec, String code) async {
  final h = await derive(normCode(code), rec['salt'] as String, ((rec['iter'] ?? pbkdf2Iterations) as num).toInt());
  return sameText(h, rec['hash'] as String);
}

/// ログインの失敗回数（5回続けて間違えたら、1分・2分・4分…最大30分待つ）
class FailCounter {
  int n;
  int until; // ミリ秒
  FailCounter(this.n, this.until);
  factory FailCounter.fromJson(String? s) {
    if (s == null) return FailCounter(0, 0);
    final j = jsonDecode(s) as Json;
    return FailCounter((j['n'] as num).toInt(), (j['until'] as num).toInt());
  }
  String toJson() => jsonEncode({'n': n, 'until': until});
  Duration lockedFor(DateTime now) => Duration(milliseconds: max(0, until - now.millisecondsSinceEpoch));
  void addFail(DateTime now) {
    n++;
    if (n >= 5) until = now.millisecondsSinceEpoch + min(30, pow(2, n - 5).toInt()) * 60000;
  }
  void reset() {
    n = 0;
    until = 0;
  }
}
