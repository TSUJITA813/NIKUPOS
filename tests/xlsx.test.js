const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const X = require('../js/xlsx.js');

test('CRC32', () => {
  assert.equal(X.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('列の名前', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52].map(X.colName), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
});

test('書き出した .xlsx を読み戻す（日本語・数値・空欄・記号）', async () => {
  const rows = [['商品ID', '商品名', '店頭価格（税込）', '発注点'], ['p1', 'もも肉 <国産> & "特選"', 158, 5.5], ['p2', 'むね肉', 98, ''], ['', '', '', '']];
  const bytes = X.writeXlsx(rows, { sheetName: '価格表', widths: [10, 20, 12, 8], title: '価格表' });
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // "PK"
  const back = await X.readXlsx(bytes.buffer);
  assert.deepEqual(back[0], rows[0]);
  assert.deepEqual(back[1], ['p1', 'もも肉 <国産> & "特選"', 158, 5.5]);
  assert.deepEqual(back[2], ['p2', 'むね肉', 98]);
});

// Excel で保存したファイルと同じく「圧縮あり・共有文字列」の .xlsx を作って読む
function deflatedZip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name); const raw = Buffer.from(text); const data = zlib.deflateRawSync(raw);
    const crc = X.crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nb); offset += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, e]);
}

test('Excel で保存した .xlsx（圧縮・共有文字列・ふりがな・列の飛び）を読む', async () => {
  const buf = deflatedZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="価格表" sheetId="1" r:id="rId7"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="x" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>商品名</t></si><si><t>店頭価格</t></si><si><r><t>もも</t></r><r><t>肉</t></r><rPh sb="0" eb="1"><t>モモ</t></rPh></si></sst>',
    'xl/worksheets/sheet3.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>168</v></c></row></sheetData></worksheet>'
  });
  const rows = await X.readXlsx(new Uint8Array(buf).buffer);
  assert.deepEqual(rows, [['商品名', '', '店頭価格'], [], ['もも肉', '', 168]]);
});

test('CSV（引用符・改行・カンマ入りの項目、Shift-JIS）', () => {
  assert.deepEqual(X.parseCsv('﻿商品名,価格\r\n"もも肉,国産",158\n"説明に""引用""と\n改行",98\n'),
    [['商品名', '価格'], ['もも肉,国産', '158'], ['説明に"引用"と\n改行', '98']]);
  const sjis = Buffer.from([0x82, 0xe0, 0x82, 0xe0, 0x93, 0xf7, 0x2c, 0x31]); // もも肉,1
  assert.equal(X.decodeCsv(new Uint8Array(sjis)), 'もも肉,1');
  assert.equal(X.decodeCsv(new TextEncoder().encode('もも肉,1')), 'もも肉,1');
});
