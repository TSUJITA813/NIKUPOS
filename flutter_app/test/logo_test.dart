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

  test('ロゴの大きさ：縦長は高さをおさえ、横長は幅をおさえる（見た目の量をそろえる）', () {
    Uint8List png(int w, int h) => Uint8List.fromList(img.encodePng(img.Image(width: w, height: h, numChannels: 1)));
    const paper = 300.0;
    final tall = logoBox(png(120, 260), paper); // 縦長（看板の文字など）
    expect(tall.h, closeTo(90, 0.01)); // 紙の幅の30%まで
    expect(tall.w, closeTo(90 * 120 / 260, 0.01));
    final wide = logoBox(png(384, 96), paper); // 横長
    expect(wide.w <= 210.01, true); // 紙の幅の70%まで
    expect(wide.w / wide.h, closeTo(4, 0.01));
    final sq = logoBox(png(200, 200), paper);
    expect(sq.w, closeTo(sq.h, 0.01));
    expect(sq.h <= 90.01, true);
    // 小さめ・大きめ
    expect(logoBox(png(120, 260), paper, scale: 0.6).h < tall.h, true);
    expect(logoBox(png(120, 260), paper, scale: 1.5).h > tall.h, true);
  });
}
