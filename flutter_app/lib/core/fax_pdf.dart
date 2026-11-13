// FAX用の書類（A4・PDF）
//  ご予約確認書：FAXで受けた予約の内容を、お客様にFAXで送り返す
//  FAX注文用紙：お客様に渡しておき、書いてFAXしてもらう用紙
// 文字は同梱の IPAゴシック（assets/fonts/ipag.ttf）を使う。

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'app_state.dart' show yen;
import 'calc.dart';
import 'reservation.dart';

const _week = '月火水木金土日';

String jpDate(String ymd) {
  final p = ymd.split('-').map(int.parse).toList();
  final d = DateTime(p[0], p[1], p[2]);
  return '${d.year}年${d.month}月${d.day}日（${_week[d.weekday - 1]}）';
}

String _s(Object? v) => (v ?? '').toString();

pw.Widget _storeBlock(Json st, {pw.CrossAxisAlignment align = pw.CrossAxisAlignment.end}) => pw.Column(crossAxisAlignment: align, children: [
      pw.Text(_s(st['storeName']), style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold)),
      if (_s(st['address']).isNotEmpty) pw.Text(_s(st['address']), style: const pw.TextStyle(fontSize: 10)),
      if (_s(st['tel']).isNotEmpty) pw.Text('TEL ${st['tel']}', style: const pw.TextStyle(fontSize: 10)),
      if (_s(st['fax']).isNotEmpty) pw.Text('FAX ${st['fax']}', style: const pw.TextStyle(fontSize: 10)),
      if (_s(st['invoiceNo']).isNotEmpty) pw.Text('登録番号 ${st['invoiceNo']}', style: const pw.TextStyle(fontSize: 9)),
    ]);

pw.Widget _cell(String t, {bool bold = false, pw.Alignment align = pw.Alignment.centerLeft, double size = 11}) => pw.Container(
      alignment: align,
      padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      child: pw.Text(t, style: pw.TextStyle(fontSize: size, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
    );

/// ご予約確認書
Future<Uint8List> reservationConfirmationPdf(Json r, Json settings, String mode, pw.Font font, {DateTime? now}) {
  final doc = pw.Document(theme: pw.ThemeData.withFont(base: font, bold: font), title: 'ご予約確認書', author: _s(settings['storeName']));
  final items = (r['items'] as List).cast<Json>();
  final est = reservationEstimate(r, mode);
  final deposit = ((r['deposit'] ?? 0) as num).toInt();
  final hasG = items.any((it) => it['unit'] == 'g');
  final issued = now ?? DateTime.now();
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(40),
    build: (c) => [
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text('${_s(r['name'])}　様', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
            if (_s(r['fax']).isNotEmpty) pw.Text('FAX ${r['fax']}', style: const pw.TextStyle(fontSize: 11)),
            if (_s(r['phone']).isNotEmpty) pw.Text('TEL ${r['phone']}', style: const pw.TextStyle(fontSize: 11)),
          ]),
        ),
        pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
          pw.Text('${issued.year}年${issued.month}月${issued.day}日', style: const pw.TextStyle(fontSize: 10)),
          pw.SizedBox(height: 6),
          _storeBlock(settings),
        ]),
      ]),
      pw.SizedBox(height: 16),
      pw.Center(child: pw.Text('ご予約確認書', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold, letterSpacing: 4))),
      pw.SizedBox(height: 12),
      pw.Text('このたびはご予約いただき、ありがとうございます。下記の内容でご予約を承りました。'),
      pw.SizedBox(height: 10),
      pw.Table(border: pw.TableBorder.all(width: 0.6), columnWidths: const {0: pw.FixedColumnWidth(110), 1: pw.FlexColumnWidth()}, children: [
        pw.TableRow(children: [_cell('予約番号', bold: true), _cell('No.${r['noLabel'] ?? r['no']}')]),
        pw.TableRow(children: [_cell('お受取日時', bold: true), _cell('${jpDate(r['date'] as String)}　${_s(r['time']).isEmpty ? '時刻の指定なし' : '${r['time']} ごろ'}', size: 13, bold: true)]),
        pw.TableRow(children: [_cell('受付', bold: true), _cell(channelLabels[r['channel']] ?? '')]),
      ]),
      pw.SizedBox(height: 12),
      pw.Table(
        border: pw.TableBorder.all(width: 0.6),
        columnWidths: const {0: pw.FlexColumnWidth(3), 1: pw.FlexColumnWidth(1.4), 2: pw.FlexColumnWidth(1.4), 3: pw.FlexColumnWidth(1.4)},
        children: [
          pw.TableRow(decoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFEEEEEE)), children: [
            _cell('品名', bold: true), _cell('数量', bold: true, align: pw.Alignment.centerRight),
            _cell('単価（税込）', bold: true, align: pw.Alignment.centerRight), _cell('概算金額', bold: true, align: pw.Alignment.centerRight),
          ]),
          for (final it in items)
            pw.TableRow(children: [
              _cell(_s(it['name'])),
              _cell(it['unit'] == 'open' ? '—' : itemQtyLabel(it), align: pw.Alignment.centerRight),
              _cell(it['unit'] == 'g' ? '${yen(it['price'] as num)}/100g' : yen(it['price'] as num), align: pw.Alignment.centerRight),
              _cell(yen(lineAmount(it, mode)), align: pw.Alignment.centerRight),
            ]),
        ],
      ),
      pw.SizedBox(height: 8),
      pw.Align(
        alignment: pw.Alignment.centerRight,
        child: pw.Table(border: pw.TableBorder.all(width: 0.6), columnWidths: const {0: pw.FixedColumnWidth(150), 1: pw.FixedColumnWidth(110)}, children: [
          pw.TableRow(children: [_cell('概算合計（税込）', bold: true), _cell(yen(est), align: pw.Alignment.centerRight, bold: true, size: 13)]),
          if (deposit > 0) pw.TableRow(children: [_cell('前受金（お預かり済）'), _cell('-${yen(deposit)}', align: pw.Alignment.centerRight)]),
          if (deposit > 0) pw.TableRow(children: [_cell('お受取時のお支払い（概算）', bold: true), _cell(yen(est - deposit), align: pw.Alignment.centerRight, bold: true)]),
        ]),
      ),
      pw.SizedBox(height: 12),
      if (hasG) pw.Text('※ グラム売りの商品は、お受取時に実際の重さでお会計します。概算金額と前後することがあります。', style: const pw.TextStyle(fontSize: 10)),
      if (_s(r['note']).isNotEmpty) ...[pw.SizedBox(height: 6), pw.Text('ご要望・メモ：${r['note']}', style: const pw.TextStyle(fontSize: 11))],
      pw.SizedBox(height: 16),
      pw.Text('内容に誤りがある場合や変更・取消のときは、お電話${_s(settings['fax']).isNotEmpty ? 'またはFAX' : ''}でお知らせください。', style: const pw.TextStyle(fontSize: 10)),
    ],
  ));
  return doc.save();
}

/// FAX注文用紙（お客様に書いてもらう）
Future<Uint8List> faxOrderFormPdf(Json settings, List<Json> products, List<String> categories, pw.Font font) {
  final doc = pw.Document(theme: pw.ThemeData.withFont(base: font, bold: font), title: 'FAX注文用紙', author: _s(settings['storeName']));
  final list = products.where((p) => p['unit'] != 'open').toList()
    ..sort((a, b) {
      final ca = categories.indexOf(a['category'] as String), cb = categories.indexOf(b['category'] as String);
      return ca != cb ? ca.compareTo(cb) : ((a['order'] ?? 0) as num).compareTo((b['order'] ?? 0) as num);
    });
  pw.Widget field(String label, {double h = 26}) => pw.Container(
        height: h,
        decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(width: 0.6))),
        alignment: pw.Alignment.bottomLeft,
        padding: const pw.EdgeInsets.only(bottom: 3),
        child: pw.Text(label, style: const pw.TextStyle(fontSize: 11)),
      );
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(36),
    build: (c) => [
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Expanded(
          child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Text('FAX注文用紙', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),
            pw.SizedBox(height: 4),
            pw.Text('${_s(settings['storeName'])}　行', style: const pw.TextStyle(fontSize: 13)),
            if (_s(settings['fax']).isNotEmpty)
              pw.Text('FAX ${settings['fax']}', style: pw.TextStyle(fontSize: 20, fontWeight: pw.FontWeight.bold)),
            if (_s(settings['tel']).isNotEmpty) pw.Text('（お問い合わせ TEL ${settings['tel']}）', style: const pw.TextStyle(fontSize: 10)),
          ]),
        ),
        _storeBlock(settings),
      ]),
      pw.SizedBox(height: 12),
      pw.Row(children: [
        pw.Expanded(child: field('お名前')),
        pw.SizedBox(width: 16),
        pw.Expanded(child: field('お電話')),
        pw.SizedBox(width: 16),
        pw.Expanded(child: field('FAX')),
      ]),
      pw.SizedBox(height: 6),
      field('お受取希望日　　　　月　　　　日（　　）　　　　時ごろ'),
      pw.SizedBox(height: 12),
      pw.Text('ご注文の数量をご記入ください（グラム売りは g・kg、個数売りは個数）', style: const pw.TextStyle(fontSize: 10)),
      pw.SizedBox(height: 4),
      pw.Table(
        border: pw.TableBorder.all(width: 0.6),
        columnWidths: const {0: pw.FlexColumnWidth(1.2), 1: pw.FlexColumnWidth(3), 2: pw.FlexColumnWidth(1.6), 3: pw.FlexColumnWidth(2.2)},
        children: [
          pw.TableRow(decoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFEEEEEE)), children: [
            _cell('種類', bold: true), _cell('品名', bold: true), _cell('単価（税込）', bold: true, align: pw.Alignment.centerRight), _cell('ご注文数', bold: true, align: pw.Alignment.center),
          ]),
          for (final p in list)
            pw.TableRow(children: [
              _cell(_s(p['category']), size: 10),
              _cell(_s(p['name']), size: 12),
              _cell(p['unit'] == 'g' ? '${yen(p['price'] as num)}/100g' : yen(p['price'] as num), align: pw.Alignment.centerRight),
              _cell(p['unit'] == 'g' ? '　　　　　　g' : '　　　　　　個', align: pw.Alignment.centerRight, size: 12),
            ]),
        ],
      ),
      pw.SizedBox(height: 10),
      pw.Text('その他のご注文・ご要望', style: const pw.TextStyle(fontSize: 11)),
      pw.Container(height: 70, decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.6))),
      pw.SizedBox(height: 8),
      pw.Text('※ 価格は ${DateTime.now().year}年${DateTime.now().month}月現在のものです。グラム売りの商品は、お受取時に実際の重さでお会計します。', style: const pw.TextStyle(fontSize: 9)),
      pw.Text('※ ご注文を受け付けましたら、ご予約確認書をFAXでお送りします。届かない場合はお電話ください。', style: const pw.TextStyle(fontSize: 9)),
    ],
  ));
  return doc.save();
}
