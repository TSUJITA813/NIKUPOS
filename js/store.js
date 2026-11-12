/*
 * データ保存（端末のlocalStorage）
 */
(function (root) {
  'use strict';

  var KEY = {
    products: 'nikupos.products',
    settings: 'nikupos.settings',
    sales: 'nikupos.sales',
    seq: 'nikupos.seq',
    cart: 'nikupos.cart',
    reservations: 'nikupos.reservations',
    rseq: 'nikupos.rseq'
  };

  // unit: 'g' = 100gあたり単価, 'pc' = 1個あたり単価, 'open' = 都度金額入力
  var DEFAULT_PRODUCTS = [
    ['もも肉', '生肉', 'g', 158, 8, '#e8846b'],
    ['むね肉', '生肉', 'g', 98, 8, '#f1a98f'],
    ['ささみ', '生肉', 'g', 128, 8, '#f4c1ad'],
    ['手羽先', '生肉', 'g', 118, 8, '#e8846b'],
    ['手羽元', '生肉', 'g', 98, 8, '#f1a98f'],
    ['ひき肉', '生肉', 'g', 108, 8, '#f4c1ad'],
    ['砂肝', '生肉', 'g', 128, 8, '#c96a5a'],
    ['レバー', '生肉', 'g', 98, 8, '#a8564a'],
    ['鶏皮', '生肉', 'g', 68, 8, '#f4c1ad'],
    ['唐揚げ', '惣菜', 'g', 248, 8, '#d9a441'],
    ['焼き鳥 もも', '惣菜', 'pc', 120, 8, '#b8743a'],
    ['焼き鳥 ねぎま', '惣菜', 'pc', 130, 8, '#b8743a'],
    ['つくね', '惣菜', 'pc', 140, 8, '#b8743a'],
    ['チキンカツ', '惣菜', 'pc', 200, 8, '#d9a441'],
    ['手羽先唐揚げ', '惣菜', 'pc', 90, 8, '#d9a441'],
    ['鶏ガラ', 'その他', 'pc', 100, 8, '#9aa3ab'],
    ['卵（10個）', 'その他', 'pc', 280, 8, '#e9d27a'],
    ['その他食品', 'その他', 'open', 0, 8, '#8fa3b8'],
    ['レジ袋', 'その他', 'pc', 5, 10, '#7f8c8d']
  ].map(function (p, i) {
    return { id: 'p' + (i + 1), name: p[0], category: p[1], unit: p[2], price: p[3], taxRate: p[4], color: p[5], order: i };
  });

  var DEFAULT_SETTINGS = {
    storeName: '鶏肉の店',
    address: '',
    tel: '',
    invoiceNo: '',
    footer: 'お買い上げありがとうございました',
    categories: ['生肉', '惣菜', 'その他'],
    rounding: 'floor',
    paperWidth: '58',
    autoPrint: false,
    scaleMode: 'none', // 'none' | 'keyboard' | 'bluetooth'
    scaleUnit: 'g'     // はかりが単位を送らない場合の単位
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      alert('データを保存できませんでした。端末の空き容量が不足している可能性があります。\n設定画面からバックアップを保存し、古い売上を削除してください。');
      return false;
    }
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  var Store = {
    KEY: KEY,
    getProducts: function () { return read(KEY.products, null) || clone(DEFAULT_PRODUCTS); },
    saveProducts: function (list) { return write(KEY.products, list); },
    getSettings: function () {
      var s = read(KEY.settings, {});
      var merged = clone(DEFAULT_SETTINGS);
      Object.keys(s).forEach(function (k) { merged[k] = s[k]; });
      return merged;
    },
    saveSettings: function (s) { return write(KEY.settings, s); },
    getSales: function () { return read(KEY.sales, []); },
    saveSales: function (list) { return write(KEY.sales, list); },
    nextSeq: function () {
      var n = (read(KEY.seq, 0) || 0) + 1;
      write(KEY.seq, n);
      return n;
    },
    getReservations: function () { return read(KEY.reservations, []); },
    saveReservations: function (list) { return write(KEY.reservations, list); },
    nextReservationNo: function () {
      var n = (read(KEY.rseq, 0) || 0) + 1;
      write(KEY.rseq, n);
      return n;
    },
    getCart: function () { return read(KEY.cart, null); },
    saveCart: function (cart) { return write(KEY.cart, cart); },

    exportAll: function () {
      return {
        app: 'NIKUPOS',
        version: 1,
        exportedAt: new Date().toISOString(),
        products: Store.getProducts(),
        settings: Store.getSettings(),
        sales: Store.getSales(),
        seq: read(KEY.seq, 0),
        reservations: Store.getReservations(),
        rseq: read(KEY.rseq, 0)
      };
    },
    importAll: function (data) {
      if (!data || data.app !== 'NIKUPOS') throw new Error('NIKUPOSのバックアップファイルではありません');
      write(KEY.products, data.products || clone(DEFAULT_PRODUCTS));
      write(KEY.settings, data.settings || clone(DEFAULT_SETTINGS));
      write(KEY.sales, data.sales || []);
      write(KEY.seq, data.seq || 0);
      write(KEY.reservations, data.reservations || []);
      write(KEY.rseq, data.rseq || 0);
    },
    usageBytes: function () {
      var total = 0;
      Object.keys(KEY).forEach(function (k) {
        var v = localStorage.getItem(KEY[k]);
        if (v) total += v.length * 2;
      });
      return total;
    }
  };

  root.Store = Store;
})(this);
