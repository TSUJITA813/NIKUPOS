const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

test('卸の行金額：kg単価×グラム、個数', () => {
  assert.equal(Calc.wsLineAmount({ unit: 'g', price: 1300, qty: 5250 }, 'floor'), 6825);
  assert.equal(Calc.wsLineAmount({ unit: 'g', price: 1300, qty: 333 }, 'floor'), 432); // 432.9
  assert.equal(Calc.wsLineAmount({ unit: 'pc', price: 80, qty: 10 }, 'floor'), 800);
});

test('卸の合計は税率ごとに1回だけ端数処理（外税）', () => {
  const t = Calc.wsTotals([
    { taxRate: 8, amount: 999 }, { taxRate: 8, amount: 999 }, { taxRate: 10, amount: 55 }
  ]);
  // 行ごとに切り捨てると 79+79=158 だが、合算 1998×8% = 159.84 → 159
  assert.deepEqual(t.byRate, [{ rate: 8, amount: 1998, tax: 159 }, { rate: 10, amount: 55, tax: 5 }]);
  assert.equal(t.subtotal, 2053);
  assert.equal(t.tax, 164);
  assert.equal(t.total, 2217);
});

test('締め日の計算', () => {
  assert.equal(Calc.lastClosingDate('2026-11-12', 31), '2026-10-31');
  assert.equal(Calc.lastClosingDate('2026-11-30', 31), '2026-11-30');
  assert.equal(Calc.lastClosingDate('2026-11-20', 20), '2026-11-20');
  assert.equal(Calc.lastClosingDate('2026-11-19', 20), '2026-10-20');
  assert.equal(Calc.lastClosingDate('2026-01-10', 20), '2025-12-20');
  assert.equal(Calc.lastClosingDate('2026-03-01', 31), '2026-02-28');
});

const slip = (o) => Object.assign({ status: 'delivered', payment: 'credit', customerId: 'c1', lines: [] }, o);
const tot = (sub, rate = 8) => ({ byRate: [{ rate, amount: sub, tax: Math.floor(sub * rate / 100) }], subtotal: sub, tax: Math.floor(sub * rate / 100), total: sub + Math.floor(sub * rate / 100) });

test('売掛残高：掛けの納品額 − 入金（現金払い・受注・他社は除く）', () => {
  const slips = [
    slip({ totals: tot(10000) }),
    slip({ totals: tot(5000), payment: 'cash' }),
    slip({ totals: tot(3000), status: 'order' }),
    slip({ totals: tot(7000), customerId: 'c2' })
  ];
  assert.equal(Calc.receivableBalance('c1', slips, [{ customerId: 'c1', amount: 4000 }]), 10800 - 4000);
});

test('請求書：前回請求・入金・繰越・今回お買上・今回請求', () => {
  const slips = [
    slip({ id: 'w1', no: 1, date: '2026-11-05', lines: [{ taxRate: 8, amount: 10000 }] }),
    slip({ id: 'w2', no: 2, date: '2026-11-20', lines: [{ taxRate: 8, amount: 5000 }, { taxRate: 10, amount: 1000 }] }),
    slip({ id: 'w3', no: 3, date: '2026-12-02', lines: [{ taxRate: 8, amount: 9999 }] }), // 期間外
    slip({ id: 'w4', no: 4, date: '2026-11-10', invoiceId: 'old', lines: [{ taxRate: 8, amount: 1 }] }) // 請求済
  ];
  const receipts = [{ id: 'r1', customerId: 'c1', date: '2026-11-25', amount: 20000 }];
  const invoices = [{ id: 'i0', no: 1, customerId: 'c1', billed: 21600 }];
  const inv = Calc.buildInvoice('c1', '2026-11-30', slips, receipts, invoices, 'floor');
  assert.deepEqual(inv.slipIds, ['w1', 'w2']);
  assert.deepEqual(inv.receiptIds, ['r1']);
  assert.equal(inv.periodFrom, '2026-11-05');
  assert.equal(inv.prevBilled, 21600);
  assert.equal(inv.received, 20000);
  assert.equal(inv.carry, 1600);
  assert.equal(inv.subtotal, 16000);
  assert.equal(inv.tax, 1200 + 100);
  assert.equal(inv.purchase, 17300);
  assert.equal(inv.billed, 18900);
});

test('在庫の増減は在庫管理する商品だけ', () => {
  const stock = { a: 1000 };
  const changed = Calc.applyStock(stock, [
    { productId: 'a', unit: 'g', qty: 350, name: 'A' },
    { productId: 'b', unit: 'pc', qty: 2, name: 'B' },
    { productId: 'c', unit: 'open', qty: 1, name: 'C' }
  ], -1, { a: true, c: true });
  assert.deepEqual(stock, { a: 650 });
  assert.equal(changed.length, 1);
});

test('引当：今日以降の未受渡の予約と、未納品の卸受注', () => {
  const a = Calc.allocated([
    { date: '2026-11-12', status: 'reserved', items: [{ productId: 'a', unit: 'g', qty: 500 }] },
    { date: '2026-11-11', status: 'reserved', items: [{ productId: 'a', unit: 'g', qty: 999 }] },
    { date: '2026-11-13', status: 'done', items: [{ productId: 'a', unit: 'g', qty: 999 }] }
  ], [
    { status: 'order', lines: [{ productId: 'a', unit: 'g', qty: 2000 }] },
    { status: 'delivered', lines: [{ productId: 'a', unit: 'g', qty: 999 }] }
  ], '2026-11-12');
  assert.deepEqual(a, { a: 2500 });
});

test('日別集計：卸の現金回収はレジ内現金に含める', () => {
  const s = Calc.summarizeDay([], [], 'D', {
    slips: [
      { date: 'D', status: 'delivered', payment: 'cash', totals: { total: 5400 } },
      { date: 'D', status: 'delivered', payment: 'credit', totals: { total: 10800 } },
      { date: 'D', status: 'order', payment: 'cash', totals: { total: 999 } }
    ],
    receipts: [{ date: 'D', method: 'cash', amount: 3000 }, { date: 'D', method: 'transfer', amount: 50000 }]
  });
  assert.equal(s.wholesale.total, 16200);
  assert.equal(s.wholesale.count, 2);
  assert.equal(s.drawerCash, 5400 + 3000);
});
