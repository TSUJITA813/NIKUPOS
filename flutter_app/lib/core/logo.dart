// レシートのロゴマーク：選んだ画像を、レシートプリンターで印字しやすい白黒の小さな画像にする

import 'dart:convert';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// レシートプリンター（80mm 用紙）で印字できる横幅の点の数
const logoMaxWidth = 384;
const logoMaxHeight = 200;

/// 濃さ（白と黒の境目）
const logoDarkness = {'light': 0.40, 'normal': 0.55, 'dark': 0.72};

/// 画像 → 白黒の PNG（base64 の文字）。読めない画像なら null
String? makeLogo(({Uint8List bytes, String darkness}) a) {
  final src = img.decodeImage(a.bytes);
  if (src == null) return null;
  var im = src;
  if (im.width > logoMaxWidth) im = img.copyResize(im, width: logoMaxWidth, interpolation: img.Interpolation.average);
  if (im.height > logoMaxHeight) im = img.copyResize(im, height: logoMaxHeight, interpolation: img.Interpolation.average);
  final th = logoDarkness[a.darkness] ?? 0.55;
  final out = img.Image(width: im.width, height: im.height, numChannels: 1);
  for (final p in im) {
    // 透明な所は白として扱う
    final alpha = im.hasAlpha ? p.aNormalized.toDouble() : 1.0;
    final lum = p.luminanceNormalized.toDouble() * alpha + (1 - alpha);
    out.setPixelR(p.x, p.y, lum < th ? 0 : 255);
  }
  return base64Encode(img.encodePng(trimWhite(out), level: 9));
}

/// まわりの余白（白い所）を切り落とす
img.Image trimWhite(img.Image im) {
  var top = im.height, bottom = -1, left = im.width, right = -1;
  for (final p in im) {
    if (p.r == 0) {
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
    }
  }
  if (bottom < 0) return im; // 真っ白
  return img.copyCrop(im, x: left, y: top, width: right - left + 1, height: bottom - top + 1);
}
