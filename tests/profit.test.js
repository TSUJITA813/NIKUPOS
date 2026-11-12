const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/profit.js');

const products = [
  { id: 'p1', name: 'もも肉', unit: 'g', cost: 900 },       // 原価 900円/kg（税抜）
  { id: 'p11', name: '焼き鳥', unit: 'pc', cost: 50 },       // 原価 50円/本
  { id: 'p10', name: '唐揚げ', unit: 'g' }                   // 原価 未登録
];
function sale(id, date, time, lines, extra) {
  const total = lines.reduce((a, l) => a + l.amount, 0) - ((extra && extra.disc) || 0);
  return Object.assign({ id, date, at: date + 'T' + time + ':00', lines,
    totals: { subtotal: total, discount: 0, total, byRate: [{ rate: 8, amount: total, tax: Math.floor(total * 8 / 108) }] } }, extra || {});
}
const data = {
  products,
  sales: [
    sale('S1', '2026-11-12', '10:15', [{ productId: 'p1', name: 'もも肉', unit: 'g', qty: 1000, taxRate: 8, amount: 1620, cost: 900 }]),   // 税抜1500, 原価900
    sale('S2', '2026-11-12', '15:30', [{ productId: 'p11', name: '焼き鳥', unit: 'pc', qty: 10, taxRate: 8, amount: 1080 }]),              // 税抜1000, 原価500（今の原価）
    sale('S3', '2026-11-12', '16:00', [{ productId: 'p10', name: '唐揚げ', unit: 'g', qty: 500, taxRate: 8, amount: 540 }]),               // 原価未登録 500
    sale('S4', '2026-11-12', '16:10', [{ productId: 'p1', name: 'もも肉', unit: 'g', qty: 1000, taxRate: 8, amount: 1620 }], { void: true }),
    sale('S5', '2026-11-12', '17:00', [{ productId: 'p1', name: 'もも肉', unit: 'g', qty: -500, taxRate: 8, amount: -810, cost: 900 }], { kind: 'return' }),
    sale('S6', '2026-11-05', '10:00', [{ productId: 'p11', name: '焼き鳥', unit: 'pc', qty: 5, taxRate: 8, amount: 540 }])
  ],
  slips: [{ id: 'W1', date: '2026-11-12', status: 'delivered', deliveredAt: '2026-11-12T09:00:00',
    lines: [{ productId: 'p1', name: 'もも肉', unit: 'g', qty: 2000, taxRate: 8, amount: 2600, cost: 800 }],
    totals: { subtotal: 2600, tax: 208, total: 2808, byRate: [] } }],
  cashmoves: [
    { kind: 'out', date: '2026-11-12', at: '2026-11-12T11:00:00', amount: 1100, taxRate: 10, account: '消耗品費' },
    { kind: 'out', date: '2026-11-12', at: '2026-11-12T11:00:00', amount: 5000, taxRate: 8, account: '仕入高' },
    { kind: 'in', date: '2026-11-12', at: '2026-11-12T11:00:00', amount: 9999 }
  ],
  fixedCosts: [{ name: '家賃', amount: 90000 }]
};

test('期間：日・週（月曜はじまり）・月・年、前の期間', () => {
  assert.deepStrictEqual([P.period('week', '2026-11-12').from, P.period('week', '2026-11-12').to], ['2026-11-09', '2026-11-15']);
  assert.strictEqual(P.period('month', '2026-03-31', -1).to, '2026-02-28');
  assert.strictEqual(P.period('year', '2026-11-12').bucket, 'month');
  assert.strictEqual(P.period('day', '2026-11-12').label, '11月12日（木）');
  const prev = P.previous(P.period('day', '2026-11-12'), new Date(2026, 10, 12, 15, 0));
  assert.strictEqual(prev.period.from, '2026-11-05');
  assert.strictEqual(prev.until.getHours(), 15);
  const pm = P.previous(P.period('month', '2026-03-31'), new Date(2026, 2, 31, 12, 0));
  assert.strictEqual(pm.period.from, '2026-02-01');
  assert.ok(pm.until <= new Date(2026, 2, 0, 23, 59, 59)); // 2月末を超えない
});

test('1日の売上・原価・粗利・経費・固定費・利益の目安', () => {
  const r = P.compute(data, P.period('day', '2026-11-12'));
  assert.strictEqual(r.count, 3);                       // 取消・返品は客数に入れない
  assert.strictEqual(r.store.sales, 1620 + 1080 + 540 - 810);
  assert.strictEqual(r.wholesale.excl, 2600);
  assert.strictEqual(r.excl, 1500 + 1000 + 500 - 750 + 2600);
  assert.strictEqual(r.cost, 900 + 500 - 450 + 1600);   // 返品は原価も戻す
  assert.strictEqual(r.covered, 1500 + 1000 - 750 + 2600);
  assert.strictEqual(r.uncovered, 500);
  assert.strictEqual(r.gross, 4350 - 2550);
  assert.strictEqual(r.expenses, 1000);                 // 消耗品 1100（税込）→ 税抜1000。仕入高は除く
  assert.strictEqual(r.fixed, 3000);                    // 9万円 ÷ 30日
  const est = 1800 + Math.round(500 * (1800 / 4350));
  assert.strictEqual(r.profit, est - 1000 - 3000);
  assert.deepStrictEqual(r.noCostList, ['唐揚げ']);
  assert.strictEqual(r.buckets[10].covered, 1500);
  assert.strictEqual(r.buckets[9].cost, 1600);
  assert.strictEqual(r.itemList[0].name, 'もも肉');
  assert.strictEqual(r.itemList[0].gross, (1500 - 750 + 2600) - (900 - 450 + 1600));
});

test('今の時刻までで比べる・月と年の集計', () => {
  const r = P.compute(data, P.period('day', '2026-11-12'), { until: new Date(2026, 10, 12, 12, 0) });
  assert.strictEqual(r.count, 1); // 10:15 の1件だけ（卸 9:00 は件数に入れない）
  const m = P.compute(data, P.period('month', '2026-11-12'), { fixedUntil: '2026-11-12' });
  assert.strictEqual(m.count, 4);
  assert.strictEqual(m.fixed, 36000); // 12日分
  assert.strictEqual(Object.keys(m.buckets).length, 30);
  const y = P.compute(data, P.period('year', '2026-11-12'));
  assert.strictEqual(y.buckets[11].count, 4);
  assert.strictEqual(Object.keys(y.buckets).length, 12);
});
