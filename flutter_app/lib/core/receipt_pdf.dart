// レシート・レジ締めレポートを、レシート用紙の幅（80mm）の PDF にする（印刷の画面から出せる）

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'receipt.dart';

Future<Uint8List> receiptPdf(List<RLine> lines, pw.Font font, {String title = 'レシート'}) {
  final doc = pw.Document(theme: pw.ThemeData.withFont(base: font, bold: font), title: title);
  pw.TextStyle st(RLine l) => pw.TextStyle(fontSize: l.big ? 13 : 9, fontWeight: l.bold ? pw.FontWeight.bold : pw.FontWeight.normal);
  doc.addPage(pw.Page(
    pageFormat: PdfPageFormat.roll80.copyWith(marginLeft: 4 * PdfPageFormat.mm, marginRight: 4 * PdfPageFormat.mm),
    build: (c) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.stretch, children: [
      for (final l in lines)
        if (l.image != null)
          pw.Padding(padding: const pw.EdgeInsets.only(bottom: 4), child: pw.Center(child: pw.Image(pw.MemoryImage(l.image!), width: 48 * PdfPageFormat.mm)))
        else if (l.hr)
          pw.Divider(height: 6, thickness: 0.5)
        else if (l.center)
          pw.Text(l.left, textAlign: pw.TextAlign.center, style: st(l))
        else
          pw.Padding(
            padding: pw.EdgeInsets.only(left: l.indent ? 8 : 0),
            child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Expanded(child: pw.Text(l.left, style: st(l))),
              pw.Text(l.right, style: st(l)),
            ]),
          ),
    ]),
  ));
  return doc.save();
}
