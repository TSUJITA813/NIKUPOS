/*
 * 価格改定の計算（画面に依存しない）
 *  - 端数のそろえ方・一括変更
 *  - 商品マスタ ⇔ 表（Excel/CSV）の変換と、取り込み内容の照合（変更・新規・エラー）
 *  - 変更の適用（価格の履歴を残す）
 */
(function (root) {
  'use strict';

  var ROUND_LABEL = { r1: '1円単位', c10: '10円単位に切り上げ', r10: '10円単位に四捨五入', f10: '10円単位に切り捨て', end8: '末尾を8円に（切り上げ）' };

  /** 端数をそろえる */
  function roundPrice(n, mode) {
    var x = Math.round(n);
    if (mode === 'c10') x = Math.ceil(n / 10) * 10;
    else if (mode === 'r10') x = Math.round(n / 10) * 10;
    else if (mode === 'f10') x = Math.floor(n / 10) * 10;
    else if (mode === 'end8') {
      var r = Math.ceil(n) - (Math.ceil(n) % 10) + 8;
      if (r < Math.ceil(n)) r += 10;
      x = r;
    }
    return Math.max(1, x);
  }
  /** 一括変更：kind 'pct'（○%）／'yen'（○円） */
  function bulkPrice(base, kind, value, mode) {
    if (!(base > 0)) return base;
    var n = kind === 'pct' ? base * (1 + value / 100) : base + value;
    return roundPrice(n, mode);
  }

  // ---------- 表の列 ----------
  var UNIT_TEXT = { g: 'グラム売り', pc: '個数売り', open: '金額入力' };
  var COLUMNS = [
    { key: 'id', label: '商品ID', width: 18 },
    { key: 'category', label: 'カテゴリ', width: 10 },
    { key: 'name', label: '商品名', width: 22 },
    { key: 'unit', label: '売り方', width: 10 },
    { key: 'price', label: '店頭価格（税込）', width: 14, num: true },
    { key: 'priceUnit', label: '店頭価格の単位', width: 12, readonly: true },
    { key: 'wsPrice', label: '卸単価（税抜）', width: 14, num: true },
    { key: 'wsUnit', label: '卸単価の単位', width: 12, readonly: true },
    { key: 'taxRate', label: '税率', width: 7 },
    { key: 'trackStock', label: '在庫管理', width: 9 },
    { key: 'minStock', label: '発注点（kg・個）', width: 13, num: true },
    { key: 'parStock', label: '適正在庫（kg・個）', width: 14, num: true },
    { key: 'supplier', label: '仕入先', width: 16 }
  ];

  function byCatOrder(categories) {
    return function (a, b) {
      return (categories.indexOf(a.category) - categories.indexOf(b.category)) || ((a.order || 0) - (b.order || 0));
    };
  }

  /** 商品マスタ → 表（1行目は見出し）。数値の列は数値のまま */
  function productsToRows(products, categories) {
    var list = products.slice().sort(byCatOrder(categories || []));
    var rows = [COLUMNS.map(function (c) { return c.label; })];
    list.forEach(function (p) {
      var kg = p.unit === 'g' ? 1000 : 1;
      rows.push([
        p.id, p.category, p.name, UNIT_TEXT[p.unit] || p.unit,
        p.unit === 'open' ? '' : p.price,
        p.unit === 'g' ? '100gあたり' : p.unit === 'pc' ? '1個あたり' : '',
        p.unit === 'open' || !p.wsPrice ? '' : p.wsPrice,
        p.unit === 'g' ? '1kgあたり' : p.unit === 'pc' ? '1個あたり' : '',
        p.taxRate + '%',
        p.trackStock ? '○' : '',
        p.minStock ? p.minStock / kg : '',
        p.parStock ? p.parStock / kg : '',
        p.supplier || ''
      ]);
    });
    return rows;
  }

  function norm(s) { return String(s == null ? '' : s).replace(/[\s　（）()・]/g, '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  /** 「1,280」「¥1,280」「１２８０円」→ 1280。空欄は null。数字でなければ NaN */
  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = norm(v).replace(/[¥￥,，円]/g, '');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function parseUnit(v) {
    var s = norm(v);
    if (/グラム|^g$|100g/i.test(s)) return 'g';
    if (/個|^pc$/i.test(s)) return 'pc';
    if (/金額/.test(s)) return 'open';
    return null;
  }
  function parseBool(v) {
    var s = norm(v).toLowerCase();
    return s === '○' || s === '◯' || s === 'はい' || s === '1' || s === 'true' || s === 'yes' || s === 'する' || s === 'o';
  }

  /**
   * 取り込んだ表を商品マスタと照合する
   * @param rows 1行目が見出しの2次元配列
   * @returns { changes: [{ id, name, patch, before }], added: [product], errors: [文], unchanged: 件数, columns: [key] }
   */
  function planImport(products, rows) {
    var out = { changes: [], added: [], errors: [], unchanged: 0, columns: [] };
    if (!rows || !rows.length) { out.errors.push('表が空です'); return out; }
    var header = rows[0].map(norm);
    var idx = {};
    COLUMNS.forEach(function (c) {
      var i = header.indexOf(norm(c.label));
      if (i < 0) {
        // 見出しの書き方が少し違っても受け付ける（例：「店頭価格」「卸単価」「税率(%)」）
        var short = norm(c.label).replace(/税込|税抜|kg個/g, '');
        i = header.findIndex(function (h) { return h === short || h.replace(/税込|税抜|kg個|%/g, '') === short; });
      }
      if (i >= 0 && !c.readonly) idx[c.key] = i;
    });
    out.columns = Object.keys(idx);
    if (idx.id == null && idx.name == null) { out.errors.push('「商品ID」または「商品名」の列が見つかりません'); return out; }
    var byId = {};
    var byName = {};
    products.forEach(function (p) { byId[p.id] = p; byName[p.name] = p; });

    rows.slice(1).forEach(function (r, n) {
      var line = n + 2;
      var get = function (k) { return idx[k] == null ? undefined : r[idx[k]]; };
      if (!r.some(function (v) { return v !== '' && v != null; })) return; // 空行
      var id = get('id') != null ? String(get('id')).trim() : '';
      var name = get('name') != null ? String(get('name')).trim() : '';
      var p = (id && byId[id]) || (!id && name && byName[name]) || null;
      var vals = {};
      var bad = [];
      if (idx.name != null && name) vals.name = name;
      if (idx.category != null && String(get('category') || '').trim()) vals.category = String(get('category')).trim();
      if (idx.unit != null && get('unit') !== '' && get('unit') != null) {
        var u = parseUnit(get('unit'));
        if (u) vals.unit = u; else bad.push('売り方「' + get('unit') + '」');
      }
      var unit = vals.unit || (p && p.unit) || 'pc';
      var kg = unit === 'g' ? 1000 : 1;
      [['price', 1], ['wsPrice', 1], ['minStock', kg], ['parStock', kg]].forEach(function (f) {
        if (idx[f[0]] == null) return;
        var v = parseNum(get(f[0]));
        if (v === null) { if (f[0] !== 'price') vals[f[0]] = 0; return; }
        if (isNaN(v) || v < 0) { bad.push(COLUMNS.find(function (c) { return c.key === f[0]; }).label + '「' + get(f[0]) + '」'); return; }
        vals[f[0]] = Math.round(v * f[1]);
      });
      if (idx.taxRate != null && get('taxRate') !== '' && get('taxRate') != null) {
        var t = parseNum(String(get('taxRate')).replace('%', '').replace('％', ''));
        if (t === 8 || t === 10) vals.taxRate = t; else bad.push('税率「' + get('taxRate') + '」');
      }
      if (idx.trackStock != null) vals.trackStock = parseBool(get('trackStock'));
      if (idx.supplier != null) vals.supplier = String(get('supplier') || '').trim();
      if (bad.length) { out.errors.push(line + '行目（' + (name || id) + '）：' + bad.join('、') + ' が読み取れません'); return; }

      if (!p) {
        if (id) { out.errors.push(line + '行目：商品ID「' + id + '」が見つかりません（新しい商品は商品IDを空欄にしてください）'); return; }
        if (!vals.name) { out.errors.push(line + '行目：商品名がありません'); return; }
        if (!vals.unit) { out.errors.push(line + '行目（' + vals.name + '）：新しい商品は「売り方」を入れてください'); return; }
        if (vals.unit !== 'open' && !(vals.price > 0)) { out.errors.push(line + '行目（' + vals.name + '）：店頭価格を入れてください'); return; }
        out.added.push({
          name: vals.name, category: vals.category || 'その他', unit: vals.unit, price: vals.unit === 'open' ? 0 : vals.price,
          taxRate: vals.taxRate || 8, wsPrice: vals.wsPrice || 0, trackStock: !!vals.trackStock, minStock: vals.minStock || 0,
          parStock: vals.parStock || 0, supplier: vals.supplier || '', color: '#8fa3b8'
        });
        return;
      }
      var patch = {};
      var before = {};
      Object.keys(vals).forEach(function (k) {
        var cur = p[k] == null ? (k === 'supplier' ? '' : k === 'trackStock' ? false : 0) : p[k];
        if (k === 'price' && p.unit === 'open' && (vals.unit || p.unit) === 'open') return;
        if (cur !== vals[k]) { patch[k] = vals[k]; before[k] = cur; }
      });
      if (Object.keys(patch).length) out.changes.push({ id: p.id, name: p.name, patch: patch, before: before });
      else out.unchanged++;
    });
    return out;
  }

  /**
   * 変更を商品マスタに反映（価格が変わったら履歴に残す）
   * @returns { changedWs: [卸単価が変わった商品ID], count }
   */
  function applyPatches(products, patches, date) {
    var changedWs = [];
    var count = 0;
    patches.forEach(function (c) {
      var p = products.find(function (x) { return x.id === c.id; });
      if (!p) return;
      var priceChanged = (c.patch.price != null && c.patch.price !== p.price) || (c.patch.wsPrice != null && c.patch.wsPrice !== (p.wsPrice || 0));
      if (priceChanged) {
        p.priceHistory = (p.priceHistory || []).concat([{ date: date, price: p.price, wsPrice: p.wsPrice || 0 }]).slice(-24);
      }
      if (c.patch.wsPrice != null && c.patch.wsPrice !== (p.wsPrice || 0)) changedWs.push(p.id);
      Object.keys(c.patch).forEach(function (k) { p[k] = c.patch[k]; });
      count++;
    });
    return { changedWs: changedWs, count: count };
  }

  var Pricing = {
    ROUND_LABEL: ROUND_LABEL,
    COLUMNS: COLUMNS,
    roundPrice: roundPrice,
    bulkPrice: bulkPrice,
    productsToRows: productsToRows,
    planImport: planImport,
    applyPatches: applyPatches,
    parseNum: parseNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pricing;
  else root.Pricing = Pricing;
})(this);
