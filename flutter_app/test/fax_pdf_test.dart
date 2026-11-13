import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikupos/core/fax_pdf.dart';
import 'package:nikupos/core/store.dart';
import 'package:pdf/widgets.dart' as pw;

/// FAX用の書類（PDF）が作れること。PDF_OUT を指定すると、そのフォルダに書き出す（見た目の確認用）
void main() {
  final font = pw.Font.ttf(ByteData.view(File('assets/fonts/ipag.ttf').readAsBytesSync().buffer));
  final settings = {...defaultSettings(), 'storeName': '鶏肉の店', 'address': '東京都○○区△△1-2-3', 'tel': '03-1234-5678', 'fax': '03-1234-5679', 'invoiceNo': 'T1234567890123'};
  final r = <String, dynamic>{
    'id': 'R1', 'no': 7, 'noLabel': '7', 'name': '居酒屋とりまる', 'phone': '03-9999-0000', 'fax': '03-9999-0001', 'channel': 'fax',
    'date': '2026-11-20', 'time': '16:00', 'deposit': 1000, 'depositMethod': 'cash', 'note': '手羽元は半分に切ってください', 'status': 'reserved',
    'items': [
      {'productId': 'p1', 'name': 'もも肉', 'unit': 'g', 'price': 158, 'qty': 2000, 'taxRate': 8},
      {'productId': 'p11', 'name': '焼き鳥 もも', 'unit': 'pc', 'price': 120, 'qty': 30, 'taxRate': 8},
      {'productId': 'p18', 'name': 'その他食品', 'unit': 'open', 'price': 1500, 'qty': 1, 'taxRate': 8},
    ],
  };

  test('ご予約確認書とFAX注文用紙', () async {
    final conf = await reservationConfirmationPdf(r, settings, 'floor', font, now: DateTime(2026, 11, 13));
    final form = await faxOrderFormPdf(settings, defaultProducts(), (settings['categories'] as List).cast<String>(), font);
    for (final b in [conf, form]) {
      expect(String.fromCharCodes(b.take(5)), '%PDF-');
      expect(b.length, greaterThan(5000));
    }
    final out = Platform.environment['PDF_OUT'];
    if (out != null) {
      File('$out/confirmation.pdf').writeAsBytesSync(conf);
      File('$out/order_form.pdf').writeAsBytesSync(form);
    }
  });
}
