import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:nikupos/core/logo.dart';
import 'package:nikupos/core/receipt.dart';

void main() {
  test('ロゴマーク：大きな色つき・透明な画像を、白黒・幅384以内にして余白を切る', () {
    final src = img.Image(width: 1200, height: 600, numChannels: 4);
    img.fill(src, color: img.ColorRgba8(0, 0, 0, 0)); // 透明
    img.fillRect(src, x1: 300, y1: 150, x2: 899, y2: 449, color: img.ColorRgba8(200, 30, 30, 255)); // 赤い四角
    img.fillRect(src, x1: 0, y1: 0, x2: 50, y2: 50, color: img.ColorRgba8(255, 230, 230, 255)); // うすい色（消える）
    final b64 = makeLogo((bytes: Uint8List.fromList(img.encodePng(src)), darkness: 'normal'))!;
    final out = img.decodePng(base64Decode(b64))!;
    expect(out.width <= logoMaxWidth, true);
    expect(out.height <= logoMaxHeight, true);
    // 赤い四角だけが残る（縮小 1200→384 で 600px → 192px 前後）
    expect(out.width, closeTo(192, 3));
    final colors = <num>{};
    for (final p in out) {
      colors.add(p.r);
    }
    expect(colors.difference({0, 255}).isEmpty, true);
    expect(b64.length < 20000, true);
    expect(logoOf({'logo': b64}), isNotNull);
    expect(logoOf({'logo': ''}), isNull);
    expect(storeHeader({'storeName': '店', 'logo': b64}).first.image, isNotNull);
  });

  test('ロゴマーク：画像でないデータは null', () {
    expect(makeLogo((bytes: Uint8List.fromList([1, 2, 3]), darkness: 'normal')), isNull);
  });
}
