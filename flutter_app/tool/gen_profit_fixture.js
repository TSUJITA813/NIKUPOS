// Web版（js/profit.js）の利益計算の結果を、Flutter版のテスト用に書き出す。
//   node tool/gen_profit_fixture.js > test/fixtures/profit_cases.json
const Calc = require('../../js/calc.js');
const Profit = require('../../js/profit.js');
let seed = 777;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const products = [
  { id: 'p1', name: 'もも肉', unit: 'g', price: 158, cost: 900 }, { id: 'p2', name: 'むね肉', unit: 'g', price: 98, cost: 520 },
  { id: 'p10', name: '唐揚げ', unit: 'g', price: 248 }, { id: 'p11', name: '焼き鳥', unit: 'pc', price: 120, cost: 50 },
  { id: 'p18', name: 'その他食品', unit: 'open', price: 0 }, { id: 'p19', name: 'レジ袋', unit: 'pc', price: 5, taxRate: 10 }
];
const sales = [];
for (let i = 0; i < 400; i++) {
  const day = 1 + rnd(30), hour = 9 + rnd(10);
  const date = '2026-11-' + String(day).padStart(2, '0');
  const lines = [];
  for (let j = 0; j < 1 + rnd(4); j++) {
    const p = products[rnd(products.length)];
    const l = { productId: p.id, name: p.name, unit: p.unit, price: p.unit === 'open' ? 100 + rnd(900) : p.price, qty: p.unit === 'g' ? 100 + rnd(2000) : p.unit === 'pc' ? 1 + rnd(10) : 1, taxRate: p.taxRate || 8 };
    if (rnd(3) === 0 && p.cost) l.cost = p.cost + rnd(100) - 50; // 会計時の原価（今と違う）
    lines.push(l);
  }
  const ret = rnd(15) === 0;
  if (ret) lines.forEach((l) => { l.qty = -l.qty; });
  lines.forEach((l) => { l.amount = Calc.lineAmount(l, 'floor'); });
  const t = Calc.totals(lines, rnd(6) === 0 ? { type: 'pct', value: 10 } : null, 'floor');
  sales.push({ id: 'S' + i, date, at: new Date(2026, 10, day, hour, rnd(60)).toISOString(), lines, totals: t, kind: ret ? 'return' : undefined, void: rnd(20) === 0 });
}
const cashmoves = [
  { kind: 'out', date: '2026-11-03', at: new Date(2026, 10, 3, 10).toISOString(), amount: 1100, taxRate: 10, account: '消耗品費' },
  { kind: 'out', date: '2026-11-12', at: new Date(2026, 10, 12, 10).toISOString(), amount: 5400, taxRate: 8, account: '仕入高' },
  { kind: 'out', date: '2026-11-12', at: new Date(2026, 10, 12, 18).toISOString(), amount: 3300, taxRate: 10, account: '雑費' }
];
const fixedCosts = [{ name: '家賃', amount: 90000 }, { name: '人件費', amount: 155000 }];
const out = [];
for (const [kind, base, off] of [['day', '2026-11-12', 0], ['week', '2026-11-12', 0], ['month', '2026-11-12', 0], ['year', '2026-11-12', 0], ['day', '2026-11-12', -1]]) {
  const p = Profit.period(kind, base, off);
  const r = Profit.compute({ sales, slips: [], cashmoves, products, fixedCosts }, p, {});
  const until = new Date(2026, 10, 12, 14, 0);
  const ru = Profit.compute({ sales, slips: [], cashmoves, products, fixedCosts }, p, { until, fixedUntil: '2026-11-12' });
  const pick = (x) => ({ sales: x.sales, excl: x.excl, tax: x.tax, count: x.count, cost: x.cost, covered: x.covered, uncovered: x.uncovered, gross: x.gross, grossEst: x.grossEst, expenses: x.expenses, fixed: x.fixed, profit: x.profit,
    buckets: Object.keys(x.buckets).map((k) => [k, x.buckets[k].excl, x.buckets[k].cost, x.buckets[k].gross, x.buckets[k].count]) });
  out.push({ kind, base, off, from: p.from, to: p.to, label: p.label, all: pick(r), until: until.toISOString(), upto: pick(ru) });
}
process.stdout.write(JSON.stringify({ products, sales, cashmoves, fixedCosts, out }));
