const test = require('node:test');
const assert = require('node:assert');
const Calc = require('../js/calc.js');

test('併用：キャッシュレス5,000円＋残りを現金', () => {
  const p = Calc.payments(7340, 0, 'split', 3000, 5000);
  assert.deepStrictEqual(p, { due: 7340, deposit: 0, cash: 2340, cashless: 5000, received: 3000, change: 660, refund: 0 });
  // 現金が足りない
  assert.ok(Calc.payments(7340, 0, 'split', 2000, 5000).change < 0);
  // キャッシュレスが合計を超える入力は合計まで
  const all = Calc.payments(7340, 0, 'split', 0, 9000);
  assert.strictEqual(all.cashless, 7340);
  assert.strictEqual(all.cash, 0);
  assert.strictEqual(all.change, 0);
  // 前受金との組み合わせ
  const d = Calc.payments(7340, 1000, 'split', 1340, 5000);
  assert.strictEqual(d.cash, 1340);
  assert.strictEqual(d.change, 0);
});

test('併用の売上は現金とキャッシュレスに分けて集計される', () => {
  const sale = {
    id: 'S1', date: '2026-11-12', at: '2026-11-12T10:00:00', lines: [{ productId: 'p1', name: 'もも', unit: 'pc', price: 7340, qty: 1, taxRate: 8, amount: 7340 }],
    totals: { subtotal: 7340, discount: 0, total: 7340, count: 1, byRate: [{ rate: 8, amount: 7340, tax: 543 }] },
    method: 'split', cashlessType: 'クレジット', payments: { deposit: 0, cash: 2340, cashless: 5000 }, received: 3000, change: 660
  };
  const s = Calc.summarizeDay([sale], [], '2026-11-12');
  assert.strictEqual(s.total, 7340);
  assert.strictEqual(s.cash, 2340);
  assert.strictEqual(s.cashless, 5000);
  assert.strictEqual(s.cashlessBy['クレジット'], 5000);
});
