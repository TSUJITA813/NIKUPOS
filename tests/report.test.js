const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/report.js');
const X = require('../js/xlsx.js');

function sale(id, date, total, pay, extra) {
  return Object.assign({
    id, no: id, date, at: date + 'T10:00:00', lines: [{ productId: 'p1', name: 'もも肉', unit: 'g', price: 158, qty: Math.round(total / 1.58), taxRate: 8, amount: total }],
    totals: { subtotal: total, discount: 0, total, count: 1, byRate: [{ rate: 8, amount: total, tax: Math.floor(total * 8 / 108) }] },
    payments: pay, cashlessType: pay.cashless ? 'クレジット' : ''
  }, extra || {});
}

const data = {
  sales: [
    sale('1', '2026-10-31', 500, { deposit: 0, cash: 500, cashless: 0 }),
    sale('2', '2026-11-01', 1000, { deposit: 0, cash: 1000, cashless: 0 }),
    sale('3', '2026-11-01', 2370, { deposit: 0, cash: 370, cashless: 2000 }, { method: 'split' }),
    sale('4', '2026-11-03', 800, { deposit: 0, cash: 800, cashless: 0 }, { void: true }),
    sale('5', '2026-11-03', -316, { deposit: 0, cash: -316, cashless: 0 }, { kind: 'return' }),
    sale('6', '2026-12-01', 999, { deposit: 0, cash: 999, cashless: 0 })
  ]
};

test('期間のよく使う範囲', () => {
  assert.deepStrictEqual(R.presetRange('thisMonth', '2026-11-12'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual(R.presetRange('lastMonth', '2026-01-12'), { from: '2025-12-01', to: '2025-12-31' });
  assert.strictEqual(R.datesBetween('2026-11-01', '2026-11-30').length, 30);
  assert.strictEqual(R.datesBetween('2024-02-01', '2024-02-29').length, 29);
});

test('11月の集計：期間外・取消を除き、返品は差し引く', () => {
  const s = R.summarize(data, '2026-11-01', '2026-11-30');
  assert.strictEqual(s.days.length, 30);
  assert.strictEqual(s.total.count, 2);
  assert.strictEqual(s.total.total, 1000 + 2370 - 316);
  assert.strictEqual(s.total.cash, 1000 + 370 - 316);
  assert.strictEqual(s.total.cashless, 2000);
  assert.strictEqual(s.total.voids, 1);
  assert.strictEqual(s.total.returnsCount, 1);
  assert.strictEqual(s.total.returns, 316);
  assert.deepStrictEqual(s.cashlessTypes, ['クレジット']);
  assert.strictEqual(s.sales.length, 4); // 取消・返品も明細には出す
  const daily = R.dailyRows(s);
  assert.strictEqual(daily.length, 32); // 見出し＋30日＋合計
  const last = daily[daily.length - 1];
  assert.strictEqual(last[0], '合計');
  assert.strictEqual(last[3], 3054);
  assert.strictEqual(daily[0][7], '　クレジット');
  assert.strictEqual(last[7], 2000);
  const items = R.itemRows(s);
  assert.strictEqual(items[items.length - 1][4], 3054);
});

test('2か月以上なら月別シートが付き、Excel に書き出せる', () => {
  const s = R.summarize(data, '2026-10-01', '2026-12-31');
  const sheets = R.bookSheets(s, '鶏肉の店');
  assert.deepStrictEqual(sheets.map((x) => x.name), ['日別', '月別', '取引明細', '商品別']);
  const m = R.monthlyRows(s);
  assert.deepStrictEqual(m.slice(1).map((r) => [r[0], r[2]]), [['2026-10', 500], ['2026-11', 3054], ['2026-12', 999], ['合計', 4553]]);
  const one = R.bookSheets(R.summarize(data, '2026-11-01', '2026-11-30'), 'x');
  assert.ok(!one.some((x) => x.name === '月別'));
  const zip = X.writeXlsxBook(sheets);
  assert.ok(zip.length > 1000);
  const csv = R.toCsv(R.detailRows(s));
  assert.ok(csv.startsWith('﻿日付,時刻,取引No'));
  assert.match(csv, /現金＋クレジット/);
});

test('商品の検索：ひらがな・カタカナ・全角半角・コード', () => {
  const Calc = require('../js/calc.js');
  const p = { name: 'ササミ', kana: '', code: '4901234', category: '生肉' };
  assert.ok(Calc.matchProduct(p, 'ささみ'));
  assert.ok(Calc.matchProduct(p, 'ｻｻﾐ'));
  assert.ok(Calc.matchProduct({ name: '手羽先唐揚', kana: 'てばさきからあげ' }, 'からあげ'));
  assert.ok(Calc.matchProduct({ name: '唐揚げ' }, '唐揚'));
  assert.ok(Calc.matchProduct(p, '４９０１'));
  assert.ok(Calc.matchProduct(p, '生肉'));
  assert.ok(!Calc.matchProduct(p, 'もも'));
  assert.ok(Calc.matchProduct({ name: 'Chicken' }, 'CHICK'));
  // よみ未登録でも、よくある漢字はひらがな・カタカナで探せる
  assert.ok(Calc.matchProduct({ name: '手羽先唐揚げ' }, 'てばさき'));
  assert.ok(Calc.matchProduct({ name: '手羽元' }, 'ﾃﾊﾞ'));
  assert.ok(Calc.matchProduct({ name: '砂肝' }, 'すなぎも'));
  assert.ok(Calc.matchProduct({ name: '焼き鳥 もも' }, 'やきとり'));
  assert.ok(Calc.matchProduct({ name: '鶏もも骨付き' }, 'とりもも'));
  assert.ok(Calc.matchProduct({ name: 'もも肉' }, 'ももにく'));
  assert.ok(!Calc.matchProduct({ name: 'むね肉' }, 'もも'));
});
