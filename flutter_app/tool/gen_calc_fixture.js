// Web版（js/calc.js）の計算結果を、Flutter版のテスト用に書き出す。
//   node tool/gen_calc_fixture.js > test/fixtures/calc_cases.json
const Calc = require('../../js/calc.js');
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const cases = [];
for (let i = 0; i < 500; i++) {
  const lines = [];
  const nl = 1 + rnd(5);
  for (let j = 0; j < nl; j++) {
    const unit = ['g', 'pc', 'open'][rnd(3)];
    const l = { unit, taxRate: rnd(5) === 0 ? 10 : 8, price: unit === 'g' ? 58 + rnd(300) : 5 + rnd(900), qty: unit === 'g' ? 1 + rnd(3000) : unit === 'pc' ? 1 + rnd(12) : 1 };
    if (unit === 'pc' && rnd(9) === 0) l.qty = -l.qty;
    const dk = rnd(6);
    if (dk === 1) l.discount = { type: 'pct', value: [10, 20, 30, 50][rnd(4)] };
    if (dk === 2) l.discount = { type: 'yen', value: 10 + rnd(200) };
    if (rnd(5) === 0) l.promoDiscount = rnd(150);
    lines.push(l);
  }
  const d = [null, null, { type: 'pct', value: 5 + rnd(20) }, { type: 'yen', value: rnd(500) }][rnd(4)];
  const mode = ['floor', 'round', 'ceil'][rnd(3)];
  const t = Calc.totals(lines, d, mode);
  const deposit = rnd(4) === 0 ? rnd(3000) : 0;
  const method = ['cash', 'cashless', 'split'][rnd(3)];
  const received = rnd(15000), cl = rnd(5000);
  const p = Calc.payments(t.total, deposit, method, received, cl);
  cases.push({ lines, discount: d, mode, totals: t, lineAmounts: lines.map((l) => Calc.lineAmount(l, mode)), pay: { args: [t.total, deposit, method, received, cl], out: p } });
}
const keys = ['手羽先', 'ﾃﾊﾞ', 'からあげ', 'ＣＨＩＣＫ', 'すなぎも', 'とりもも', 'ガラ'];
const prods = [{ name: '手羽先唐揚げ' }, { name: '砂肝' }, { name: '鶏もも骨付き' }, { name: 'Chicken' }, { name: '鶏ガラ', kana: '' }, { name: 'ササミ', code: '4901' }];
const search = [];
for (const k of keys) for (const p of prods) search.push({ q: k, p, hit: Calc.matchProduct(p, k) });
process.stdout.write(JSON.stringify({ cases, search }));
