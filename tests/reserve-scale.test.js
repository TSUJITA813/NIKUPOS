const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');
const Scale = require('../js/scale.js');

// ---------- 前受金 ----------
test('前受金ありの現金会計：残額にだけおつりを計算', () => {
  const p = Calc.payments(3500, 1000, 'cash', 3000);
  assert.deepEqual(p, { due: 2500, deposit: 1000, cash: 2500, cashless: 0, received: 3000, change: 500, refund: 0 });
});

test('前受金ありのキャッシュレス会計', () => {
  const p = Calc.payments(3500, 1000, 'cashless');
  assert.equal(p.cashless, 2500);
  assert.equal(p.cash, 0);
});

test('前受金が合計を上回ったら差額を返金（現金マイナス）', () => {
  const p = Calc.payments(2800, 3000, 'cash', 0);
  assert.equal(p.refund, 200);
  assert.equal(p.cash, -200);
  assert.equal(p.deposit + p.cash + p.cashless, 2800);
});

// ---------- 仕込み集計 ----------
const R = (o) => Object.assign({ status: 'reserved', deposit: 0 }, o);
const reservations = [
  R({ date: '2026-12-24', items: [{ productId: 'x', name: '骨付きもも', unit: 'pc', price: 600, qty: 4, taxRate: 8 }, { productId: 'p1', name: 'もも肉', unit: 'g', price: 158, qty: 500, taxRate: 8 }] }),
  R({ date: '2026-12-24', status: 'ready', items: [{ productId: 'x', name: '骨付きもも', unit: 'pc', price: 600, qty: 2, taxRate: 8 }] }),
  R({ date: '2026-12-24', status: 'cancelled', items: [{ productId: 'x', name: '骨付きもも', unit: 'pc', price: 600, qty: 10, taxRate: 8 }] }),
  R({ date: '2026-12-24', status: 'done', items: [{ productId: 'x', name: '骨付きもも', unit: 'pc', price: 600, qty: 10, taxRate: 8 }] }),
  R({ date: '2026-12-25', items: [{ productId: 'x', name: '骨付きもも', unit: 'pc', price: 600, qty: 3, taxRate: 8 }] })
];

test('仕込み集計は取消・受渡済・別の日を除いて合計', () => {
  const s = Calc.prepSummary(reservations, '2026-12-24');
  assert.equal(s.count, 2);
  assert.deepEqual(s.items.map(i => [i.name, i.qty, i.reservations]), [['骨付きもも', 6, 2], ['もも肉', 500, 1]]);
});

test('予約の概算金額', () => {
  assert.equal(Calc.reservationEstimate(reservations[0], 'floor'), 2400 + 790);
});

// ---------- 日別集計 ----------
test('日別集計：前受金の受取・充当・返金とレジ内現金', () => {
  const totals = (t) => ({ total: t, discount: 0, lineDiscount: 0, byRate: [{ rate: 8, amount: t, tax: Calc.includedTax(t, 8) }] });
  const sales = [
    { date: 'D', method: 'cash', totals: totals(1000), lines: [] }, // 旧形式
    { date: 'D', method: 'cash', totals: totals(3500), lines: [], payments: { deposit: 1000, cash: 2500, cashless: 0 } },
    { date: 'D', method: 'cashless', totals: totals(800), lines: [], payments: { deposit: 0, cash: 0, cashless: 800 } },
    { date: 'D', method: 'cash', totals: totals(9999), lines: [], void: true }
  ];
  const res = [
    { deposit: 2000, depositMethod: 'cash', depositDate: 'D' },
    { deposit: 500, depositMethod: 'cashless', depositDate: 'D' },
    { deposit: 300, depositMethod: 'cash', depositDate: 'X', depositRefundDate: 'D' }
  ];
  const s = Calc.summarizeDay(sales, res, 'D');
  assert.equal(s.total, 5300);
  assert.equal(s.count, 3);
  assert.equal(s.voids, 1);
  assert.equal(s.cash, 3500);
  assert.equal(s.cashless, 800);
  assert.equal(s.depositUsed, 1000);
  assert.deepEqual(s.depositIn, { cash: 2000, cashless: 500 });
  assert.equal(s.drawerCash, 3500 + 2000 - 300);
});

// ---------- はかり ----------
test('はかりの文字列を解析', () => {
  assert.deepEqual(Scale.parseWeight('ST,+0000.350 kg'), { grams: 350, stable: true });
  assert.deepEqual(Scale.parseWeight('US,+00352.5  g'), { grams: 353, stable: false });
  assert.deepEqual(Scale.parseWeight('350g'), { grams: 350, stable: true });
  assert.deepEqual(Scale.parseWeight('1.25kg'), { grams: 1250, stable: true });
  assert.deepEqual(Scale.parseWeight('0.350', 'kg'), { grams: 350, stable: true });
  assert.deepEqual(Scale.parseWeight('  350  ', 'g'), { grams: 350, stable: true });
  assert.equal(Scale.parseWeight('OL,+9999.999 kg'), null);
  assert.equal(Scale.parseWeight(''), null);
  assert.equal(Scale.parseWeight('ERR'), null);
});

test('Bluetooth標準の重量データ（kg単位・0.005kg刻み）', () => {
  const dv = new DataView(new Uint8Array([0x00, 70, 0]).buffer); // 70 × 5g
  assert.deepEqual(Scale.parseWeightMeasurement(dv), { grams: 350, stable: true });
});

test('分割して届く文字データを行ごとに解析', () => {
  const seen = [];
  const off = Scale.onChange((s) => seen.push(s.reading.grams));
  Scale.feedText('ST,+0000.3', 'g');
  Scale.feedText('50 kg\r\nST,+0000.40', 'g');
  Scale.feedText('0 kg\n', 'g');
  off();
  assert.deepEqual(seen, [350, 400]);
});
