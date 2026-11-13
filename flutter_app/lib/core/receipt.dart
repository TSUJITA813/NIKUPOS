// レシートの中身（画面表示用。レシートプリンター対応の時にも同じ中身を使う）

import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'app_state.dart';
import 'calc.dart';

class RLine {
  final String left, right;
  final bool center, big, bold, hr, indent;

  /// 画像（ロゴマーク）。PNG のデータ
  final Uint8List? image;

  /// ロゴの大きさの倍率（小さめ 0.6・ふつう 1・大きめ 1.5）
  final double imageScale;
  const RLine(this.left, {this.right = '', this.center = false, this.big = false, this.bold = false, this.hr = false, this.indent = false, this.image, this.imageScale = 1});
  const RLine.hr() : this('', hr: true);
  const RLine.image(Uint8List data, {double scale = 1}) : this('', image: data, imageScale: scale);
}

/// ロゴの大きさ（設定の logoSize）
const logoSizes = {'small': 0.6, 'normal': 1.0, 'large': 1.5};
const logoSizeLabels = [('small', '小さめ'), ('normal', 'ふつう'), ('large', '大きめ')];
double logoScaleOf(Json settings) => logoSizes[settings['logoSize']] ?? 1.0;

/// PNG の縦横の点の数（読めなければ null）
({int w, int h})? pngSize(Uint8List b) {
  if (b.length < 24 || b[0] != 0x89 || b[1] != 0x50) return null;
  int be(int i) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  final w = be(16), h = be(20);
  return w > 0 && h > 0 ? (w: w, h: h) : null;
}

/// 紙の幅 paperW に対して、ロゴを置く大きさ。
/// 縦長・横長・正方形でも見た目の「量」がそろうよう、面積を一定にして、
/// 幅は紙の 70%・高さは紙の幅の 30% までにおさえる（scale で全体を大きく・小さく）
({double w, double h}) logoBox(Uint8List bytes, double paperW, {double scale = 1}) {
  final sz = pngSize(bytes);
  final ratio = sz == null ? 2.0 : sz.w / sz.h; // 横 ÷ 縦
  final area = 0.1 * paperW * paperW * scale;
  var w = math.sqrt(area * ratio), h = math.sqrt(area / ratio);
  final maxW = paperW * (0.7 * math.sqrt(scale)).clamp(0.0, 0.95), maxH = paperW * 0.3 * math.sqrt(scale);
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return (w: w, h: h);
}

String? _logoKey;
Uint8List? _logoBytes;

/// 設定のロゴマーク（なければ null）
Uint8List? logoOf(Json settings) {
  final v = settings['logo'];
  if (v is! String || v.isEmpty) return null;
  if (v != _logoKey) {
    try {
      _logoBytes = base64Decode(v);
    } catch (_) {
      _logoBytes = null;
    }
    _logoKey = v;
  }
  return _logoBytes;
}

/// 「〒123-4567 住所」の形にする
String addressLine(Json settings) {
  final zip = (settings['zip'] ?? '').toString().trim();
  final addr = (settings['address'] ?? '').toString().trim();
  return [if (zip.isNotEmpty) '〒$zip', if (addr.isNotEmpty) addr].join(' ');
}

/// レシートの上の店名・住所など（ロゴがあれば一番上に）
List<RLine> storeHeader(Json settings) {
  String s(Object? v) => (v ?? '').toString();
  final logo = logoOf(settings);
  final addr = addressLine(settings);
  return [
    if (logo != null) RLine.image(logo, scale: logoScaleOf(settings)),
    RLine(s(settings['storeName']), center: true, big: true, bold: true),
    if (addr.isNotEmpty) RLine(addr, center: true),
    if (s(settings['tel']).isNotEmpty) RLine('TEL ${settings['tel']}', center: true),
  ];
}

String discLabel(Json? d) {
  if (d == null || (d['value'] ?? 0) == 0) return '';
  if (d['type'] == 'pct') return d['value'] == 50 ? '半額' : '${d['value']}%引';
  return '${yen(d['value'] as num)}引';
}

String noOf(Json x) => '${x['noLabel'] ?? x['no']}';

String dateTimeStr(DateTime d) => '${d.year}年${d.month}月${d.day}日 ${timeStr(d)}';

List<RLine> receiptLines(Json sale, Json settings, {bool reprint = false}) {
  final out = <RLine>[];
  final d = DateTime.parse(sale['at'] as String).toLocal();
  String s(Object? v) => (v ?? '').toString();
  out.addAll(storeHeader(settings));
  if (s(settings['invoiceNo']).isNotEmpty) out.add(RLine('登録番号 ${settings['invoiceNo']}', center: true));
  out.add(RLine(sale['kind'] == 'return' ? '返品・返金' : s(settings['invoiceNo']).isNotEmpty ? '領収書（適格簡易請求書）' : '領収書', center: true));
  if (sale['void'] == true) out.add(const RLine('＊ 取 消 ＊', center: true, big: true, bold: true));
  if (reprint) out.add(const RLine('＊＊ 再発行 ＊＊', center: true));
  out.add(RLine(dateTimeStr(d), right: 'No.${noOf(sale)}'));
  if (s(sale['customer']).isNotEmpty) out.add(RLine('${sale['customer']} 様（ご予約）'));
  out.add(const RLine.hr());
  for (final l in (sale['lines'] as List).cast<Json>()) {
    final mark = l['taxRate'] == 8 ? '※' : '';
    final da = ((l['discountAmount'] ?? 0) as num).toInt();
    out.add(RLine('$mark${l['name']}', right: yen((l['amount'] as num) + da)));
    final qty = (l['qty'] as num).abs();
    if (l['unit'] == 'g') {
      out.add(RLine('${yen(l['price'] as num)}/100g × ${numStr(qty)}g', indent: true));
    } else if (l['unit'] == 'pc' && qty > 1) {
      out.add(RLine('${yen(l['price'] as num)} × $qty', indent: true));
    }
    if (da != 0) out.add(RLine('値引 ${discLabel(l['discount'] as Json?)}', right: '-${numStr(da)}', indent: true));
  }
  final t = sale['totals'] as Json;
  out.add(const RLine.hr());
  out.add(RLine('小計', right: yen(t['subtotal'] as num)));
  if (((t['discount'] ?? 0) as num) != 0) out.add(RLine('値引 ${discLabel(sale['discount'] as Json?)}', right: '-${numStr(t['discount'] as num)}'));
  out.add(RLine('合計', right: yen(t['total'] as num), big: true, bold: true));
  for (final r in (t['byRate'] as List)) {
    out.add(RLine('(${r['rate']}%対象', right: '${yen(r['amount'] as num)})'));
    out.add(RLine('(内消費税等 ${r['rate']}%', right: '${yen(r['tax'] as num)})'));
  }
  out.add(const RLine.hr());
  final pm = salePayments(sale);
  final ctype = s(sale['cashlessType']).isNotEmpty ? s(sale['cashlessType']) : 'キャッシュレス';
  if (sale['kind'] == 'return') {
    out.add(RLine('ご返金（${pm.cashless != 0 ? ctype : '現金'}）', right: yen(-(t['total'] as num)), bold: true));
  } else {
    if (pm.deposit != 0) out.add(RLine('前受金', right: '-${numStr(pm.deposit)}'));
    if (((sale['refund'] ?? 0) as num) != 0) {
      out.add(RLine('前受金のご返金', right: yen(sale['refund'] as num)));
    } else if (pm.cashless != 0) {
      out.add(RLine(ctype, right: yen(pm.cashless)));
      if (pm.cash > 0) {
        out.add(RLine('現金', right: yen(pm.cash)));
        out.add(RLine('お預かり', right: yen(sale['received'] as num)));
        out.add(RLine('おつり', right: yen(sale['change'] as num)));
      }
    } else if (pm.cash > 0 || pm.deposit == 0) {
      out.add(RLine('お預かり', right: yen((sale['received'] ?? 0) as num)));
      out.add(RLine('おつり', right: yen((sale['change'] ?? 0) as num)));
    }
  }
  if ((sale['lines'] as List).any((l) => l['taxRate'] == 8)) out.add(const RLine('※は軽減税率(8%)対象商品'));
  if (s(settings['footer']).isNotEmpty) out.add(RLine(s(settings['footer']), center: true));
  return out;
}

/// 郵便番号を「123-4567」の形にそろえる（全角の数字も可）
String normZip(String v) {
  final d = v.replaceAllMapped(RegExp('[０-９]'), (m) => String.fromCharCode(m[0]!.codeUnitAt(0) - 0xFF10 + 0x30)).replaceAll(RegExp(r'[^0-9]'), '');
  if (d.length == 7) return '${d.substring(0, 3)}-${d.substring(3)}';
  return v.trim();
}

/// base64 の画像 → データ
Uint8List logoBytesOf(String b64) => base64Decode(b64);
