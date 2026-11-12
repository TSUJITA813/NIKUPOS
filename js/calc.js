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

  var Calc = {
    roundBy: roundBy,
    lineBase: lineBase,
    lineDiscount: lineDiscount,
    lineAmount: lineAmount,
    includedTax: includedTax,
    totals: totals
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
