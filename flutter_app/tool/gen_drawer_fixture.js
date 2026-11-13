// レジ締め（あるべき現金）の照合用データを Web版の計算で作る：node tool/gen_drawer_fixture.js > test/fixtures/drawer.json
const Calc = require('../../js/calc.js');
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = (a) => a[rnd(a.length)];
const dates = ['2026-11-01', '2026-11-02'];
const devs = ['', 'A', 'B'];
const cases = [];
for (let c = 0; c < 60; c++) {
  const sales = [], reservations = [], cashmoves = [], slips = [], receipts = [];
  for (let i = 0; i < 12; i++) {
    const total = (rnd(300) + 1) * 10 * (rnd(8) === 0 ? -1 : 1);
    const m = pick(['cash', 'cashless', 'split', 'old']);
    const s = { id: 'S' + i, date: pick(dates), dev: pick(devs), kind: total < 0 ? 'return' : undefined, void: rnd(10) === 0,
      totals: { total, subtotal: total, discount: 0, byRate: [{ rate: 8, amount: total, tax: Math.floor(total * 8 / 108) }] }, lines: [] };
    if (m === 'old') s.method = pick(['cash', 'card']);
    else if (m === 'split') { const dep = rnd(3) ? 0 : 100; s.payments = { deposit: dep, cash: Math.floor((total - dep) / 2), cashless: total - dep - Math.floor((total - dep) / 2) }; s.cashlessType = pick(['クレジット', 'QR決済']); }
    else s.payments = m === 'cash' ? { deposit: 0, cash: total, cashless: 0 } : { deposit: 0, cash: 0, cashless: total };
    if (s.payments && s.payments.cashless && !s.cashlessType) s.cashlessType = pick(['クレジット', '電子マネー', '']);
    if (s.kind === undefined) delete s.kind;
    sales.push(s);
  }
  for (let i = 0; i < 5; i++) {
    const r = { id: 'R' + i, deposit: rnd(3) ? (rnd(50) + 1) * 100 : 0, depositMethod: pick(['cash', 'cashless', undefined]), depositDate: pick(dates), depositDev: pick(devs) };
    if (rnd(3) === 0) { r.depositRefundDate = pick(dates); r.refundDev = pick(devs); }
    reservations.push(r);
  }
  for (let i = 0; i < 5; i++) cashmoves.push({ id: 'K' + i, date: pick(dates), dev: pick(devs), kind: pick(['float', 'in', 'out', 'exchange']), amount: (rnd(500) + 1) * 10, at: '2026-11-01T0' + i + ':00:00.000Z' });
  for (let i = 0; i < 3; i++) slips.push({ id: 'W' + i, date: pick(dates), status: pick(['delivered', 'draft']), payment: pick(['cash', 'credit']), deliveredDev: pick(devs), totals: { total: (rnd(100) + 1) * 100 } });
  for (let i = 0; i < 3; i++) receipts.push({ id: 'P' + i, date: pick(dates), dev: pick(devs), method: pick(['cash', 'bank', 'fee']), amount: (rnd(100) + 1) * 100 });
  const date = pick(dates), dev = pick([null, '', 'A', 'B']);
  const r = Calc.drawerSummary({ sales, reservations, cashmoves, slips, receipts }, date, dev);
  cases.push({ data: { sales, reservations, cashmoves, slips, receipts }, date, dev,
    expect: { expected: r.expected, float: r.float, drawerCash: r.sum.drawerCash, cash: r.sum.cash, total: r.sum.total, cashIn: r.sum.cashIn, cashOut: r.sum.cashOut,
      depositInCash: r.sum.depositIn.cash, depositRefundCash: r.sum.depositRefund.cash, wholesaleCash: r.sum.wholesale.cashOnDelivery + r.sum.wholesale.receiptCash, cashlessBy: r.sum.cashlessBy } });
}
console.log(JSON.stringify(cases));
