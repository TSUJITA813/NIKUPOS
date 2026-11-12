// 実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

test('グラム売りは100gあたり単価×重量、端数切り捨て', () => {
  assert.equal(Calc.lineAmount({ unit: 'g', price: 158, qty: 350 }, 'floor'), 553);
  assert.equal(Calc.lineAmount({ unit: 'g', price: 158, qty: 333 }, 'floor'), 526); // 526.14
  assert.equal(Calc.lineAmount({ unit: 'g', price: 155, qty: 333 }, 'round'), 516); // 516.15
  assert.equal(Calc.lineAmount({ unit: 'g', price: 155, qty: 333 }, 'ceil'), 517);
});

test('個数売り', () => {
  assert.equal(Calc.lineAmount({ unit: 'pc', price: 120, qty: 5 }, 'floor'), 600);
});

test('行の値引き（半額・円引き）', () => {
  const half = { unit: 'g', price: 158, qty: 350, discount: { type: 'pct', value: 50 } };
  assert.equal(Calc.lineDiscount(half, 'floor'), 276);
  assert.equal(Calc.lineAmount(half, 'floor'), 277);
  const yen = { unit: 'pc', price: 100, qty: 1, discount: { type: 'yen', value: 300 } };
  assert.equal(Calc.lineAmount(yen, 'floor'), 0, '値引きは行金額を超えない');
});

test('税率別集計と内税', () => {
  const t = Calc.totals([
    { unit: 'pc', price: 1080, qty: 1, taxRate: 8 },
    { unit: 'pc', price: 110, qty: 1, taxRate: 10 }
  ], null, 'floor');
  assert.equal(t.total, 1190);
  assert.deepEqual(t.byRate, [
    { rate: 8, amount: 1080, tax: 80 },
    { rate: 10, amount: 110, tax: 10 }
  ]);
});

test('小計値引きは税率ごとに按分され合計が一致する', () => {
  const t = Calc.totals([
    { unit: 'pc', price: 1000, qty: 1, taxRate: 8 },
    { unit: 'pc', price: 5, qty: 1, taxRate: 10 }
  ], { type: 'yen', value: 100 }, 'floor');
  assert.equal(t.discount, 100);
  assert.equal(t.total, 905);
  const sum = t.byRate.reduce((s, r) => s + r.amount, 0);
  assert.equal(sum, t.total);
});

test('割合の小計値引き', () => {
  const t = Calc.totals([{ unit: 'pc', price: 999, qty: 1, taxRate: 8 }], { type: 'pct', value: 10 }, 'floor');
  assert.equal(t.discount, 99);
  assert.equal(t.total, 900);
});

test('空のカート', () => {
  const t = Calc.totals([], null, 'floor');
  assert.equal(t.total, 0);
  assert.deepEqual(t.byRate, []);
});
