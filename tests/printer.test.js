const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/printer.js');

test('文字幅：全角は2、半角・半角カナは1', () => {
  assert.strictEqual(P.dispWidth('ABC'), 3);
  assert.strictEqual(P.dispWidth('鶏もも'), 6);
  assert.strictEqual(P.dispWidth('ｶﾅ¥'), 3); // ¥ は印字すると半角
});

test('行：左右を幅いっぱいに並べる・入らなければ折り返す', () => {
  const l = P.layout([{ kind: 'row', left: '鶏もも', right: '¥198' }], 48);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(P.dispWidth(l[0].text), 48);
  assert.ok(l[0].text.startsWith('鶏もも') && l[0].text.endsWith('¥198'));
  const long = P.layout([{ kind: 'row', left: 'あ'.repeat(30), right: '1,000' }], 48);
  assert.strictEqual(long.length, 3);
  assert.ok(long.every((x) => P.dispWidth(x.text) <= 48));
  assert.ok(long[2].text.endsWith('1,000') && P.dispWidth(long[2].text) === 48);
});

test('倍角は半分の幅で並べる・字下げ', () => {
  const l = P.layout([{ kind: 'row', left: '合計', right: '¥1,234', size: 2, em: true }, { kind: 'row', left: '値引', right: '-10', ind: true }], 48);
  assert.strictEqual(P.dispWidth(l[0].text), 24);
  assert.strictEqual(l[0].size, 2);
  assert.ok(l[1].text.startsWith('  値引'));
});

test('ePOS-Print XML：日本語・中央寄せ・倍角・カット・引き出し', () => {
  const lines = P.layout([{ kind: 'text', text: '鶏肉の店 <&>', align: 'center', size: 2, em: true }, { kind: 'hr' }], 35);
  const x = P.toEposXml(lines, { drawer: true });
  assert.match(x, /<s:Envelope/);
  assert.match(x, /<pulse drawer="drawer_1" time="pulse_100"\/>/);
  assert.match(x, /<text lang="ja"\/>/);
  assert.match(x, /<text align="center"\/><text dw="true" dh="true"\/><text em="true"\/><text>鶏肉の店 &lt;&amp;&gt;&#10;<\/text>/);
  assert.match(x, /-{35}&#10;/);
  assert.match(x, /<cut type="feed"\/>/);
  assert.ok(x.indexOf('<pulse') < x.indexOf('<text'));
  const d = P.toEposXml([], { drawer: true });
  assert.match(d, /<pulse/);
  assert.doesNotMatch(d, /<cut|<text/);
});

test('返事の読み取りとエラーの説明', () => {
  const ok = P.parseResponse('<s:Envelope><s:Body><response success="true" code="" status="251658262" battery="0" xmlns="x"/></s:Body></s:Envelope>');
  assert.deepStrictEqual(ok, { success: true, code: '', status: 251658262 });
  const ng = P.parseResponse('<response success="false" code="EPTR_REC_EMPTY" status="1"/>');
  assert.strictEqual(ng.success, false);
  assert.match(P.errorMessage(ng.code), /用紙がありません/);
  assert.strictEqual(P.parseResponse('<html>').code, 'BadResponse');
  assert.strictEqual(P.normalizeHost(' http://192.168.1.50/ '), '192.168.1.50');
  assert.strictEqual(P.columns('58'), 35);
  assert.strictEqual(P.columns('80'), 48);
});

test('全角空白の字下げは残す', () => {
  const l = P.layout([{ kind: 'row', left: '　クレジット ', right: ' ¥120' }], 48);
  assert.ok(l[0].text.startsWith('　クレジット'));
  assert.ok(l[0].text.endsWith('¥120'));
});
