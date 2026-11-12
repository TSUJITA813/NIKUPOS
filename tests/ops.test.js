const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

const T = (total, rate = 8) => ({ total, subtotal: total, discount: 0, lineDiscount: 0, byRate: [{ rate, amount: total, tax: Calc.includedTax(total, rate) }] });

test('金種の合計', () => {
  assert.equal(Calc.countCash({ 10000: 2, 1000: 5, 500: 3, 100: 7, 10: 4, 1: 9 }), 20000 + 5000 + 1500 + 700 + 40 + 9);
  assert.equal(Calc.countCash({}), 0);
});

test('レジ締め：端末ごとの理論在高（準備金＋現金売上＋前受金＋卸現金＋入金−出金、キャッシュレス内訳）', () => {
  const D = '2026-11-12';
  const data = {
    sales: [
      { date: D, dev: 'A', totals: T(5000), lines: [], payments: { deposit: 0, cash: 5000, cashless: 0 } },
      { date: D, dev: 'A', totals: T(3000), lines: [], payments: { deposit: 0, cash: 0, cashless: 3000 }, cashlessType: 'クレジット' },
      { date: D, dev: 'A', totals: T(1000), lines: [], payments: { deposit: 0, cash: 0, cashless: 1000 }, cashlessType: 'QR決済' },
      { date: D, dev: 'A', kind: 'return', totals: T(-500), lines: [], payments: { deposit: 0, cash: -500, cashless: 0 } },
      { date: D, dev: 'B', totals: T(9999), lines: [], payments: { deposit: 0, cash: 9999, cashless: 0 } }
    ],
    reservations: [{ deposit: 2000, depositMethod: 'cash', depositDate: D, depositDev: 'A' }],
    slips: [{ date: D, status: 'delivered', payment: 'cash', deliveredDev: 'A', totals: { total: 4000 } }],
    receipts: [{ date: D, method: 'cash', amount: 1500, dev: 'B' }],
    cashmoves: [
      { date: D, dev: 'A', kind: 'float', amount: 30000 },
      { date: D, dev: 'A', kind: 'out', amount: 800 },
      { date: D, dev: 'A', kind: 'in', amount: 10000 },
      { date: D, dev: 'A', kind: 'exchange', amount: 5000 }
    ]
  };
  const a = Calc.drawerSummary(data, D, 'A');
  assert.equal(a.float, 30000);
  assert.equal(a.sum.cash, 4500);
  assert.deepEqual(a.sum.cashlessBy, { 'クレジット': 3000, 'QR決済': 1000 });
  assert.deepEqual(a.sum.returns, { count: 1, amount: 500 });
  assert.equal(a.sum.count, 3, '返品は客数に数えない');
  assert.equal(a.expected, 30000 + 4500 + 2000 + 4000 + 10000 - 800);
  const b = Calc.drawerSummary(data, D, 'B');
  assert.equal(b.expected, 9999 + 1500);
});

test('一部返品：数量に応じた返金、小計値引きの按分、全部返すときは残額ちょうど', () => {
  const sale = {
    totals: { subtotal: 2000, discount: 200, total: 1800, byRate: [] },
    lines: [
      { productId: 'a', name: 'もも肉', unit: 'g', price: 158, qty: 500, taxRate: 8, amount: 790 },
      { productId: 'b', name: '焼き鳥', unit: 'pc', price: 121, qty: 10, taxRate: 8, amount: 1210 }
    ]
  };
  const r1 = Calc.returnAmount(sale, { 1: 3 }, 'floor');
  assert.equal(r1.lines[0].amount, Math.round(1210 * 3 / 10 * 0.9)); // 327
  assert.equal(r1.lines[0].base, 363, '小計値引き前の金額（商品別の集計用）');
  assert.equal(r1.total, 327);
  assert.deepEqual(r1.byRate, [{ rate: 8, amount: 327, tax: Calc.includedTax(327, 8) }]);
  // 1回目の返品を記録してから、残りを全部返品
  sale.returned = { 1: 3 };
  sale.refunded = 327;
  const r2 = Calc.returnAmount(sale, { 0: 500, 1: 7 }, 'floor');
  assert.equal(r2.all, true);
  assert.equal(r2.total, 1800 - 327);
  assert.equal(r2.lines[1].base, 1210 - 363, '残りを全部返すときは、値引き前の金額も残りちょうど');
  // すでに返品した数量を超えては返せない
  const r3 = Calc.returnAmount(sale, { 1: 99 }, 'floor');
  assert.equal(r3.lines[0].qty, 7);
});

const lines = [
  { key: 'L1', productId: 'yk1', unit: 'pc', price: 120, qty: 3 },
  { key: 'L2', productId: 'yk2', unit: 'pc', price: 130, qty: 3 },
  { key: 'L3', productId: 'kara', unit: 'g', price: 248, qty: 400 },
  { key: 'L4', productId: 'momo', unit: 'g', price: 158, qty: 300, discount: { type: 'pct', value: 50 } }
];
const products = [
  { id: 'yk1', category: '惣菜' }, { id: 'yk2', category: '惣菜' }, { id: 'kara', category: '惣菜' }, { id: 'momo', category: '生肉' }
];
const at = (h, m = 0, day = '2026-11-12') => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };

test('タイムセールの有効判定（時間帯・曜日・期間）', () => {
  const p = { active: true, timeFrom: '18:00', timeTo: '20:00', days: [4], dateFrom: '2026-11-01', dateTo: '2026-11-30' }; // 2026-11-12 は木曜(4)
  assert.equal(Calc.promoActive(p, at(18, 0)), true);
  assert.equal(Calc.promoActive(p, at(17, 59)), false);
  assert.equal(Calc.promoActive(p, at(20, 0)), false);
  assert.equal(Calc.promoActive(p, at(18, 30, '2026-11-13')), false, '金曜は対象外');
  assert.equal(Calc.promoActive(Object.assign({}, p, { active: false }), at(18, 30)), false);
});

test('まとめ売り（5本で500円）は高い商品から、タイムセール（惣菜2割引）は残りの行に。手動値引きの行は対象外', () => {
  const promos = [
    { active: true, type: 'bundle', name: '焼き鳥5本500円', target: 'product', ids: ['yk1', 'yk2'], bundleQty: 5, bundlePrice: 500 },
    { active: true, type: 'timesale', name: '惣菜2割引', target: 'category', ids: ['惣菜', '生肉'], discountType: 'pct', value: 20, timeFrom: '18:00' }
  ];
  const r = Calc.applyPromos(lines, promos, products, at(18, 30), 'floor');
  // 6本のうち高い5本：130×3 + 120×2 = 630 → 500円、値引き130
  assert.equal(r.L1.amount + r.L2.amount, 130);
  assert.equal(r.L1.name, '焼き鳥5本500円');
  // 唐揚げ 400g × 248円/100g = 992 → 2割引 198
  assert.deepEqual(r.L3, { amount: 198, name: '惣菜2割引' });
  assert.equal(r.L4, undefined, '手動で半額にした行には当てない');
  // 18時前はタイムセールなし
  const r2 = Calc.applyPromos(lines, promos, products, at(17, 0), 'floor');
  assert.equal(r2.L3, undefined);
});

test('タイムセールの円引き：100gあたり・1個あたり', () => {
  const promos = [{ active: true, type: 'timesale', name: '30円引き', target: 'all', discountType: 'yen', value: 30 }];
  const r = Calc.applyPromos(lines.slice(0, 3), promos, products, at(12), 'floor');
  assert.equal(r.L1.amount, 90);
  assert.equal(r.L3.amount, 120);
});

test('行の値引きにタイムセール分を含める', () => {
  assert.equal(Calc.lineAmount({ unit: 'pc', price: 120, qty: 3, promoDiscount: 50 }, 'floor'), 310);
});

test('売上分析：時間帯・曜日・ABC・担当者・支払方法・返品', () => {
  const mk = (date, h, total, o = {}) => Object.assign({
    date, at: new Date(...date.split('-').map((x, i) => i === 1 ? x - 1 : +x), h).toISOString(), totals: T(total),
    payments: { deposit: 0, cash: total, cashless: 0 }, lines: [{ productId: 'a', name: 'もも肉', unit: 'g', qty: 100, amount: total }], staff: '山田'
  }, o);
  const sales = [
    mk('2026-11-09', 10, 7000), mk('2026-11-09', 17, 2000, { staff: '佐藤', lines: [{ productId: 'b', name: '唐揚げ', unit: 'g', qty: 100, amount: 2000 }] }),
    mk('2026-11-10', 17, 1000, { lines: [{ productId: 'c', name: 'レジ袋', unit: 'pc', qty: 1, amount: 1000 }], payments: { deposit: 0, cash: 0, cashless: 1000 }, cashlessType: 'QR決済' }),
    mk('2026-11-10', 18, -500, { kind: 'return', lines: [{ productId: 'a', name: 'もも肉', unit: 'g', qty: -50, amount: -500 }], payments: { deposit: 0, cash: -500, cashless: 0 } }),
    mk('2026-11-11', 9, 999, { void: true })
  ];
  const r = Calc.analyze(sales, '2026-11-09', '2026-11-10', [{ id: 'a', category: '生肉' }, { id: 'b', category: '惣菜' }]);
  assert.equal(r.total, 9500);
  assert.equal(r.count, 3);
  assert.equal(r.returns, 500);
  assert.equal(r.avg, Math.round(9500 / 3));
  assert.equal(r.byHour[17].total, 3000);
  assert.equal(r.byHour[17].count, 2);
  assert.equal(r.byWeekday[1].dayCount, 1); // 11/9 は月曜
  assert.deepEqual(r.ranking.map(i => [i.name, i.amount, i.rank]), [['もも肉', 6500, 'A'], ['唐揚げ', 2000, 'B'], ['レジ袋', 1000, 'C']]);
  assert.deepEqual(r.byStaff['佐藤'], { total: 2000, count: 1 });
  assert.deepEqual(r.byPayment, { '現金': 8500, 'QR決済': 1000 });
  assert.equal(r.byCategory['生肉'], 6500);
});

test('発注の提案：発注点割れを適正在庫まで（kg単位に切り上げ）', () => {
  const products = [
    { id: 'a', name: 'もも肉', unit: 'g', trackStock: true, minStock: 5000, supplier: '○○食鳥' },
    { id: 'b', name: '鶏ガラ', unit: 'pc', trackStock: true, minStock: 10, parStock: 30 },
    { id: 'c', name: 'むね肉', unit: 'g', trackStock: true, minStock: 3000 },
    { id: 'd', name: 'ささみ', unit: 'g', trackStock: false, minStock: 3000 }
  ];
  const s = Calc.suggestOrder(products, { a: 2300, b: 4, c: 5000 }, { a: 500 }, { b: 2 });
  assert.deepEqual(s.map(x => [x.name, x.qty, x.supplier]), [['もも肉', 9000, '○○食鳥'], ['鶏ガラ', 24, '']]);
});
