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
  function lineDiscount(line, mode) {
    var base = lineBase(line, mode);
    var d = line.discount;
    if (!d || !d.value) return 0;
    var amount = d.type === 'pct' ? roundBy((base * d.value) / 100, mode) : d.value;
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
      wholesale: { count: 0, total: 0, credit: 0, cashOnDelivery: 0, receiptCash: 0, receiptOther: 0 }
    };
    daySales.forEach(function (s) {
      if (s.void) { sum.voids++; return; }
      var p = salePayments(s);
      sum.count++;
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
        it.qty += l.unit === 'open' ? 1 : l.qty;
        it.count += 1;
        it.amount += l.amount;
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
        if (r.method === 'cash') w.receiptCash += r.amount; else w.receiptOther += r.amount;
      });
    }
    sum.drawerCash = sum.cash + sum.depositIn.cash - sum.depositRefund.cash + w.cashOnDelivery + w.receiptCash;
    return sum;
  }

  // ================= 卸 =================
  // 卸の単価は税抜。グラム売りは 1kg あたり、個数売りは 1個あたり。数量は g または 個。

  function wsLineAmount(line, mode) {
    if (line.unit === 'g') return roundBy((line.price * line.qty) / 1000, mode);
    return line.price * line.qty;
  }

  /** 卸伝票・請求書の合計（外税。税率ごとに1回だけ端数処理＝適格請求書のルール） */
  function wsTotals(lines, mode) {
    var groups = {};
    lines.forEach(function (l) {
      var amt = l.amount != null ? l.amount : wsLineAmount(l, mode);
      groups[l.taxRate] = (groups[l.taxRate] || 0) + amt;
    });
    var byRate = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).map(function (rate) {
      return { rate: rate, amount: groups[rate], tax: Math.floor((groups[rate] * rate) / 100) };
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

  /**
   * 請求書の計算
   * 前回請求額 − 入金額 = 繰越額、繰越額 + 今回お買上額（税込）= 今回請求額
   */
  function buildInvoice(customerId, periodTo, slips, receipts, invoices, mode) {
    var prev = invoices.filter(function (i) { return i.customerId === customerId; })
      .sort(function (a, b) { return a.no - b.no; }).pop() || null;
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

  /** 在庫数の変化を反映（tracked: 在庫管理する商品IDの集合） */
  function applyStock(stock, lines, sign, tracked) {
    var changed = [];
    lines.forEach(function (l) {
      if (!l.productId || l.unit === 'open' || !tracked[l.productId]) return;
      var d = sign * l.qty;
      stock[l.productId] = (stock[l.productId] || 0) + d;
      changed.push({ productId: l.productId, name: l.name, delta: d });
    });
    return changed;
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

  var Calc = {
    wsLineAmount: wsLineAmount,
    wsTotals: wsTotals,
    lastClosingDate: lastClosingDate,
    receivableBalance: receivableBalance,
    buildInvoice: buildInvoice,
    applyStock: applyStock,
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
