const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pricing.js');

test('端数のそろえ方', () => {
  assert.equal(P.roundPrice(165.9, 'r1'), 166);
  assert.equal(P.roundPrice(161, 'c10'), 170);
  assert.equal(P.roundPrice(165, 'r10'), 170);
  assert.equal(P.roundPrice(169, 'f10'), 160);
  assert.equal(P.roundPrice(161, 'end8'), 168);
  assert.equal(P.roundPrice(168, 'end8'), 168);
  assert.equal(P.roundPrice(169, 'end8'), 178);
  assert.equal(P.roundPrice(0.2, 'r1'), 1, '1円より下にはしない');
});

test('一括変更（%・円）', () => {
  assert.equal(P.bulkPrice(158, 'pct', 5, 'end8'), 168); // 165.9 → 168
  assert.equal(P.bulkPrice(98, 'yen', 10, 'r1'), 108);
  assert.equal(P.bulkPrice(1300, 'pct', -10, 'r10'), 1170);
  assert.equal(P.bulkPrice(0, 'pct', 10, 'r1'), 0, '価格なしはそのまま');
});

const products = [
  { id: 'p1', name: 'もも肉', category: '生肉', unit: 'g', price: 158, wsPrice: 1300, taxRate: 8, trackStock: true, minStock: 5000, order: 0 },
  { id: 'p11', name: '焼き鳥 もも', category: '惣菜', unit: 'pc', price: 120, wsPrice: 0, taxRate: 8, order: 1 },
  { id: 'p18', name: 'その他食品', category: 'その他', unit: 'open', price: 0, taxRate: 8, order: 2 },
  { id: 'p19', name: 'レジ袋', category: 'その他', unit: 'pc', price: 5, taxRate: 10, order: 3 }
];

test('商品マスタ → 表（見出し・単位・kg換算）', () => {
  const rows = P.productsToRows(products, ['生肉', '惣菜', 'その他']);
  assert.equal(rows[0][0], '商品ID');
  assert.deepEqual(rows[1], ['p1', '生肉', 'もも肉', 'グラム売り', 158, '100gあたり', 1300, '1kgあたり', '8%', '○', 5, '', '', '', '', '']);
  assert.deepEqual(rows[3].slice(3, 7), ['金額入力', '', '', '']);
});

test('取り込みの照合：変更・変更なし・新規・エラー', () => {
  const rows = P.productsToRows(products, ['生肉', '惣菜', 'その他']);
  rows[1][4] = '168';         // もも肉 158 → 168（文字でもOK）
  rows[1][6] = '¥1,350';      // 卸単価 → 1350
  rows[1][10] = 6;            // 発注点 6kg
  rows[2][4] = '１３０円';     // 全角でもOK
  rows[4][4] = 'abc';         // エラー
  rows.push(['', '惣菜', 'つくね', '個数売り', 140, '', '', '', '8%', '', '', '', '']); // 新規
  rows.push(['p999', '', '謎', '', 100, '', '', '', '', '', '', '', '']);              // 存在しないID
  rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);                    // 空行
  const plan = P.planImport(products, rows);
  assert.deepEqual(plan.changes.map(c => [c.id, c.patch, c.before]), [
    ['p1', { price: 168, wsPrice: 1350, minStock: 6000 }, { price: 158, wsPrice: 1300, minStock: 5000 }],
    ['p11', { price: 130 }, { price: 120 }]
  ]);
  assert.equal(plan.unchanged, 1, '金額入力の商品は変更なし');
  assert.equal(plan.added.length, 1);
  assert.equal(plan.added[0].name, 'つくね');
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0], /5行目.*店頭価格/);
  assert.match(plan.errors[1], /p999/);
});

test('見出しが少し違っても・商品IDがなく商品名だけでも取り込める', () => {
  const plan = P.planImport(products, [['商品名', '店頭価格', '卸単価'], ['もも肉', 178, 1400], ['レジ袋', 5, '']]);
  assert.deepEqual(plan.changes.map(c => c.patch), [{ price: 178, wsPrice: 1400 }]);
  assert.equal(plan.unchanged, 1);
});

test('変更の適用：価格の履歴と、卸単価が変わった商品', () => {
  const list = JSON.parse(JSON.stringify(products));
  const r = P.applyPatches(list, [{ id: 'p1', patch: { price: 168, wsPrice: 1350 } }, { id: 'p11', patch: { price: 130 } }], '2026-12-01');
  assert.deepEqual(r.changedWs, ['p1']);
  assert.equal(list[0].price, 168);
  assert.deepEqual(list[0].priceHistory, [{ date: '2026-12-01', price: 158, wsPrice: 1300 }]);
  assert.deepEqual(list[1].priceHistory, [{ date: '2026-12-01', price: 120, wsPrice: 0 }]);
});

test('原価・よみ・商品コードの列も取り込める（古い形式の表はそのまま）', () => {
  const rows = P.productsToRows(products, ['生肉', '惣菜', 'その他']);
  const h = rows[0];
  rows[1][h.indexOf('原価（税抜・1kg／1個あたり）')] = '¥900';
  rows[1][h.indexOf('よみ')] = 'ももにく';
  rows[1][h.indexOf('商品コード')] = 201;
  const plan = P.planImport(products, rows);
  const c = plan.changes.find((x) => x.id === 'p1');
  assert.deepEqual(c.patch, { cost: 900, kana: 'ももにく', code: '201' });
  const old = P.productsToRows(products, ['生肉', '惣菜', 'その他']).map((r) => r.slice(0, 13));
  assert.equal(P.planImport(products, old).changes.length, 0);
});
