const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../js/journal.js');
const Calc = require('../js/calc.js');

const t8 = (incl) => { const tax = Calc.includedTax(incl, 8); return { rate: 8, amount: incl, tax }; };
const sale = (date, total, pay, extra = {}) => Object.assign({
  date, void: false, lines: [],
  totals: { total, discount: 0, lineDiscount: 0, byRate: [t8(total)] },
  payments: pay
}, extra);

const data = {
  sales: [
    sale('2026-11-01', 5400, { deposit: 0, cash: 5400, cashless: 0 }),
    sale('2026-11-01', 3240, { deposit: 0, cash: 0, cashless: 3240 }),
    sale('2026-11-01', 2160, { deposit: 3000, cash: -840, cashless: 0 }), // 前受金が多く、840円を現金で返金
    sale('2026-11-01', 9999, { deposit: 0, cash: 9999, cashless: 0 }, { void: true })
  ],
  reservations: [{ no: 1, noLabel: 'A-1', name: '山田', deposit: 3000, depositMethod: 'cash', depositDate: '2026-10-30' }],
  customers: [{ id: 'C1', name: '居酒屋とりまる' }],
  slips: [
    { id: 'W1', no: 1, noLabel: 'B-1', customerId: 'C1', date: '2026-11-02', status: 'delivered', payment: 'credit',
      totals: { byRate: [{ rate: 8, amount: 19500, tax: 1560, incl: 21060 }], subtotal: 19500, tax: 1560, total: 21060 } },
    { id: 'W2', no: 2, customerId: 'C1', date: '2026-11-02', status: 'cancelled', payment: 'credit',
      totals: { byRate: [{ rate: 8, amount: 1, tax: 0, incl: 1 }], subtotal: 1, tax: 0, total: 1 } }
  ],
  receipts: [
    { customerId: 'C1', date: '2026-11-30', amount: 20620, method: 'transfer' },
    { customerId: 'C1', date: '2026-11-30', amount: 440, method: 'fee' }
  ],
  moves: [{ type: 'in', date: '2026-11-02', productId: 'p1', delta: 10000, cost: 1000, supplier: '○○食鳥' }],
  products: [{ id: 'p1', unit: 'g', taxRate: 8 }]
};

test('店頭売上は1日1仕訳。返金のマイナスは反対側へ。取消は除く', () => {
  const es = J.buildJournals(data, { from: '2026-11-01', to: '2026-11-01', include: { store: true } });
  assert.equal(es.length, 1);
  const e = es[0];
  // 現金は 売上 5,400 − 返金 840 = 4,560（同じ日の中で差し引き）
  assert.deepEqual(e.debits.map(s => [s.acct, s.sub, s.amount]), [['現金', '', 4560], ['売掛金', 'キャッシュレス', 3240], ['前受金', '', 3000]]);
  assert.deepEqual(e.credits.map(s => [s.acct, s.amount]), [['売上高', 10800]]);
  assert.equal(e.credits[0].tax.amount, Calc.includedTax(5400, 8) + Calc.includedTax(3240, 8) + Calc.includedTax(2160, 8));
});

test('前受金・卸の売上（取消を除く）・入金・振込手数料・仕入', () => {
  const es = J.buildJournals(data, { from: '2026-10-30', to: '2026-11-30', include: { deposit: true, wholesale: true, receipts: true, purchases: true } });
  const brief = es.map(e => [e.date, e.debits.map(s => s.acct + (s.sub ? '/' + s.sub : '') + ':' + s.amount).join('+'), e.credits.map(s => s.acct + (s.sub ? '/' + s.sub : '') + ':' + s.amount).join('+')]);
  assert.deepEqual(brief, [
    ['2026-10-30', '現金:3000', '前受金:3000'],
    ['2026-11-02', '売掛金/居酒屋とりまる:21060', '売上高:21060'],
    ['2026-11-02', '仕入高:10800', '買掛金/○○食鳥:10800'],
    ['2026-11-30', '普通預金:20620', '売掛金/居酒屋とりまる:20620'],
    ['2026-11-30', '支払手数料:440', '売掛金/居酒屋とりまる:440']
  ]);
  assert.equal(es[1].credits[0].tax.amount, 1560);
  assert.equal(es[1].credits[0].tax.biz, 'wholesale');
  assert.equal(es[4].debits[0].tax.amount, 40); // 440 × 10/110
});

test('貸借が合わない仕訳はエラー', () => {
  assert.throws(() => J.entry('2026-11-01', 'x', [{ acct: '現金', amount: 100 }], [{ acct: '売上高', amount: 90 }]));
});

test('弥生の税区分：税込・税抜・簡易課税・免税', () => {
  const s8 = { type: 'sales', rate: 8, amount: 80, biz: 'retail' };
  const s10w = { type: 'sales', rate: 10, amount: 10, biz: 'wholesale' };
  const p10 = { type: 'purchase', rate: 10, amount: 40 };
  const c = (o) => J.config(o);
  assert.equal(J.yayoiTax(s8, c()), '課税売上込軽減8%');
  assert.equal(J.yayoiTax(s10w, c()), '課税売上込10%');
  assert.equal(J.yayoiTax(s8, c({ taxMethod: 'excl' })), '課税売上内軽減8%');
  assert.equal(J.yayoiTax(p10, c()), '課対仕入込10%');
  assert.equal(J.yayoiTax(s8, c({ taxSystem: 'simple' })), '課税売上込二軽減8%');
  assert.equal(J.yayoiTax(s10w, c({ taxSystem: 'simple' })), '課税売上込一10%');
  assert.equal(J.yayoiTax(s8, c({ taxSystem: 'exempt' })), '対象外');
  assert.equal(J.yayoiTax(null, c()), '対象外');
});

test('弥生インポート形式：25列・識別フラグ・複合仕訳', () => {
  const es = J.buildJournals(data, { from: '2026-11-01', to: '2026-11-02', include: { store: true, wholesale: true } });
  const [rows] = J.toYayoi(es);
  assert.ok(rows.every(r => r.length === 25));
  // 店頭（借方3行・貸方2行 → 3行の複合仕訳）
  assert.deepEqual(rows.slice(0, 3).map(r => r[0]), ['2110', '2100', '2101']);
  assert.deepEqual(rows[0].slice(3, 10), ['2026/11/01', '現金', '', '', '対象外', '4560', '']);
  assert.equal(rows[0][13], '課税売上込軽減8%');
  assert.equal(rows[2][10], '', '貸方がない行は空欄');
  assert.equal(rows[2][14], '0', '貸方がない行の金額は0');
  // 卸（1行）
  assert.equal(rows[3][0], '2000');
  assert.deepEqual([rows[3][4], rows[3][5], rows[3][8], rows[3][10], rows[3][13], rows[3][14], rows[3][15]],
    ['売掛金', '居酒屋とりまる', '21060', '売上高', '課税売上込軽減8%', '21060', '1560']);
  assert.deepEqual(rows[3].slice(19), ['0', '', '', '0', '0', 'no']);
});

test('弥生：1000行を超えたらファイルを分ける・摘要のカンマを除く', () => {
  const many = [];
  for (let i = 0; i < 1500; i++) many.push(J.entry('2026-11-01', 'a,b', [{ acct: '現金', amount: 1 }], [{ acct: '売上高', amount: 1 }]));
  const files = J.toYayoi(many);
  assert.deepEqual(files.map(f => f.length), [1000, 500]);
  assert.equal(files[0][0][16], 'a b');
});

test('マネーフォワード：27列の見出し・取引Noで複合仕訳・税額は空欄', () => {
  const es = J.buildJournals(data, { from: '2026-11-01', to: '2026-11-02', include: { store: true, wholesale: true } });
  const rows = J.toMoneyForward(es);
  assert.equal(rows[0].length, 27);
  assert.equal(rows[0][0], '取引No');
  assert.equal(rows[0][8], '借方金額(円)');
  assert.deepEqual(rows.slice(1, 4).map(r => r[0]), ['1', '1', '1']);
  assert.equal(rows[4][0], '2');
  assert.equal(rows[1][1], '2026/11/01');
  assert.equal(rows[1][14], '課税売上 8%（軽）');
  assert.equal(rows[1][17], '', '税額は空欄');
  assert.equal(rows[4][5], '居酒屋とりまる', '借方取引先');
});

test('Shift-JIS：日本語・半角カナ・記号を正しく変換し、表せない文字は ?', () => {
  const s = '鶏もも肉,ｶﾗｱｹﾞ,課税売上込軽減8%,－,〜,¥,😀';
  const bytes = J.encodeSJIS(s);
  const back = new TextDecoder('shift_jis').decode(bytes);
  // 「〜」は Shift-JIS の同じ文字（0x8160）になる（読み戻すと環境により「～」）
  assert.equal(back.replace('～', '〜'), '鶏もも肉,ｶﾗｱｹﾞ,課税売上込軽減8%,－,〜,\\,?');
  assert.deepEqual(Array.from(J.encodeSJIS('鶏')), [0x8C, 0x7B]);
});
