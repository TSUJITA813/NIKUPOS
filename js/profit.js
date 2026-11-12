/* NIKUPOS - 売上と利益（粗利・利益の目安）の集計
 *
 *  売上（税抜）＝ 店頭の売上（税込 − 消費税）＋ 卸の納品（税抜）
 *  原価       ＝ 売れた数量 × 原価（商品の「原価（税抜）」。会計時の値を売上に記録。1kg／1個あたり）
 *  粗利       ＝ 原価が登録された商品の売上（税抜）− 原価
 *  経費       ＝ レジの出金（仕入高・事業主貸・普通預金への預け入れを除く。税抜）
 *  固定費     ＝ 毎月の固定費（家賃・人件費など）の日割り
 *  利益の目安 ＝ 粗利（原価が未登録の売上にも同じ粗利率を当てはめた見込み）− 経費 − 固定費
 */
(function (global) {
  'use strict';

  // 経費に入れない出金の科目（仕入は原価として数える／事業主貸・預金は経費ではない）
  var NOT_EXPENSE = ['仕入高', '事業主貸', '普通預金'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function daysInMonth(s) { var d = parse(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  /**
   * 期間：kind = 'day' | 'week'（月曜はじまり）| 'month' | 'year'、offset = 0 なら今の期間、-1 なら1つ前
   * @returns {from, to, kind, label, bucket('hour'|'day'|'month')}
   */
  function period(kind, base, offset) {
    var d = parse(base);
    offset = offset || 0;
    var from, to, label;
    if (kind === 'day') {
      d.setDate(d.getDate() + offset);
      from = to = ymd(d);
      label = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'[d.getDay()] + '）';
    } else if (kind === 'week') {
      var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
      from = ymd(mon);
      to = addDays(from, 6);
      var e = parse(to);
      label = (mon.getMonth() + 1) + '/' + mon.getDate() + '〜' + (e.getMonth() + 1) + '/' + e.getDate();
    } else if (kind === 'month') {
      var m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
      from = ymd(m);
      to = ymd(new Date(m.getFullYear(), m.getMonth() + 1, 0));
      label = m.getFullYear() + '年' + (m.getMonth() + 1) + '月';
    } else {
      var y = d.getFullYear() + offset;
      from = y + '-01-01';
      to = y + '-12-31';
      label = y + '年';
    }
    return { from: from, to: to, kind: kind, label: label, bucket: kind === 'day' ? 'hour' : kind === 'year' ? 'month' : 'day' };
  }

  /** 1行の原価（税抜）。原価が分からなければ null */
  function lineCost(l, products) {
    if (l.unit !== 'g' && l.unit !== 'pc') return null;
    var c = l.cost != null ? l.cost : (products[l.productId] && products[l.productId].cost) || null;
    if (!c) return null;
    return l.unit === 'g' ? Math.round((c * l.qty) / 1000) : c * l.qty;
  }

  function bucketKey(bucket, date, at) {
    if (bucket === 'hour') return at ? new Date(at).getHours() : 0;
    if (bucket === 'month') return Number(date.slice(5, 7));
    return date;
  }
  function bucketList(p) {
    var out = [];
    if (p.bucket === 'hour') { for (var h = 0; h < 24; h++) out.push(h); return out; }
    if (p.bucket === 'month') { for (var m = 1; m <= 12; m++) out.push(m); return out; }
    for (var d = p.from; d <= p.to; d = addDays(d, 1)) out.push(d);
    return out;
  }

  function emptyBucket() { return { sales: 0, excl: 0, cost: 0, covered: 0, uncovered: 0, gross: 0, count: 0 }; }

  /**
   * 集計
   * data: {sales, slips, cashmoves, products(配列), fixedCosts:[{name, amount(月額)}]}
   * p: period() の結果
   * opts.until: Date — これより後の取引を数えない（「今の時刻まで」の比較に使う）
   */
  function compute(data, p, opts) {
    opts = opts || {};
    var until = opts.until ? opts.until.getTime() : null;
    var prods = {};
    (data.products || []).forEach(function (x) { prods[x.id] = x; });
    var r = {
      period: p, sales: 0, excl: 0, tax: 0, count: 0,
      store: { sales: 0, excl: 0, count: 0 }, wholesale: { sales: 0, excl: 0, count: 0 },
      cost: 0, covered: 0, uncovered: 0, gross: 0, grossRate: null,
      expenses: 0, expenseBy: {}, fixed: 0, fixedBy: {}, profit: 0, profitEstimated: false,
      buckets: {}, items: {}, noCost: {}
    };
    bucketList(p).forEach(function (k) { r.buckets[k] = emptyBucket(); });
    function inRange(date, at) {
      if (date < p.from || date > p.to) return false;
      if (until != null && at && new Date(at).getTime() > until) return false;
      return true;
    }
    function addLines(lines, ratio, rateOf, b) {
      // ratio：小計値引きを行に配分するための比率（税込）／ rateOf(l)：税込→税抜にする割合
      lines.forEach(function (l) {
        var amt = (l.amount || 0) * ratio * rateOf(l);
        var c = lineCost(l, prods);
        var it = r.items[l.productId || l.name] || (r.items[l.productId || l.name] = { name: l.name, unit: l.unit, qty: 0, excl: 0, cost: 0, covered: 0, hasCost: true });
        it.qty += l.unit === 'open' ? 0 : l.qty;
        it.excl += amt;
        if (c == null) {
          r.uncovered += amt; b.uncovered += amt; it.hasCost = false;
          if (l.unit !== 'open' && Math.abs(amt) > 0) r.noCost[l.productId || l.name] = l.name;
        } else {
          r.covered += amt; b.covered += amt; it.covered += amt;
          r.cost += c; b.cost += c; it.cost += c;
        }
      });
    }

    // ---- 店頭 ----
    (data.sales || []).forEach(function (s) {
      if (s.void || !inRange(s.date, s.at)) return;
      var tax = s.totals.byRate.reduce(function (a, x) { return a + x.tax; }, 0);
      var excl = s.totals.total - tax;
      var b = r.buckets[bucketKey(p.bucket, s.date, s.at)] || (r.buckets[bucketKey(p.bucket, s.date, s.at)] = emptyBucket());
      r.sales += s.totals.total; r.excl += excl; r.tax += tax;
      r.store.sales += s.totals.total; r.store.excl += excl;
      b.sales += s.totals.total; b.excl += excl;
      if (s.kind !== 'return') { r.count++; r.store.count++; b.count++; }
      var lineSum = s.lines.reduce(function (a, l) { return a + (l.amount || 0); }, 0);
      var ratio = lineSum ? s.totals.total / lineSum : 0;
      addLines(s.lines, ratio, function (l) { return 100 / (100 + (l.taxRate || 8)); }, b);
    });
    // ---- 卸（納品済み） ----
    (data.slips || []).forEach(function (s) {
      if (s.status !== 'delivered' || !inRange(s.date, s.deliveredAt)) return;
      var b = r.buckets[bucketKey(p.bucket, s.date, s.deliveredAt)] || (r.buckets[bucketKey(p.bucket, s.date, s.deliveredAt)] = emptyBucket());
      r.sales += s.totals.total; r.excl += s.totals.subtotal; r.tax += s.totals.tax;
      r.wholesale.sales += s.totals.total; r.wholesale.excl += s.totals.subtotal; r.wholesale.count++;
      b.sales += s.totals.total; b.excl += s.totals.subtotal;
      var lineSum = s.lines.reduce(function (a, l) { return a + (l.amount || 0); }, 0);
      // 行の金額（税抜・内税の混在）を、伝票の税抜合計に合わせて配分
      addLines(s.lines, lineSum ? s.totals.subtotal / lineSum : 0, function () { return 1; }, b);
    });
    // ---- 経費（レジの出金） ----
    (data.cashmoves || []).forEach(function (m) {
      if (m.kind !== 'out' || !inRange(m.date, m.at)) return;
      if (NOT_EXPENSE.indexOf(m.account) >= 0) return;
      var rate = m.taxRate || 0;
      var ex = m.amount - Math.floor((m.amount * rate) / (100 + rate));
      var k = m.account || 'その他';
      r.expenses += ex;
      r.expenseBy[k] = (r.expenseBy[k] || 0) + ex;
    });
    // ---- 固定費（月額の日割り）。今の期間は今日まで ----
    var fixedTo = opts.fixedUntil && opts.fixedUntil < p.to ? opts.fixedUntil : p.to;
    (data.fixedCosts || []).forEach(function (f) {
      var amt = Number(f.amount) || 0;
      if (!amt) return;
      var sum = 0;
      for (var d = p.from; d <= fixedTo; d = addDays(d, 1)) sum += amt / daysInMonth(d);
      sum = Math.round(sum);
      r.fixed += sum;
      r.fixedBy[f.name || '固定費'] = (r.fixedBy[f.name || '固定費'] || 0) + sum;
    });

    // ---- まとめ（端数は円に） ----
    function rd(o, keys) { keys.forEach(function (k) { o[k] = Math.round(o[k]); }); }
    rd(r, ['excl', 'covered', 'uncovered', 'cost']);
    rd(r.store, ['excl']); rd(r.wholesale, ['excl']);
    Object.keys(r.buckets).forEach(function (k) {
      var b = r.buckets[k];
      rd(b, ['excl', 'covered', 'uncovered', 'cost']);
      b.gross = b.covered - b.cost;
    });
    r.gross = r.covered - r.cost;
    r.grossRate = r.covered ? r.gross / r.covered : null;
    // 原価が未登録の売上にも同じ粗利率を当てはめた粗利の見込み
    var grossEst = r.gross + (r.grossRate != null ? Math.round(r.uncovered * r.grossRate) : 0);
    r.profitEstimated = r.uncovered !== 0;
    r.grossEst = grossEst;
    r.profit = grossEst - r.expenses - r.fixed;
    r.coverage = r.covered + r.uncovered ? r.covered / (r.covered + r.uncovered) : 1;
    r.itemList = Object.keys(r.items).map(function (k) {
      var it = r.items[k];
      it.excl = Math.round(it.excl); it.covered = Math.round(it.covered);
      it.gross = it.hasCost ? it.covered - it.cost : null;
      it.rate = it.hasCost && it.covered ? it.gross / it.covered : null;
      return it;
    }).sort(function (a, b) { return (b.gross == null ? -Infinity : b.gross) - (a.gross == null ? -Infinity : a.gross) || b.excl - a.excl; });
    r.noCostList = Object.keys(r.noCost).map(function (k) { return r.noCost[k]; });
    return r;
  }

  /**
   * 比較用の1つ前の期間。今の期間なら「同じところまで」（今日なら今の時刻まで、今月なら今日の日付まで）
   * 今日は「先週の同じ曜日」と比べる
   */
  function previous(p, now) {
    var today = ymd(now);
    var current = today >= p.from && today <= p.to;
    var prev;
    if (p.kind === 'day') prev = period('day', p.from, -7);
    else prev = period(p.kind, p.from, -1);
    if (!current) return { period: prev, until: null, label: p.kind === 'day' ? '先週の同じ曜日' : '前の期間' };
    var elapsedDays = Math.round((parse(today) - parse(p.from)) / 86400000);
    var untilDate = parse(addDays(prev.from, elapsedDays));
    untilDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    // 月の日数の違いで、前の期間からはみ出さないように
    if (ymd(untilDate) > prev.to) untilDate = new Date(parse(prev.to).getTime() + 86399000);
    var label = { day: '先週の同じ曜日の同じ時刻まで', week: '先週の同じ曜日・時刻まで', month: '先月の同じ日・時刻まで', year: '昨年の同じ日・時刻まで' }[p.kind];
    return { period: prev, until: untilDate, label: label, fixedUntil: ymd(untilDate) };
  }

  var Profit = { period: period, compute: compute, previous: previous, lineCost: lineCost, NOT_EXPENSE: NOT_EXPENSE, addDays: addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = Profit;
  else global.Profit = Profit;
})(typeof window !== 'undefined' ? window : this);
