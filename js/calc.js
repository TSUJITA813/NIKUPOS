/*
 * 金額計算ロジック（画面に依存しない純粋関数）
 * 価格はすべて税込（内税）の整数（円）で扱う。
 */
(function (root) {
  'use strict';

  function roundBy(value, mode) {
    // 浮動小数点誤差対策で一旦小数第6位で丸めてから端数処理
    var v = Math.round(value * 1e6) / 1e6;
    if (mode === 'round') return Math.round(v);
    if (mode === 'ceil') return Math.ceil(v);
    return Math.floor(v);
  }

  /** 割引前の行金額 */
  function lineBase(line, mode) {
    if (line.unit === 'g') {
      // 単価は100gあたり
      return roundBy((line.price * line.qty) / 100, mode);
    }
    return line.price * line.qty;
  }

  /** 行の値引き額 */
  /** 行の値引き額（手動の値引き ＋ タイムセール・まとめ売りの値引き） */
  function lineDiscount(line, mode) {
    var base = lineBase(line, mode);
    var d = line.discount;
    var amount = 0;
    if (d && d.value) amount = d.type === 'pct' ? roundBy((base * d.value) / 100, mode) : d.value;
    amount += line.promoDiscount || 0;
    return Math.max(0, Math.min(base, amount));
  }

  /** 値引き後の行金額 */
  function lineAmount(line, mode) {
    return lineBase(line, mode) - lineDiscount(line, mode);
  }

  /** 内税額 */
  function includedTax(amount, rate) {
    return Math.floor((amount * rate) / (100 + rate));
  }

  /**
   * 合計計算
   * @param lines 明細 [{price, qty, unit, taxRate, discount}]
   * @param discount 小計値引き {type:'yen'|'pct', value} | null
   * @param mode 端数処理 'floor'|'round'|'ceil'
   */
  function totals(lines, discount, mode) {
    var groups = {};
    var subtotal = 0;
    var lineDiscountTotal = 0;
    lines.forEach(function (l) {
      var amt = lineAmount(l, mode);
      lineDiscountTotal += lineDiscount(l, mode);
      subtotal += amt;
      groups[l.taxRate] = (groups[l.taxRate] || 0) + amt;
    });

    var disc = 0;
    if (discount && discount.value) {
      disc = discount.type === 'pct' ? roundBy((subtotal * discount.value) / 100, mode) : discount.value;
      disc = Math.max(0, Math.min(subtotal, disc));
    }

    // 小計値引きを税率ごとに按分（最大のグループで端数を吸収）
    var rates = Object.keys(groups).map(Number).sort(function (a, b) {
      return groups[a] - groups[b];
    });
    var allocated = 0;
    var byRate = rates.map(function (rate, i) {
      var alloc;
      if (i === rates.length - 1) alloc = disc - allocated;
      else alloc = subtotal ? Math.floor((disc * groups[rate]) / subtotal) : 0;
      allocated += alloc;
      var amount = groups[rate] - alloc;
      return { rate: rate, amount: amount, tax: includedTax(amount, rate) };
    });
    byRate.sort(function (a, b) { return a.rate - b.rate; });

    return {
      subtotal: subtotal,
      lineDiscount: lineDiscountTotal,
      discount: disc,
      total: subtotal - disc,
      byRate: byRate,
      count: lines.length
    };
  }

  /**
   * 支払い内訳（前受金を考慮）
   * 合計 = 前受金充当 + 現金 + キャッシュレス。前受金が合計を超えた分は現金で返金（cashがマイナス）。
   * @returns {due, deposit, cash, cashless, received, change, refund}
   */
  function payments(total, deposit, method, received) {
    deposit = Math.max(0, deposit || 0);
    var due = total - deposit;
    if (due <= 0) {
      return { due: due, deposit: deposit, cash: due, cashless: 0, received: 0, change: 0, refund: -due };
    }
    if (method === 'cashless') {
      return { due: due, deposit: deposit, cash: 0, cashless: due, received: due, change: 0, refund: 0 };
    }
    return { due: due, deposit: deposit, cash: due, cashless: 0, received: received, change: received - due, refund: 0 };
  }

  /** 旧形式の売上データにも対応した支払い内訳 */
  function salePayments(sale) {
    if (sale.payments) return sale.payments;
    var t = sale.totals.total;
    return { deposit: 0, cash: sale.method === 'cash' ? t : 0, cashless: sale.method === 'cash' ? 0 : t };
  }

  function isActiveReservation(r) { return r.status === 'reserved' || r.status === 'ready'; }

  /** 予約の概算金額（グラム売りは予定重量で計算） */
  function reservationEstimate(r, mode) {
    return r.items.reduce(function (s, it) { return s + lineAmount(it, mode); }, 0);
  }

  /** 仕込み集計：指定日の受取予定（取消・受渡済を除く）を商品ごとに合計 */
  function prepSummary(reservations, date) {
    var map = {};
    var order = [];
    var count = 0;
    reservations.forEach(function (r) {
      if (r.date !== date || !isActiveReservation(r)) return;
      count++;
      r.items.forEach(function (it) {
        var k = it.productId + '|' + it.unit;
        if (!map[k]) { map[k] = { productId: it.productId, name: it.name, unit: it.unit, qty: 0, reservations: 0 }; order.push(k); }
        map[k].qty += it.unit === 'open' ? 1 : it.qty;
        map[k].reservations += 1;
      });
    });
    return { count: count, items: order.map(function (k) { return map[k]; }) };
  }

  /**
   * 日別集計（レジ内現金の増減を含む）
   * @param ws 卸のデータ { slips, receipts }（省略可）
   */
  function summarizeDay(sales, reservations, date, ws) {
    var daySales = sales.filter(function (s) { return s.date === date; });
    var sum = {
      sales: daySales, count: 0, total: 0, cash: 0, cashless: 0, depositUsed: 0, discount: 0, voids: 0,
      rates: {}, items: {},
      depositIn: { cash: 0, cashless: 0 }, depositRefund: { cash: 0, cashless: 0 }, drawerCash: 0,
      wholesale: { count: 0, total: 0, credit: 0, cashOnDelivery: 0, receiptCash: 0, receiptOther: 0, fee: 0 },
      cashlessBy: {}, returns: { count: 0, amount: 0 }, cashIn: 0, cashOut: 0
    };
    daySales.forEach(function (s) {
      if (s.void) { sum.voids++; return; }
      var p = salePayments(s);
      if (p.cashless) {
        var ct = s.cashlessType || 'キャッシュレス';
        sum.cashlessBy[ct] = (sum.cashlessBy[ct] || 0) + p.cashless;
      }
      if (s.kind === 'return') { sum.returns.count++; sum.returns.amount -= s.totals.total; } // 返品はマイナスの取引
      else sum.count++;
      sum.total += s.totals.total;
      sum.cash += p.cash;
      sum.cashless += p.cashless;
      sum.depositUsed += p.deposit;
      sum.discount += s.totals.discount + (s.totals.lineDiscount || 0);
      s.totals.byRate.forEach(function (r) {
        var x = sum.rates[r.rate] || (sum.rates[r.rate] = { amount: 0, tax: 0 });
        x.amount += r.amount;
        x.tax += r.tax;
      });
      s.lines.forEach(function (l) {
        var it = sum.items[l.name] || (sum.items[l.name] = { name: l.name, unit: l.unit, qty: 0, count: 0, amount: 0 });
        it.qty += l.unit === 'open' ? (s.kind === 'return' ? -1 : 1) : l.qty;
        if (s.kind !== 'return') it.count += 1;
        it.amount += l.itemAmount != null ? l.itemAmount : l.amount; // 返品は小計値引き前の金額で差し引く
      });
    });
    (reservations || []).forEach(function (r) {
      if (!r.deposit) return;
      var m = r.depositMethod === 'cashless' ? 'cashless' : 'cash';
      if (r.depositDate === date) sum.depositIn[m] += r.deposit;
      if (r.depositRefundDate === date) sum.depositRefund[m] += r.deposit;
    });
    var w = sum.wholesale;
    if (ws) {
      (ws.slips || []).forEach(function (s) {
        if (s.date !== date || s.status !== 'delivered') return;
        w.count++;
        w.total += s.totals.total;
        if (s.payment === 'cash') w.cashOnDelivery += s.totals.total; else w.credit += s.totals.total;
      });
      (ws.receipts || []).forEach(function (r) {
        if (r.date !== date) return;
        if (r.method === 'fee') w.fee += r.amount; // 振込手数料（当方負担）はお金の入金ではない
        else if (r.method === 'cash') w.receiptCash += r.amount;
        else w.receiptOther += r.amount;
      });
    }
    if (ws) {
      (ws.cashmoves || []).forEach(function (m) {
        if (m.date !== date) return;
        if (m.kind === 'in') sum.cashIn += m.amount;
        else if (m.kind === 'out') sum.cashOut += m.amount;
      });
    }
    sum.drawerCash = sum.cash + sum.depositIn.cash - sum.depositRefund.cash + w.cashOnDelivery + w.receiptCash + sum.cashIn - sum.cashOut;
    return sum;
  }

  // ================= レジ締め（端末ごと） =================
  var DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
  /** 金種ごとの枚数 → 合計 */
  function countCash(den) {
    return DENOMS.reduce(function (s, d) { return s + d * (Number(den && den[d]) || 0); }, 0);
  }
  function devOf(x, key) { return (x && x[key || 'dev']) || ''; }
  /**
   * その端末のレジの理論在高（あるべき現金）
   * 釣銭準備金 ＋ 現金売上（返品・返金を含む）＋ 前受金の受取 − 返金 ＋ 卸の現金回収 ＋ 入金 − 出金
   * @param dev 端末の記号（null ならすべての端末）
   */
  function drawerSummary(data, date, dev) {
    function mine(x, key) { return dev == null || devOf(x, key) === dev; }
    var sales = (data.sales || []).filter(function (s) { return mine(s); });
    var res = (data.reservations || []).map(function (r) {
      var x = { deposit: r.deposit, depositMethod: r.depositMethod };
      if (mine(r, 'depositDev')) x.depositDate = r.depositDate;
      if (mine(r, 'refundDev')) x.depositRefundDate = r.depositRefundDate;
      return x;
    });
    var ws = {
      slips: (data.slips || []).filter(function (s) { return s.payment === 'cash' && mine(s, 'deliveredDev'); }),
      receipts: (data.receipts || []).filter(function (r) { return mine(r); }),
      cashmoves: (data.cashmoves || []).filter(function (m) { return mine(m); })
    };
    var sum = summarizeDay(sales, res, date, ws);
    var float = 0;
    ws.cashmoves.forEach(function (m) { if (m.date === date && m.kind === 'float') float = m.amount; });
    return { sum: sum, float: float, expected: float + sum.drawerCash };
  }

  // ================= 一部返品 =================
  /**
   * 返品の返金額
   * @param sale 元の取引
   * @param sel { 行番号: 返品する数量（g または 個） }
   * @returns { lines: [{ idx, ..., qty, amount }], byRate, total } 金額はプラス
   */
  function returnAmount(sale, sel, mode) {
    var returned = sale.returned || {};
    var t = sale.totals;
    var factor = t.subtotal ? t.total / t.subtotal : 1; // 小計値引きの按分
    var lines = [];
    var allBack = true;
    sale.lines.forEach(function (l, i) {
      var left = l.qty - (returned[i] || 0);
      var r = Math.min(left, Number(sel[i]) || 0);
      if (r < left) allBack = false;
      if (!(r > 0)) return;
      // base：小計値引き前の金額（商品別の集計用）。残りを全部返すときは、残りちょうど
      var base = r === left ? l.amount - Math.round((l.amount * (returned[i] || 0)) / l.qty) : Math.round((l.amount * r) / l.qty);
      lines.push({
        idx: i, productId: l.productId, name: l.name, unit: l.unit, price: l.price, taxRate: l.taxRate, qty: r,
        base: base, amount: Math.round(base * factor)
      });
    });
    var remain = t.total - (sale.refunded || 0);
    var total = lines.reduce(function (s, l) { return s + l.amount; }, 0);
    if (allBack && lines.length) {
      // 残りを全部返品するときは、残額ちょうどを返金（端数のずれを残さない）
      var diff = remain - total;
      lines[lines.length - 1].amount += diff;
      total = remain;
    }
    total = Math.min(total, remain);
    var g = {};
    lines.forEach(function (l) { g[l.taxRate] = (g[l.taxRate] || 0) + l.amount; });
    var byRate = Object.keys(g).map(Number).sort(function (a, b) { return a - b; }).map(function (rate) {
      return { rate: rate, amount: g[rate], tax: includedTax(g[rate], rate) };
    });
    return { lines: lines, byRate: byRate, total: total, all: allBack };
  }

  // ================= タイムセール・まとめ売り =================
  function hhmm(d) { return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function ymdOf(d) { return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  /** その日時に有効か（曜日・期間・時間帯） */
  function promoActive(p, now) {
    if (!p || !p.active) return false;
    var date = ymdOf(now);
    if (p.dateFrom && date < p.dateFrom) return false;
    if (p.dateTo && date > p.dateTo) return false;
    if (p.days && p.days.length && p.days.indexOf(now.getDay()) < 0) return false;
    var t = hhmm(now);
    if (p.timeFrom && t < p.timeFrom) return false;
    if (p.timeTo && t >= p.timeTo) return false;
    return true;
  }
  function promoHits(p, line, productsById) {
    if (p.target === 'all') return true;
    if (p.target === 'category') {
      var pr = productsById[line.productId];
      return !!pr && (p.ids || []).indexOf(pr.category) >= 0;
    }
    return (p.ids || []).indexOf(line.productId) >= 0;
  }
  /**
   * カートにタイムセール・まとめ売りを当てる。手動で値引きした行・金額入力の行は対象外。
   * まとめ売り（例：焼き鳥どれでも5本で500円）を先に当て、当たった行にはタイムセールを重ねない。
   * @returns { 行key: { amount, name } }
   */
  function applyPromos(lines, promos, products, now, mode) {
    var byId = {};
    (products || []).forEach(function (p) { byId[p.id] = p; });
    var out = {};
    var active = (promos || []).filter(function (p) { return promoActive(p, now); });
    var eligible = lines.filter(function (l) { return !(l.discount && l.discount.value) && l.unit !== 'open'; });
    var inBundle = {};
    active.filter(function (p) { return p.type === 'bundle' && p.bundleQty > 1 && p.bundlePrice > 0; }).forEach(function (p) {
      var units = [];
      eligible.forEach(function (l) {
        if (l.unit !== 'pc' || inBundle[l.key] || !promoHits(p, l, byId)) return;
        for (var i = 0; i < l.qty; i++) units.push({ key: l.key, price: l.price });
      });
      var sets = Math.floor(units.length / p.bundleQty);
      if (!sets) return;
      units.sort(function (a, b) { return b.price - a.price; }); // 高い商品からまとめる（お客様に有利）
      var chosen = units.slice(0, sets * p.bundleQty);
      var regular = chosen.reduce(function (s, u) { return s + u.price; }, 0);
      var disc = regular - sets * p.bundlePrice;
      if (disc <= 0) return;
      var perKey = {};
      chosen.forEach(function (u) { perKey[u.key] = (perKey[u.key] || 0) + u.price; });
      var keys = Object.keys(perKey);
      var given = 0;
      keys.forEach(function (k, i) {
        var a = i === keys.length - 1 ? disc - given : Math.floor((disc * perKey[k]) / regular);
        given += a;
        out[k] = { amount: a, name: p.name };
        inBundle[k] = true;
      });
    });
    active.filter(function (p) { return p.type === 'timesale' && p.value > 0; }).forEach(function (p) {
      eligible.forEach(function (l) {
        if (inBundle[l.key] || !promoHits(p, l, byId)) return;
        var base = lineBase(l, mode);
        var a = p.discountType === 'pct' ? roundBy((base * p.value) / 100, mode)
          : l.unit === 'g' ? roundBy((p.value * l.qty) / 100, mode) : p.value * l.qty; // 円引きは 100gあたり／1個あたり
        a = Math.min(base, a);
        if (!out[l.key] || out[l.key].amount < a) out[l.key] = { amount: a, name: p.name };
      });
    });
    return out;
  }

  // ================= 売上分析 =================
  /**
   * 期間の店頭売上の分析（返品は差し引き、取消は除く）
   */
  function analyze(sales, from, to, products) {
    var cat = {};
    (products || []).forEach(function (p) { cat[p.id] = p.category; });
    var r = {
      total: 0, count: 0, days: {}, byHour: [], byWeekday: [], items: {}, byCategory: {}, byStaff: {}, byPayment: {}, returns: 0, discount: 0
    };
    for (var h = 0; h < 24; h++) r.byHour.push({ total: 0, count: 0 });
    for (var w = 0; w < 7; w++) r.byWeekday.push({ total: 0, count: 0, days: {} });
    sales.forEach(function (s) {
      if (s.void || s.date < from || s.date > to) return;
      var t = s.totals.total;
      var d = new Date(s.at);
      var isRet = s.kind === 'return';
      r.total += t;
      if (isRet) r.returns -= t; else r.count++;
      r.discount += (s.totals.discount || 0) + (s.totals.lineDiscount || 0);
      r.days[s.date] = (r.days[s.date] || 0) + t;
      r.byHour[d.getHours()].total += t;
      if (!isRet) r.byHour[d.getHours()].count++;
      var wd = r.byWeekday[d.getDay()];
      wd.total += t;
      if (!isRet) wd.count++;
      wd.days[s.date] = true;
      var st = s.staff || '（未設定）';
      var x = r.byStaff[st] || (r.byStaff[st] = { total: 0, count: 0 });
      x.total += t;
      if (!isRet) x.count++;
      var p = salePayments(s);
      if (p.cash) r.byPayment['現金'] = (r.byPayment['現金'] || 0) + p.cash;
      if (p.cashless) { var ct = s.cashlessType || 'キャッシュレス'; r.byPayment[ct] = (r.byPayment[ct] || 0) + p.cashless; }
      if (p.deposit) r.byPayment['前受金'] = (r.byPayment['前受金'] || 0) + p.deposit;
      s.lines.forEach(function (l) {
        var it = r.items[l.name] || (r.items[l.name] = { name: l.name, unit: l.unit, qty: 0, amount: 0 });
        var amt = l.itemAmount != null ? l.itemAmount : l.amount;
        it.qty += l.unit === 'open' ? (isRet ? -1 : 1) : l.qty;
        it.amount += amt;
        var c = cat[l.productId] || 'その他';
        r.byCategory[c] = (r.byCategory[c] || 0) + amt;
      });
    });
    r.avg = r.count ? Math.round(r.total / r.count) : 0;
    r.byWeekday.forEach(function (x) { x.dayCount = Object.keys(x.days).length; delete x.days; });
    // ABC分析：売上の大きい順に、その商品までの累計が 70% 以内なら A、90% 以内なら B、それ以外は C（1位は必ず A）
    var list = Object.keys(r.items).map(function (k) { return r.items[k]; }).filter(function (i) { return i.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var sumAmt = list.reduce(function (s, i) { return s + i.amount; }, 0) || 1;
    var acc = 0;
    list.forEach(function (i, n) {
      acc += i.amount;
      i.share = i.amount / sumAmt;
      i.cum = acc / sumAmt;
      i.rank = n === 0 || i.cum <= 0.7 + 1e-9 ? 'A' : i.cum <= 0.9 + 1e-9 ? 'B' : 'C';
    });
    r.ranking = list;
    return r;
  }

  // ================= 発注の提案 =================
  /**
   * 発注点を下回る商品の発注量の提案
   * 使える量 = 在庫 − 引当 ＋ 発注済み（未入荷）。発注点を下回ったら、適正在庫（未設定なら発注点の2倍）まで発注。
   * 重さの商品は 1kg 単位（orderLot で変更可）に切り上げ
   */
  function suggestOrder(products, stock, alloc, onOrder) {
    var out = [];
    products.forEach(function (p) {
      if (!p.trackStock || !(p.minStock > 0)) return;
      var avail = (stock[p.id] || 0) - (alloc[p.id] || 0) + (onOrder[p.id] || 0);
      if (avail >= p.minStock) return;
      var target = p.parStock > 0 ? p.parStock : p.minStock * 2;
      var lot = p.orderLot > 0 ? p.orderLot : (p.unit === 'g' ? 1000 : 1);
      var qty = Math.ceil((target - avail) / lot) * lot;
      if (qty > 0) out.push({ productId: p.id, name: p.name, unit: p.unit, supplier: p.supplier || '', avail: avail, qty: qty });
    });
    return out;
  }

  // ================= 卸 =================
  // 卸の単価は税抜。グラム売りは 1kg あたり、個数売りは 1個あたり。数量は g または 個。

  function wsLineAmount(line, mode) {
    if (line.unit === 'g') return roundBy((line.price * line.qty) / 1000, mode);
    return line.price * line.qty;
  }

  /**
   * 卸伝票・請求書の合計（税率ごとに1回だけ端数処理＝適格請求書のルール）
   * 行の priceMode が 'incl' なら税込単価（内税）、それ以外は税抜単価（外税）。
   * 返す byRate の amount は税抜の対象額、incl は税込の対象額。
   */
  function wsTotals(lines, mode) {
    var g = {};
    lines.forEach(function (l) {
      var amt = l.amount != null ? l.amount : wsLineAmount(l, mode);
      var x = g[l.taxRate] || (g[l.taxRate] = { excl: 0, incl: 0 });
      if (l.priceMode === 'incl') x.incl += amt; else x.excl += amt;
    });
    var byRate = Object.keys(g).map(Number).sort(function (a, b) { return a - b; }).map(function (rate) {
      var x = g[rate];
      var taxExcl = Math.floor((x.excl * rate) / 100);          // 外税：税抜合計 × 税率
      var taxIncl = Math.floor((x.incl * rate) / (100 + rate)); // 内税：税込合計 × 税率/(100+税率)
      var amount = x.excl + (x.incl - taxIncl);
      var tax = taxExcl + taxIncl;
      return { rate: rate, amount: amount, tax: tax, incl: amount + tax };
    });
    var subtotal = byRate.reduce(function (s, r) { return s + r.amount; }, 0);
    var tax = byRate.reduce(function (s, r) { return s + r.tax; }, 0);
    return { byRate: byRate, subtotal: subtotal, tax: tax, total: subtotal + tax };
  }

  /** 締め日（1〜28、31=月末）から、基準日以前で直近の締め日を求める */
  function lastClosingDate(baseDate, closingDay) {
    var p = baseDate.split('-').map(Number);
    function closing(y, m) { // m: 1-12
      var last = new Date(y, m, 0).getDate();
      var d = closingDay >= 29 ? last : Math.min(closingDay, last);
      return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    }
    var c = closing(p[0], p[1]);
    if (c <= baseDate) return c;
    return p[1] === 1 ? closing(p[0] - 1, 12) : closing(p[0], p[1] - 1);
  }

  /** 売掛金の残高（掛けで納品した額 − 入金額） */
  function receivableBalance(customerId, slips, receipts) {
    var billed = 0;
    slips.forEach(function (s) {
      if (s.customerId === customerId && s.status === 'delivered' && s.payment === 'credit') billed += s.totals.total;
    });
    var paid = 0;
    receipts.forEach(function (r) { if (r.customerId === customerId) paid += r.amount; });
    return billed - paid;
  }

  /** 取引先の最新の請求書（複数端末で番号が重なっても作成日時で判断） */
  function latestInvoice(customerId, invoices) {
    return invoices.filter(function (i) { return i.customerId === customerId; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || '') || a.no - b.no; }).pop() || null;
  }

  /**
   * 請求書の計算
   * 前回請求額 − 入金額 = 繰越額、繰越額 + 今回お買上額（税込）= 今回請求額
   */
  function buildInvoice(customerId, periodTo, slips, receipts, invoices, mode) {
    var prev = latestInvoice(customerId, invoices);
    var targetSlips = slips.filter(function (s) {
      return s.customerId === customerId && s.status === 'delivered' && s.payment === 'credit' && !s.invoiceId && s.date <= periodTo;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.no - b.no; });
    var targetReceipts = receipts.filter(function (r) { return r.customerId === customerId && !r.invoiceId && r.date <= periodTo; });
    var lines = [];
    targetSlips.forEach(function (s) { s.lines.forEach(function (l) { lines.push(l); }); });
    var t = wsTotals(lines, mode);
    var prevBilled = prev ? prev.billed : 0;
    var received = targetReceipts.reduce(function (s, r) { return s + r.amount; }, 0);
    var carry = prevBilled - received;
    return {
      customerId: customerId,
      periodFrom: targetSlips.length ? targetSlips[0].date : periodTo,
      periodTo: periodTo,
      prevInvoiceId: prev ? prev.id : null,
      slipIds: targetSlips.map(function (s) { return s.id; }),
      receiptIds: targetReceipts.map(function (r) { return r.id; }),
      prevBilled: prevBilled,
      received: received,
      carry: carry,
      byRate: t.byRate,
      subtotal: t.subtotal,
      tax: t.tax,
      purchase: t.total,
      billed: carry + t.total
    };
  }

  // ================= 在庫 =================

  /**
   * 在庫数を記録から計算する（複数の端末で同時に販売しても数がずれないよう、数を足し引きして保存せず毎回計算）
   *  - 在庫の記録(moves)：入荷・加工・廃棄・調整は増減、棚卸は「その時点の実在庫」
   *  - 店頭の売上：販売で減り、取消で戻る
   *  - 卸の伝票：納品で減り、納品後の取消で戻る
   * @param until この日時より前の記録だけで計算（省略時はすべて）
   */
  function computeStock(moves, sales, slips, until) {
    var ev = [];
    moves.forEach(function (m) {
      ev.push({ at: m.at, pid: m.productId, d: m.delta || 0, set: m.type === 'count' && m.actual != null ? m.actual : null });
    });
    sales.forEach(function (s) {
      s.lines.forEach(function (l) {
        if (!l.productId || l.unit === 'open') return;
        ev.push({ at: s.at, pid: l.productId, d: -l.qty });
        if (s.void && s.voidAt) ev.push({ at: s.voidAt, pid: l.productId, d: l.qty });
      });
    });
    slips.forEach(function (s) {
      if (!s.deliveredAt) return;
      s.lines.forEach(function (l) {
        ev.push({ at: s.deliveredAt, pid: l.productId, d: -l.qty });
        if (s.status === 'cancelled' && s.cancelledAt) ev.push({ at: s.cancelledAt, pid: l.productId, d: l.qty });
      });
    });
    if (until) ev = ev.filter(function (e) { return e.at < until; });
    ev.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    var st = {};
    ev.forEach(function (e) {
      if (e.set != null) st[e.pid] = e.set;
      else st[e.pid] = (st[e.pid] || 0) + e.d;
    });
    return st;
  }

  /** 引当数：今日以降の予約（未受渡）と卸の受注（未納品） */
  function allocated(reservations, slips, today) {
    var a = {};
    function add(it) {
      if (!it.productId || it.unit === 'open') return;
      a[it.productId] = (a[it.productId] || 0) + it.qty;
    }
    reservations.forEach(function (r) {
      if (r.date >= today && isActiveReservation(r)) r.items.forEach(add);
    });
    slips.forEach(function (s) { if (s.status === 'order') s.lines.forEach(add); });
    return a;
  }

  // ================= 掛売り（得意先ごとの売掛金） =================

  function ymd(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }

  /**
   * 支払期限。締め日から months か月後の day 日（29以上は月末）
   * 例：月末締め・翌月末払い → dueDate('2026-11-30', 1, 31) = '2026-12-31'
   */
  function dueDate(closingDate, months, day) {
    var p = closingDate.split('-').map(Number);
    var y = p[0];
    var m = p[1] + (months || 0);
    while (m > 12) { m -= 12; y++; }
    var last = new Date(y, m, 0).getDate();
    return ymd(y, m, day >= 29 ? last : Math.min(day, last));
  }

  function byCreated(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || '') || a.no - b.no; }

  /**
   * 請求書ごとの入金状況。得意先の入金を古い請求書から順に充てる（消込）。
   * 各請求書で充てる対象は、その請求書の「今回お買上額（税込）」。
   * @returns { 請求書ID: { amount, paid, remaining, status: 'paid'|'partial'|'unpaid', overdue } }
   */
  function invoiceStatus(customerId, invoices, receipts, today) {
    var pool = 0;
    receipts.forEach(function (r) { if (r.customerId === customerId) pool += r.amount; });
    var out = {};
    invoices.filter(function (i) { return i.customerId === customerId; }).sort(byCreated).forEach(function (i) {
      var amount = i.purchase;
      var paid = Math.max(0, Math.min(amount, pool));
      pool -= paid;
      var remaining = amount - paid;
      out[i.id] = {
        amount: amount, paid: paid, remaining: remaining,
        status: remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        overdue: remaining > 0 && !!i.dueDate && i.dueDate < today
      };
    });
    return out;
  }

  /**
   * 得意先元帳：納品（掛け）・入金・請求を日付順に並べ、売掛残高の推移を出す
   * @returns [{ date, kind: 'delivery'|'receipt'|'invoice', ref, debit, credit, balance, item }]
   */
  function customerLedger(customerId, slips, receipts, invoices) {
    var rows = [];
    slips.forEach(function (s) {
      if (s.customerId === customerId && s.status === 'delivered' && s.payment === 'credit') {
        rows.push({ date: s.date, kind: 'delivery', order: 0, debit: s.totals.total, credit: 0, item: s });
      }
    });
    invoices.forEach(function (i) {
      if (i.customerId === customerId) rows.push({ date: i.issueDate, kind: 'invoice', order: 1, debit: 0, credit: 0, item: i });
    });
    receipts.forEach(function (r) {
      if (r.customerId === customerId) rows.push({ date: r.date, kind: 'receipt', order: 2, debit: 0, credit: r.amount, item: r });
    });
    rows.sort(function (a, b) { return a.date.localeCompare(b.date) || a.order - b.order; });
    var bal = 0;
    rows.forEach(function (r) { bal += r.debit - r.credit; r.balance = bal; });
    return rows;
  }

  /**
   * 得意先ごとの売掛金のまとめ
   * balance 売掛残高 / unbilled 未請求（締め前の納品）/ billedUnpaid 請求済で未入金 / overdue うち支払期限切れ / nextDue 次の支払期限
   */
  function receivableSummary(customerId, slips, receipts, invoices, today) {
    var st = invoiceStatus(customerId, invoices, receipts, today);
    var billedUnpaid = 0;
    var overdue = 0;
    var nextDue = '';
    invoices.forEach(function (i) {
      var x = st[i.id];
      if (!x || x.remaining <= 0) return;
      billedUnpaid += x.remaining;
      if (x.overdue) overdue += x.remaining;
      else if (i.dueDate && (!nextDue || i.dueDate < nextDue)) nextDue = i.dueDate;
    });
    var unbilled = 0;
    slips.forEach(function (s) {
      if (s.customerId === customerId && s.status === 'delivered' && s.payment === 'credit' && !s.invoiceId) unbilled += s.totals.total;
    });
    return {
      balance: receivableBalance(customerId, slips, receipts),
      unbilled: unbilled, billedUnpaid: billedUnpaid, overdue: overdue, nextDue: nextDue, invoices: st
    };
  }

  var Calc = {
    DENOMS: DENOMS,
    countCash: countCash,
    drawerSummary: drawerSummary,
    returnAmount: returnAmount,
    promoActive: promoActive,
    applyPromos: applyPromos,
    analyze: analyze,
    suggestOrder: suggestOrder,
    dueDate: dueDate,
    invoiceStatus: invoiceStatus,
    customerLedger: customerLedger,
    receivableSummary: receivableSummary,
    wsLineAmount: wsLineAmount,
    wsTotals: wsTotals,
    lastClosingDate: lastClosingDate,
    receivableBalance: receivableBalance,
    buildInvoice: buildInvoice,
    computeStock: computeStock,
    latestInvoice: latestInvoice,
    allocated: allocated,
    roundBy: roundBy,
    lineBase: lineBase,
    lineDiscount: lineDiscount,
    lineAmount: lineAmount,
    includedTax: includedTax,
    totals: totals,
    payments: payments,
    salePayments: salePayments,
    isActiveReservation: isActiveReservation,
    reservationEstimate: reservationEstimate,
    prepSummary: prepSummary,
    summarizeDay: summarizeDay
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
