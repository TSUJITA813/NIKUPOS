// 縦長のロゴを入れたレシートの PDF を作る（見た目の確認用。LOGOPDF=出力先 のときだけ）
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:nikupos/core/logo.dart';
import 'package:nikupos/core/receipt.dart';
import 'package:nikupos/core/receipt_pdf.dart';
import 'package:pdf/widgets.dart' as pw;

void main() {
  final out = Platform.environment['LOGOPDF'];
  test('縦長ロゴのレシート', () async {
    final src = img.Image(width: 300, height: 700);
    img.fill(src, color: img.ColorRgb8(255, 255, 255));
    img.fillRect(src, x1: 60, y1: 20, x2: 240, y2: 320, color: img.ColorRgb8(0, 0, 0));
    img.fillCircle(src, x: 150, y: 520, radius: 140, color: img.ColorRgb8(0, 0, 0));
    final logo = makeLogo((bytes: Uint8List.fromList(img.encodePng(src)), darkness: 'normal'))!;
    final font = pw.Font.ttf(ByteData.view(File('assets/fonts/ipag.ttf').readAsBytesSync().buffer));
    for (final size in ['small', 'normal', 'large']) {
      final st = {'storeName': '鶏肉の店', 'zip': '103-0007', 'address': '東京都中央区日本橋浜町1丁目1-1', 'tel': '03-1234-5678', 'logo': logo, 'logoSize': size};
      final lines = [...storeHeader(st), const RLine('領収書', center: true), const RLine.hr(), const RLine('※むね肉', right: '¥196'), const RLine('合計', right: '¥196', big: true, bold: true)];
      final bytes = await receiptPdf(lines, font);
      File('$out/receipt_$size.pdf').writeAsBytesSync(bytes);
    }
    expect(base64Decode(logo).isNotEmpty, true);
  }, skip: out == null);
}
