/*
 * Excel ファイル（.xlsx）の書き出し・読み込みと、CSV の読み込み（外部ライブラリなし）
 *  書き出し：1シート。見出し行（太字・色付き・固定）、数値の書式（#,##0）、列幅、印刷設定（A4縦・横幅1ページ・見出しを毎ページ印刷）
 *  読み込み：Excel で保存したファイル（圧縮あり）も読めるよう、ブラウザ標準の DecompressionStream('deflate-raw') で展開
 */
(function (root) {
  'use strict';

  // ---------- ZIP（無圧縮で書く） ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  function zipStore(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]);
    var out = new Uint8Array(all.reduce(function (s, p) { return s + p.length; }, 0));
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- 書き出し ----------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // XML で使えない制御文字
  }
  function colName(i) {
    var s = '';
    i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /**
   * @param rows 2次元配列（1行目は見出し）。数値はそのまま数値のセルに
   * @param opts { sheetName, widths: [列幅], title }
   * @returns Uint8Array（.xlsx）
   */
  function writeXlsx(rows, opts) {
    opts = opts || {};
    var sheetName = esc(opts.sheetName || 'Sheet1').slice(0, 31);
    var widths = opts.widths || [];
    var ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var sheetRows = rows.map(function (r, ri) {
      return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
        var ref = colName(ci) + (ri + 1);
        if (v === '' || v == null) return ri === 0 ? '<c r="' + ref + '" s="1"/>' : '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + (ri === 0 ? 1 : Number.isInteger(v) ? 2 : 3) + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    var lastRef = colName(Math.max(0, ncol - 1)) + Math.max(1, rows.length);
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + lastRef + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      (widths.length ? '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '') +
      '<sheetData>' + sheetRows + '</sheetData>' +
      '<autoFilter ref="A1:' + lastRef + '"/>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="' + (opts.landscape ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>' +
      (opts.title ? '<headerFooter><oddHeader>&amp;C' + esc(opts.title) + '</oddHeader><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter>' : '') +
      '</worksheet>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>' +
      '<font><b/><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7E3DC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + sheetName + '" sheetId="1" r:id="rId1"/></sheets>' +
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + sheetName + '\'!$A$1:$' + lastRef.replace(/(\d+)$/, '$$$1') + '</definedName>' +
      '<definedName name="_xlnm.Print_Titles" localSheetId="0">\'' + sheetName + '\'!$1:$1</definedName></definedNames></workbook>';
    return zipStore([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/styles.xml', data: styles }
    ]);
  }

  // ---------- 読み込み ----------
  function unzip(buf) {
    var u8 = new Uint8Array(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Excelファイル（.xlsx）として読み取れません'));
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var entries = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      var dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      entries[name] = { method: method, data: u8.subarray(dataStart, dataStart + csize) };
      p += 46 + nlen + elen + clen;
    }
    return Promise.resolve(entries);
  }
  function inflate(e) {
    if (e.method === 0) return Promise.resolve(e.data);
    if (e.method !== 8) return Promise.reject(new Error('対応していない圧縮形式です'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('この端末ではExcelファイルを読み込めません。CSVで保存して取り込んでください'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([e.data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function readText(entries, name) {
    if (!entries[name]) return Promise.resolve(null);
    return inflate(entries[name]).then(function (b) { return new TextDecoder().decode(b); });
  }
  function unesc(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }
  function textOf(xml) {
    // <t>…</t> を全部つなぐ（ふりがな <rPh> は除く）
    var s = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var out = '';
    s.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (m, t) { out += t; return m; });
    return unesc(out);
  }
  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref);
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }
  /** シートの XML（と共有文字列）→ 2次元配列 */
  function parseSheet(sheetXml, shared) {
    var rows = [];
    sheetXml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, function (m, rattr, body) {
      var rm = /\br="(\d+)"/.exec(rattr);
      var ri = rm ? Number(rm[1]) - 1 : rows.length;
      var row = [];
      body.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (m2, attr, inner) {
        var ref = /\br="([A-Z]+\d+)"/.exec(attr);
        var t = /\bt="(\w+)"/.exec(attr);
        var ci = ref ? colIndex(ref[1]) : row.length;
        var type = t ? t[1] : 'n';
        var v = '';
        inner = inner || '';
        var vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (type === 's') v = vm ? (shared[Number(vm[1])] || '') : '';
        else if (type === 'inlineStr') v = textOf(inner);
        else if (type === 'str' || type === 'e') v = vm ? unesc(vm[1]) : '';
        else if (type === 'b') v = vm ? vm[1] === '1' : '';
        else v = vm ? Number(vm[1]) : '';
        while (row.length < ci) row.push('');
        row[ci] = v;
        return m2;
      });
      while (rows.length < ri) rows.push([]);
      rows[ri] = row;
      return m;
    });
    return rows;
  }
  /** .xlsx の最初のシート → 2次元配列（Promise） */
  function readXlsx(buf) {
    var entries;
    return unzip(buf).then(function (e) {
      entries = e;
      return Promise.all([readText(entries, 'xl/workbook.xml'), readText(entries, 'xl/_rels/workbook.xml.rels'), readText(entries, 'xl/sharedStrings.xml')]);
    }).then(function (r) {
      var shared = [];
      if (r[2]) r[2].replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, function (m, si) { shared.push(textOf(si)); return m; });
      var path = 'xl/worksheets/sheet1.xml';
      var sm = r[0] && /<sheet\b[^>]*r:id="([^"]+)"/.exec(r[0]);
      if (sm && r[1]) {
        var rel = new RegExp('<Relationship\\b[^>]*Id="' + sm[1] + '"[^>]*Target="([^"]+)"').exec(r[1]) ||
          new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + sm[1] + '"').exec(r[1]);
        if (rel) path = rel[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
      }
      if (!entries[path]) path = Object.keys(entries).filter(function (k) { return /^xl\/worksheets\/[^/]+\.xml$/.test(k); }).sort()[0];
      if (!path) throw new Error('シートが見つかりません');
      return readText(entries, path).then(function (xml) { return parseSheet(xml, shared); });
    });
  }

  /** CSV の文字列 → 2次元配列（ダブルクォート・改行入りの項目に対応） */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [];
    var row = [];
    var cur = '';
    var q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  /** CSV のバイト列 → 文字列（UTF-8 として読めなければ Shift-JIS） */
  function decodeCsv(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('shift_jis').decode(bytes); }
  }

  var XLSX = { writeXlsx: writeXlsx, readXlsx: readXlsx, parseSheet: parseSheet, parseCsv: parseCsv, decodeCsv: decodeCsv, crc32: crc32, colName: colName };
  if (typeof module !== 'undefined' && module.exports) module.exports = XLSX;
  else root.XLSX = XLSX;
})(this);
