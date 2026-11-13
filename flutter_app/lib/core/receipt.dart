// レシートの中身（画面表示用。レシートプリンター対応の時にも同じ中身を使う）

import 'app_state.dart';
import 'calc.dart';

class RLine {
  final String left, right;
  final bool center, big, bold, hr, indent;
  const RLine(this.left, {this.right = '', this.center = false, this.big = false, this.bold = false, this.hr = false, this.indent = false});
  const RLine.hr() : this('', hr: true);
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
  out.add(RLine(s(settings['storeName']), center: true, big: true, bold: true));
  if (s(settings['address']).isNotEmpty) out.add(RLine(s(settings['address']), center: true));
  if (s(settings['tel']).isNotEmpty) out.add(RLine('TEL ${settings['tel']}', center: true));
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
