/*
 * データ保存
 *  - 件数が増えるデータ（売上・予約・卸・在庫履歴など）… IndexedDB（大容量）
 *  - 小さなデータ（商品・設定・連番・在庫数・カート）…… localStorage
 * 起動時に Store.init() で IndexedDB を読み込み、以後はメモリ上のデータを同期的に扱う。
 * 変更はその都度 IndexedDB に書き込む。
 */
(function (root) {
  'use strict';

  var KEY = {
    products: 'nikupos.products',
    settings: 'nikupos.settings',
    cart: 'nikupos.cart',
    stock: 'nikupos.stock',
    seq: 'nikupos.seq',       // 売上の取引No
    rseq: 'nikupos.rseq',     // 予約No
    wseq: 'nikupos.wseq',     // 卸伝票No
    iseq: 'nikupos.iseq',     // 請求書No
    // 旧バージョン（localStorageに保存していた頃）のキー
    legacySales: 'nikupos.sales',
    legacyReservations: 'nikupos.reservations'
  };

  // unit: 'g' = 店頭は100gあたり単価・卸は1kgあたり単価, 'pc' = 1個あたり, 'open' = 都度金額入力
  // [名前, カテゴリ, 単位, 店頭単価(税込), 税率, 色, 卸単価(税抜), 在庫管理]
  var DEFAULT_PRODUCTS = [
    ['もも肉', '生肉', 'g', 158, 8, '#e8846b', 1300, true],
    ['むね肉', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
    ['ささみ', '生肉', 'g', 128, 8, '#f4c1ad', 1000, true],
    ['手羽先', '生肉', 'g', 118, 8, '#e8846b', 950, true],
    ['手羽元', '生肉', 'g', 98, 8, '#f1a98f', 750, true],
    ['ひき肉', '生肉', 'g', 108, 8, '#f4c1ad', 850, true],
    ['砂肝', '生肉', 'g', 128, 8, '#c96a5a', 1000, true],
    ['レバー', '生肉', 'g', 98, 8, '#a8564a', 700, true],
    ['鶏皮', '生肉', 'g', 68, 8, '#f4c1ad', 450, true],
    ['唐揚げ', '惣菜', 'g', 248, 8, '#d9a441', 0, false],
    ['焼き鳥 もも', '惣菜', 'pc', 120, 8, '#b8743a', 0, false],
    ['焼き鳥 ねぎま', '惣菜', 'pc', 130, 8, '#b8743a', 0, false],
    ['つくね', '惣菜', 'pc', 140, 8, '#b8743a', 0, false],
    ['チキンカツ', '惣菜', 'pc', 200, 8, '#d9a441', 0, false],
    ['手羽先唐揚げ', '惣菜', 'pc', 90, 8, '#d9a441', 0, false],
    ['鶏ガラ', 'その他', 'pc', 100, 8, '#9aa3ab', 80, true],
    ['卵（10個）', 'その他', 'pc', 280, 8, '#e9d27a', 0, false],
    ['その他食品', 'その他', 'open', 0, 8, '#8fa3b8', 0, false],
    ['レジ袋', 'その他', 'pc', 5, 10, '#7f8c8d', 0, false]
  ].map(function (p, i) {
    return {
      id: 'p' + (i + 1), name: p[0], category: p[1], unit: p[2], price: p[3], taxRate: p[4], color: p[5], order: i,
      wsPrice: p[6], trackStock: p[7], minStock: 0
    };
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
    scaleUnit: 'g',    // はかりが単位を送らない場合の単位
    bankInfo: ''       // 請求書に載せる振込先
  };

  // ---------- localStorage ----------
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  var warned = false;
  function warn() {
    if (warned) return;
    warned = true;
    alert('データを保存できませんでした。端末の空き容量が不足している可能性があります。\n設定画面からバックアップを保存し、古い売上を削除してください。');
    setTimeout(function () { warned = false; }, 10000);
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      warn();
      return false;
    }
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function nextNo(key) {
    var n = (read(key, 0) || 0) + 1;
    write(key, n);
    return n;
  }

  // ---------- IndexedDB ----------
  var DB_NAME = 'nikupos';
  var DB_VERSION = 1;
  var COLLECTIONS = ['sales', 'reservations', 'customers', 'wholesale', 'invoices', 'receipts', 'moves'];
  var db = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('IndexedDB非対応')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        COLLECTIONS.forEach(function (name) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
        });
      };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
      rq.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  /** 1種類のデータ（メモリ上の配列 + IndexedDBへの書き込み） */
  function Collection(name) {
    this.name = name;
    this.items = [];
    this.snap = {}; // id → 最後に保存した内容(JSON)。変更の検出に使う
  }
  Collection.prototype.load = function () {
    var self = this;
    if (!db) {
      self.items = read('nikupos.c.' + self.name, []);
      self.items.forEach(function (it) { self.snap[it.id] = JSON.stringify(it); });
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var rq = db.transaction(self.name, 'readonly').objectStore(self.name).getAll();
      rq.onsuccess = function () {
        self.items = rq.result || [];
        self.items.sort(function (a, b) { return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
        self.items.forEach(function (it) { self.snap[it.id] = JSON.stringify(it); });
        resolve();
      };
      rq.onerror = function () { reject(rq.error); };
    });
  };
  Collection.prototype.persist = function (puts, dels) {
    var self = this;
    if (!db) {
      write('nikupos.c.' + self.name, self.items);
      return Promise.resolve();
    }
    if (!puts.length && !dels.length) return Promise.resolve();
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(self.name, 'readwrite');
        var os = tx.objectStore(self.name);
        puts.forEach(function (p) { os.put(p); });
        dels.forEach(function (id) { os.delete(id); });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { warn(); resolve(false); };
      } catch (e) {
        warn();
        resolve(false);
      }
    });
  };
  Collection.prototype.all = function () { return this.items; };
  Collection.prototype.get = function (id) {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i];
    return null;
  };
  Collection.prototype.add = function (obj) {
    this.items.push(obj);
    this.snap[obj.id] = JSON.stringify(obj);
    this.persist([obj], []);
    return true;
  };
  Collection.prototype.update = function (obj) {
    if (this.items.indexOf(obj) < 0) {
      var i = this.items.findIndex(function (x) { return x.id === obj.id; });
      if (i >= 0) this.items[i] = obj; else this.items.push(obj);
    }
    this.snap[obj.id] = JSON.stringify(obj);
    this.persist([obj], []);
    return true;
  };
  /** 配列全体を保存（変更・追加・削除された分だけ書き込む） */
  Collection.prototype.saveAll = function (list) {
    var self = this;
    var puts = [];
    var seen = {};
    list.forEach(function (it) {
      seen[it.id] = true;
      var j = JSON.stringify(it);
      if (self.snap[it.id] !== j) { puts.push(it); self.snap[it.id] = j; }
    });
    var dels = Object.keys(self.snap).filter(function (id) { return !seen[id]; });
    dels.forEach(function (id) { delete self.snap[id]; });
    self.items = list;
    self.persist(puts, dels);
    return true;
  };
  Collection.prototype.removeWhere = function (fn) {
    var keep = [];
    var dels = [];
    var self = this;
    this.items.forEach(function (it) {
      if (fn(it)) { dels.push(it.id); delete self.snap[it.id]; } else keep.push(it);
    });
    this.items = keep;
    this.persist([], dels);
    return dels.length;
  };
  Collection.prototype.replaceAll = function (list) {
    var self = this;
    var dels = Object.keys(self.snap);
    self.snap = {};
    self.items = list.slice();
    self.items.forEach(function (it) { self.snap[it.id] = JSON.stringify(it); });
    if (!db) return self.persist([], []);
    return self.persist([], dels).then(function () { return self.persist(self.items, []); });
  };

  var C = {};
  COLLECTIONS.forEach(function (n) { C[n] = new Collection(n); });

  /** 旧バージョンの localStorage のデータを IndexedDB へ移す */
  function migrateLegacy() {
    var jobs = [];
    [['sales', KEY.legacySales], ['reservations', KEY.legacyReservations]].forEach(function (m) {
      var col = C[m[0]];
      var old = read(m[1], null);
      if (!old || !old.length || col.items.length) return;
      jobs.push(col.replaceAll(old).then(function () {
        if (db) localStorage.removeItem(m[1]);
      }));
    });
    return Promise.all(jobs);
  }

  var Store = {
    KEY: KEY,
    C: C,
    usingIndexedDB: function () { return !!db; },

    init: function () {
      return openDB().then(function (d) { db = d; }, function () { db = null; })
        .then(function () { return Promise.all(COLLECTIONS.map(function (n) { return C[n].load(); })); })
        .then(migrateLegacy);
    },

    // 商品・設定
    getProducts: function () { return read(KEY.products, null) || clone(DEFAULT_PRODUCTS); },
    saveProducts: function (list) { return write(KEY.products, list); },
    getSettings: function () {
      var s = read(KEY.settings, {});
      var merged = clone(DEFAULT_SETTINGS);
      Object.keys(s).forEach(function (k) { merged[k] = s[k]; });
      return merged;
    },
    saveSettings: function (s) { return write(KEY.settings, s); },
    getCart: function () { return read(KEY.cart, null); },
    saveCart: function (cart) { return write(KEY.cart, cart); },

    // 店頭の売上
    getSales: function () { return C.sales.all(); },
    addSale: function (sale) { return C.sales.add(sale); },
    updateSale: function (sale) { return C.sales.update(sale); },
    removeSalesBefore: function (date) { return C.sales.removeWhere(function (s) { return s.date < date; }); },
    nextSeq: function () { return nextNo(KEY.seq); },

    // 予約
    getReservations: function () { return C.reservations.all(); },
    saveReservations: function (list) { return C.reservations.saveAll(list); },
    nextReservationNo: function () { return nextNo(KEY.rseq); },

    // 卸
    getCustomers: function () { return C.customers.all(); },
    saveCustomers: function (list) { return C.customers.saveAll(list); },
    getSlips: function () { return C.wholesale.all(); },
    saveSlips: function (list) { return C.wholesale.saveAll(list); },
    nextSlipNo: function () { return nextNo(KEY.wseq); },
    getInvoices: function () { return C.invoices.all(); },
    saveInvoices: function (list) { return C.invoices.saveAll(list); },
    nextInvoiceNo: function () { return nextNo(KEY.iseq); },
    getReceipts: function () { return C.receipts.all(); },
    saveReceipts: function (list) { return C.receipts.saveAll(list); },

    // 在庫（数量は g または 個）
    getStock: function () { return read(KEY.stock, {}); },
    saveStock: function (stock) { return write(KEY.stock, stock); },
    getMoves: function () { return C.moves.all(); },
    addMoves: function (list) {
      list.forEach(function (m) { C.moves.items.push(m); C.moves.snap[m.id] = JSON.stringify(m); });
      C.moves.persist(list, []);
    },

    // バックアップ
    exportAll: function () {
      var data = {
        app: 'NIKUPOS',
        version: 2,
        exportedAt: new Date().toISOString(),
        products: Store.getProducts(),
        settings: Store.getSettings(),
        stock: Store.getStock(),
        counters: {}
      };
      ['seq', 'rseq', 'wseq', 'iseq'].forEach(function (k) { data.counters[k] = read(KEY[k], 0); });
      COLLECTIONS.forEach(function (n) { data[n] = C[n].all(); });
      return data;
    },
    importAll: function (data) {
      if (!data || data.app !== 'NIKUPOS') return Promise.reject(new Error('NIKUPOSのバックアップファイルではありません'));
      write(KEY.products, data.products || clone(DEFAULT_PRODUCTS));
      write(KEY.settings, data.settings || clone(DEFAULT_SETTINGS));
      write(KEY.stock, data.stock || {});
      var counters = data.counters || { seq: data.seq, rseq: data.rseq }; // version 1 との互換
      ['seq', 'rseq', 'wseq', 'iseq'].forEach(function (k) { write(KEY[k], counters[k] || 0); });
      return Promise.all(COLLECTIONS.map(function (n) { return C[n].replaceAll(data[n] || []); }));
    },
    /** 使用量の目安 */
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
      return Promise.resolve({});
    }
  };

  root.Store = Store;
})(this);
