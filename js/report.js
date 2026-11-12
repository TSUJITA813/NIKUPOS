/* NIKUPOS - 期間の売上の書き出し（月報など）
 * 日別の集計・取引明細・商品別・月別を、Excel のシートや CSV の行にします。
 */
(function (global) {
  'use strict';
  var Calc = global.Calc || (typeof require !== 'undefined' ? require('./calc.js') : null);

  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }

  /** from〜to の日付（両端を含む・最大 maxDays 日） */
  function datesBetween(from, to, maxDays) {
    var out = [];
    var d = parse(from), end = parse(to);
    while (d <= end && out.length < (maxDays || 400)) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  /** よく使う期間 */
  function presetRange(kind, today) {
    var t = parse(today);
    if (kind === 'thisMonth') return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
    if (kind === 'lastMonth') return { from: ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: ymd(new Date(t.getFullYear(), t.getMonth(), 0)) };
    if (kind === 'thisYear') return { from: t.getFullYear() + '-01-01', to: t.getFullYear() + '-12-31' };
    return { from: today, to: today };
  }

  function noOf(x) { return x.noLabel || x.no; }
  function timeOf(iso) { var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function kindLabel(s) { return s.void ? '取消' : s.kind === 'return' ? '返品' : '売上'; }
  function payLabel(s) {
    var p = Calc.salePayments(s);
    var parts = [];
    if (p.deposit) parts.push('前受金');
    if (p.cash > 0 || (s.kind === 'return' && !p.cashless)) parts.push('現金');
    if (p.cashless) parts.push(s.cashlessType || 'キャッシュレス');
    if (s.refund) parts.push('返金');
    return parts.join('＋') || '現金';
  }

  /**
   * 期間の集計
   * data: {sales, reservations, slips, receipts, cashmoves}
   * @returns {dates, days:[{date, s}], total, cashlessTypes, rates, items, sales}
   */
  function summarize(data, from, to) {
    var dates = datesBetween(from, to);
    var byDate = {};
    (data.sales || []).forEach(function (s) {
      if (s.date < from || s.date > to) return;
      (byDate[s.date] || (byDate[s.date] = [])).push(s);
    });
    var ws = { slips: data.slips || [], receipts: data.receipts || [], cashmoves: data.cashmoves || [] };
    var types = {}, rates = {};
    var days = dates.map(function (date) {
      var s = Calc.summarizeDay(byDate[date] || [], data.reservations || [], date, ws);
      Object.keys(s.cashlessBy).forEach(function (k) { types[k] = true; });
      Object.keys(s.rates).forEach(function (r) { rates[r] = true; });
      return { date: date, s: s };
    });
    var total = { count: 0, total: 0, cash: 0, cashless: 0, cashlessBy: {}, depositUsed: 0, returnsCount: 0, returns: 0, discount: 0, voids: 0, rates: {}, wholesale: 0, cashIn: 0, cashOut: 0 };
    var items = {};
    days.forEach(function (d) {
      var s = d.s;
      total.count += s.count; total.total += s.total; total.cash += s.cash; total.cashless += s.cashless;
      total.depositUsed += s.depositUsed; total.returnsCount += s.returns.count; total.returns += s.returns.amount;
      total.discount += s.discount; total.voids += s.voids; total.wholesale += s.wholesale.total;
      total.cashIn += s.cashIn; total.cashOut += s.cashOut;
      Object.keys(s.cashlessBy).forEach(function (k) { total.cashlessBy[k] = (total.cashlessBy[k] || 0) + s.cashlessBy[k]; });
      Object.keys(s.rates).forEach(function (r) {
        var x = total.rates[r] || (total.rates[r] = { amount: 0, tax: 0 });
        x.amount += s.rates[r].amount; x.tax += s.rates[r].tax;
      });
      Object.keys(s.items).forEach(function (k) {
        var a = s.items[k];
        var it = items[k] || (items[k] = { name: a.name, unit: a.unit, qty: 0, count: 0, amount: 0 });
        it.qty += a.qty; it.count += a.count; it.amount += a.amount;
      });
    });
    var sales = [];
    dates.forEach(function (d) { (byDate[d] || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; }).forEach(function (s) { sales.push(s); }); });
    return {
      dates: dates, days: days, total: total,
      cashlessTypes: Object.keys(types).sort(),
      rates: Object.keys(rates).map(Number).sort(function (a, b) { return a - b; }),
      items: Object.keys(items).map(function (k) { return items[k]; }).sort(function (a, b) { return b.amount - a.amount; }),
      sales: sales
    };
  }

  function dayRow(label, wd, s, sum) {
    var r = [label, wd, s.count, s.total, s.count ? Math.round(s.total / s.count) : 0, s.cash, s.cashless];
    sum.cashlessTypes.forEach(function (k) { r.push(s.cashlessBy[k] || 0); });
    r.push(s.depositUsed, s.returnsCount, s.returns, s.discount, s.voids);
    sum.rates.forEach(function (rate) { var x = s.rates[rate] || { amount: 0, tax: 0 }; r.push(x.amount, x.tax); });
    r.push(s.wholesale, s.cashIn, s.cashOut);
    return r;
  }
  function dayHeader(sum) {
    var h = ['日付', '曜日', '客数', '売上（税込）', '客単価', '現金', 'キャッシュレス'];
    sum.cashlessTypes.forEach(function (k) { h.push('　' + k); });
    h.push('前受金から充当', '返品件数', '返品額', '値引き', '取消件数');
    sum.rates.forEach(function (rate) { h.push(rate + '%対象', rate + '%消費税'); });
    h.push('卸の納品（税込）', '入金', '出金');
    return h;
  }
  function flat(s) {
    return {
      count: s.count, total: s.total, cash: s.cash, cashless: s.cashless, cashlessBy: s.cashlessBy, depositUsed: s.depositUsed,
      returnsCount: s.returns.count, returns: s.returns.amount, discount: s.discount, voids: s.voids, rates: s.rates,
      wholesale: s.wholesale.total, cashIn: s.cashIn, cashOut: s.cashOut
    };
  }

  /** 日別のシート（最後に合計） */
  function dailyRows(sum) {
    var rows = [dayHeader(sum)];
    sum.days.forEach(function (d) { rows.push(dayRow(d.date, WEEK[parse(d.date).getDay()], flat(d.s), sum)); });
    rows.push(dayRow('合計', '', sum.total, sum));
    return rows;
  }

  /** 月別のシート（期間が2か月以上にまたがるとき） */
  function monthlyRows(sum) {
    var months = {}, order = [];
    sum.days.forEach(function (d) {
      var m = d.date.slice(0, 7);
      if (!months[m]) { order.push(m); months[m] = { count: 0, total: 0, cash: 0, cashless: 0, cashlessBy: {}, depositUsed: 0, returnsCount: 0, returns: 0, discount: 0, voids: 0, rates: {}, wholesale: 0, cashIn: 0, cashOut: 0 }; }
      var t = months[m], s = flat(d.s);
      ['count', 'total', 'cash', 'cashless', 'depositUsed', 'returnsCount', 'returns', 'discount', 'voids', 'wholesale', 'cashIn', 'cashOut'].forEach(function (k) { t[k] += s[k]; });
      Object.keys(s.cashlessBy).forEach(function (k) { t.cashlessBy[k] = (t.cashlessBy[k] || 0) + s.cashlessBy[k]; });
      Object.keys(s.rates).forEach(function (r) {
        var x = t.rates[r] || (t.rates[r] = { amount: 0, tax: 0 });
        x.amount += s.rates[r].amount; x.tax += s.rates[r].tax;
      });
    });
    var h = dayHeader(sum);
    h[0] = '月'; h.splice(1, 1);
    var rows = [h];
    order.forEach(function (m) { var r = dayRow(m, '', months[m], sum); r.splice(1, 1); rows.push(r); });
    var tr = dayRow('合計', '', sum.total, sum); tr.splice(1, 1); rows.push(tr);
    return rows;
  }

  /** 取引明細（商品1行ずつ） */
  function detailRows(sum) {
    var rows = [['日付', '時刻', '取引No', '区分', '端末', '担当', '支払', '商品', '税率', '単価', '数量', '単位', '値引', '金額', '取引合計', '現金', 'キャッシュレス', '前受金']];
    sum.sales.forEach(function (s) {
      var p = Calc.salePayments(s);
      var head = [s.date, timeOf(s.at), String(noOf(s)), kindLabel(s), s.dev || '', s.staff || '', payLabel(s)];
      var tail = [s.totals.total, p.cash, p.cashless, p.deposit || 0];
      s.lines.forEach(function (l) {
        var unitLabel = l.unit === 'g' ? 'g' : l.unit === 'open' ? '式' : '個';
        rows.push(head.concat([l.name, l.taxRate, l.price, l.unit === 'open' ? (l.qty < 0 ? -1 : 1) : l.qty, unitLabel, l.discountAmount || 0, l.amount]).concat(tail));
      });
      if (s.totals.discount) rows.push(head.concat(['小計値引', '', '', '', '', s.totals.discount, -s.totals.discount]).concat(tail));
    });
    return rows;
  }

  /** 商品別 */
  function itemRows(sum) {
    var all = sum.items.reduce(function (a, it) { return a + it.amount; }, 0);
    var rows = [['商品', '数量', '単位', '販売回数', '金額', '構成比（%）']];
    sum.items.forEach(function (it) {
      rows.push([it.name, it.unit === 'open' ? it.count : it.qty, it.unit === 'g' ? 'g' : it.unit === 'open' ? '回' : '個', it.count, it.amount,
        all ? Math.round(it.amount / all * 1000) / 10 : 0]);
    });
    rows.push(['合計', '', '', '', all, all ? 100 : 0]);
    return rows;
  }

  /** Excel のシート一式 */
  function bookSheets(sum, title) {
    var sheets = [{ name: '日別', rows: dailyRows(sum), widths: [12, 5, 7, 13, 9, 12, 13].concat(sum.cashlessTypes.map(function () { return 12; })), title: title + ' 日別', landscape: true }];
    var months = {};
    sum.dates.forEach(function (d) { months[d.slice(0, 7)] = true; });
    if (Object.keys(months).length > 1) sheets.push({ name: '月別', rows: monthlyRows(sum), widths: [10, 7, 13, 9, 12, 13], title: title + ' 月別', landscape: true });
    sheets.push({ name: '取引明細', rows: detailRows(sum), widths: [11, 6, 9, 6, 5, 8, 16, 18, 5, 8, 7, 5, 7, 9, 9, 9, 12, 8], title: title + ' 取引明細', landscape: true });
    sheets.push({ name: '商品別', rows: itemRows(sum), widths: [22, 10, 5, 9, 12, 11], title: title + ' 商品別' });
    return sheets;
  }

  function toCsv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (c) { var v = c == null ? '' : String(c); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
  }

  var Report = {
    datesBetween: datesBetween, presetRange: presetRange, summarize: summarize,
    dailyRows: dailyRows, monthlyRows: monthlyRows, detailRows: detailRows, itemRows: itemRows,
    bookSheets: bookSheets, toCsv: toCsv, payLabel: payLabel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Report;
  else global.Report = Report;
})(typeof window !== 'undefined' ? window : this);
