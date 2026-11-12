const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

test('支払期限：月末締め・翌月末払いなど', () => {
  assert.equal(Calc.dueDate('2026-11-30', 1, 31), '2026-12-31');
  assert.equal(Calc.dueDate('2026-12-31', 1, 31), '2027-01-31');
  assert.equal(Calc.dueDate('2026-12-20', 1, 10), '2027-01-10');
  assert.equal(Calc.dueDate('2026-12-31', 2, 31), '2027-02-28');
  assert.equal(Calc.dueDate('2026-11-30', 0, 31), '2026-11-30');
});

const inv = (id, created, purchase, due) => ({ id, customerId: 'c1', no: 1, createdAt: created, purchase, dueDate: due });

test('入金は古い請求書から順に充てる（消込）', () => {
  const invoices = [inv('i2', '2026-12-01', 30000, '2026-12-31'), inv('i1', '2026-11-01', 20000, '2026-11-30'), inv('i3', '2027-01-01', 10000, '2027-01-31')];
  const receipts = [{ customerId: 'c1', amount: 25000 }, { customerId: 'c2', amount: 99999 }];
  const st = Calc.invoiceStatus('c1', invoices, receipts, '2026-12-15');
  assert.deepEqual(st.i1, { amount: 20000, paid: 20000, remaining: 0, status: 'paid', overdue: false });
  assert.deepEqual(st.i2, { amount: 30000, paid: 5000, remaining: 25000, status: 'partial', overdue: false });
  assert.deepEqual(st.i3, { amount: 10000, paid: 0, remaining: 10000, status: 'unpaid', overdue: false });
  const later = Calc.invoiceStatus('c1', invoices, receipts, '2027-01-05');
  assert.equal(later.i2.overdue, true);
  assert.equal(later.i3.overdue, false);
});

const slip = (o) => Object.assign({ customerId: 'c1', status: 'delivered', payment: 'credit' }, o);

test('得意先元帳：日付順に残高を計算（現金払い・取消・他社は含めない）', () => {
  const slips = [
    slip({ date: '2026-11-03', totals: { total: 10800 } }),
    slip({ date: '2026-11-10', totals: { total: 5400 } }),
    slip({ date: '2026-11-11', totals: { total: 999 }, payment: 'cash' }),
    slip({ date: '2026-11-12', totals: { total: 999 }, status: 'cancelled' }),
    slip({ date: '2026-11-12', totals: { total: 999 }, customerId: 'c2' })
  ];
  const receipts = [{ customerId: 'c1', date: '2026-11-10', amount: 10800 }];
  const invoices = [{ customerId: 'c1', issueDate: '2026-11-05', no: 1 }];
  const rows = Calc.customerLedger('c1', slips, receipts, invoices);
  assert.deepEqual(rows.map(r => [r.date, r.kind, r.balance]), [
    ['2026-11-03', 'delivery', 10800],
    ['2026-11-05', 'invoice', 10800],
    ['2026-11-10', 'delivery', 16200],
    ['2026-11-10', 'receipt', 5400]
  ]);
});

test('売掛金のまとめ：未請求・請求済未入金・期限切れ・次の期限', () => {
  const slips = [
    slip({ date: '2026-11-03', totals: { total: 20000 }, invoiceId: 'i1' }),
    slip({ date: '2026-12-03', totals: { total: 30000 }, invoiceId: 'i2' }),
    slip({ date: '2027-01-03', totals: { total: 7000 } })
  ];
  const invoices = [inv('i1', '2026-11-30', 20000, '2026-12-31'), inv('i2', '2026-12-31', 30000, '2027-01-31')];
  const receipts = [{ customerId: 'c1', date: '2027-01-02', amount: 5000 }];
  const s = Calc.receivableSummary('c1', slips, receipts, invoices, '2027-01-10');
  assert.equal(s.balance, 57000 - 5000);
  assert.equal(s.unbilled, 7000);
  assert.equal(s.billedUnpaid, 15000 + 30000);
  assert.equal(s.overdue, 15000);
  assert.equal(s.nextDue, '2027-01-31');
});
