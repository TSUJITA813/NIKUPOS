/*
 * データ保存
 *  - 件数が増えるデータ（売上・予約・卸・在庫履歴など）… IndexedDB（大容量）
 *  - 小さなデータ（商品・設定・連番・カート）…… localStorage
 * 起動時に Store.init() で IndexedDB を読み込み、以後はメモリ上のデータを同期的に扱う。
 * 変更はその都度 IndexedDB に書き込み、クラウド同期（sync.js）が有効なら送信待ちに入れる。
 * 各データには変更日時 _m を付け、別の端末と同じデータを変更した場合は新しい方を採用する。
 */
(function (root) {
  'use strict';

  var KEY = {
    products: 'nikupos.products',
    settings: 'nikupos.settings',
    cart: 'nikupos.cart',
    holds: 'nikupos.holds', // 保留中の会計（この端末だけ）
    legacyStock: 'nikupos.stock', // 旧バージョンの在庫数（今は記録から計算）
    seq: 'nikupos.seq',       // 売上の取引No
    rseq: 'nikupos.rseq',     // 予約No
    wseq: 'nikupos.wseq',     // 卸伝票No
    iseq: 'nikupos.iseq',     // 請求書No
    oseq: 'nikupos.oseq',     // 発注書No
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
    bankInfo: '',      // 請求書に載せる振込先
    feeMax: 1000,      // 振込手数料として処理できる差額の上限（円）
    deviceCode: '',    // この端末の記号（複数端末で使うとき、番号の頭に付ける）
    printerMode: 'browser', // 'browser'（印刷画面）| 'epson'（ePOS-Print で直接印刷）
    printerHost: '',
    printerProto: 'auto',
    printerDevid: 'local_printer',
    drawerAuto: true
  };
  // 全端末で共通にする設定（それ以外はこの端末だけの設定）
  var SHARED_SETTINGS = ['storeName', 'address', 'tel', 'invoiceNo', 'footer', 'categories', 'rounding', 'bankInfo', 'feeMax', 'acct', 'cashlessTypes', 'promos', 'staff', 'permissions', 'fixedCosts', 'admins', 'adminRecovery'];

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
  function nowISO() { return new Date().toISOString(); }
  function nextNo(key) {
    var n = (read(key, 0) || 0) + 1;
    write(key, n);
    return n;
  }

  // ---------- 変更の通知 ----------
  var version = 0;             // データが変わるたびに増える（在庫数の再計算などに使う）
  var localHooks = [];         // 自分の端末での変更 → クラウド同期へ
  var remoteHooks = [];        // 別の端末からの変更 → 画面の再表示へ
  function changed(col, ids, isDelete) {
    version++;
    localHooks.forEach(function (f) { f(col, ids, isDelete); });
  }

  // ---------- IndexedDB ----------
  var DB_NAME = 'nikupos';
  var DB_VERSION = 3; // 2: 入出金・レジ締め・操作ログ・発注書、3: 価格改定の予約
  var COLLECTIONS = ['sales', 'reservations', 'customers', 'wholesale', 'invoices', 'receipts', 'moves',
    'cashmoves', 'closings', 'logs', 'orders', 'pricechanges'];
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

  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

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
        self.items.forEach(function (it) { self.snap[it.id] = JSON.stringify(it); });
        self.replayWal();
        self.items.sort(byId);
        resolve();
      };
      rq.onerror = function () { reject(rq.error); };
    });
  };
  // ---- 書き込みの控え（アプリを閉じた直後でもデータを失わないため） ----
  // IndexedDB への保存は少し遅れて終わるので、その間にアプリが閉じられると消えてしまう。
  // 先に localStorage（すぐに保存される）へ控えを書き、保存が終わったら消す。次に開いたとき残っていれば反映する。
  var WAL_MAX = 200; // 一度にこれより多い保存（復元など）は控えを取らない
  Collection.prototype.walKey = function () { return 'nikupos.wal.' + this.name; };
  Collection.prototype.readWal = function () {
    try { return JSON.parse(localStorage.getItem(this.walKey()) || 'null') || { p: {}, d: {} }; } catch (e) { return { p: {}, d: {} }; }
  };
  Collection.prototype.writeWal = function (w) {
    try {
      if (!Object.keys(w.p).length && !Object.keys(w.d).length) localStorage.removeItem(this.walKey());
      else localStorage.setItem(this.walKey(), JSON.stringify(w));
      return true;
    } catch (e) { return false; }
  };
  /** 前回、保存が終わる前に閉じられた分を反映する */
  Collection.prototype.replayWal = function () {
    var self = this;
    var w = self.readWal();
    var puts = [], dels = [];
    Object.keys(w.p).forEach(function (id) {
      var obj;
      try { obj = JSON.parse(w.p[id]); } catch (e) { return; }
      var i = self.items.findIndex(function (x) { return x.id === id; });
      if (i >= 0) self.items[i] = obj; else self.items.push(obj);
      self.snap[id] = w.p[id];
      puts.push(obj);
    });
    Object.keys(w.d).forEach(function (id) {
      self.items = self.items.filter(function (x) { return x.id !== id; });
      delete self.snap[id];
      dels.push(id);
    });
    if (puts.length || dels.length) self.persist(puts, dels);
  };
  Collection.prototype.persist = function (puts, dels) {
    var self = this;
    if (!db) {
      write('nikupos.c.' + self.name, self.items);
      return Promise.resolve();
    }
    if (!puts.length && !dels.length) return Promise.resolve();
    var useWal = puts.length + dels.length <= WAL_MAX;
    var written = {};
    if (useWal) {
      var w = self.readWal();
      puts.forEach(function (p) { written[p.id] = w.p[p.id] = JSON.stringify(p); delete w.d[p.id]; });
      dels.forEach(function (id) { w.d[id] = 1; delete w.p[id]; });
      self.writeWal(w);
    }
    function clearWal() {
      if (!useWal) return;
      var w2 = self.readWal();
      puts.forEach(function (p) { if (w2.p[p.id] === written[p.id]) delete w2.p[p.id]; });
      dels.forEach(function (id) { delete w2.d[id]; });
      self.writeWal(w2);
    }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(self.name, 'readwrite');
        var os = tx.objectStore(self.name);
        puts.forEach(function (p) { os.put(p); });
        dels.forEach(function (id) { os.delete(id); });
        tx.oncomplete = function () { clearWal(); resolve(true); };
        tx.onerror = tx.onabort = function () { warn(); resolve(false); };
      } catch (e) {
        warn();
        resolve(false);
      }
    });
  };
  /** 変更日時を付けて、変更検出用の内容を記録 */
  Collection.prototype.stamp = function (obj) {
    obj._m = nowISO();
    this.snap[obj.id] = JSON.stringify(obj);
  };
  Collection.prototype.all = function () { return this.items; };
  Collection.prototype.get = function (id) {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i];
    return null;
  };
  Collection.prototype.add = function (obj) {
    this.items.push(obj);
    this.stamp(obj);
    this.persist([obj], []);
    changed(this.name, [obj.id], false);
    return true;
  };
  Collection.prototype.update = function (obj) {
    if (this.items.indexOf(obj) < 0) {
      var i = this.items.findIndex(function (x) { return x.id === obj.id; });
      if (i >= 0) this.items[i] = obj; else this.items.push(obj);
    }
    this.stamp(obj);
    this.persist([obj], []);
    changed(this.name, [obj.id], false);
    return true;
  };
  /** 配列全体を保存（変更・追加・削除された分だけ書き込む） */
  Collection.prototype.saveAll = function (list) {
    var self = this;
    var puts = [];
    var seen = {};
    list.forEach(function (it) {
      seen[it.id] = true;
      if (self.snap[it.id] !== JSON.stringify(it)) { self.stamp(it); puts.push(it); }
    });
    var dels = Object.keys(self.snap).filter(function (id) { return !seen[id]; });
    dels.forEach(function (id) { delete self.snap[id]; });
    self.items = list;
    self.persist(puts, dels);
    if (puts.length) changed(self.name, puts.map(function (p) { return p.id; }), false);
    if (dels.length) changed(self.name, dels, true);
    return true;
  };
  /** この端末だけで削除（古い売上の整理など。他の端末には伝えない） */
  Collection.prototype.removeLocal = function (fn) {
    var keep = [];
    var dels = [];
    var self = this;
    this.items.forEach(function (it) {
      if (fn(it)) { dels.push(it.id); delete self.snap[it.id]; } else keep.push(it);
    });
    this.items = keep;
    this.persist([], dels);
    version++;
    return dels.length;
  };
  Collection.prototype.replaceAll = function (list) {
    var self = this;
    var dels = Object.keys(self.snap);
    self.snap = {};
    self.items = list.slice().sort(byId);
    self.items.forEach(function (it) { self.snap[it.id] = JSON.stringify(it); });
    version++;
    if (!db) return self.persist([], []);
    // 古い控えが復元後のデータを上書きしないよう消し、削除と書き込みを1回の保存（途中で閉じても半端にならない）で行う
    try { localStorage.removeItem(self.walKey()); } catch (e) { /* noop */ }
    var keep = {};
    self.items.forEach(function (it) { keep[it.id] = true; });
    return self.persist(self.items, dels.filter(function (id) { return !keep[id]; }));
  };
  /**
   * 別の端末からの変更を反映（新しい方を採用）
   * @returns 'changed' 反映した / 'stale' 手元の方が新しい（送り直しが必要）/ '' 何もしない
   */
  Collection.prototype.applyRemote = function (id, data, del) {
    var local = this.get(id);
    if (del) {
      if (!local) return '';
      this.items.splice(this.items.indexOf(local), 1);
      delete this.snap[id];
      this.persist([], [id]);
      return 'changed';
    }
    if (local && (local._m || '') > (data._m || '')) return 'stale';
    if (local && (local._m || '') === (data._m || '')) return '';
    if (local) this.items[this.items.indexOf(local)] = data;
    else { this.items.push(data); this.items.sort(byId); }
    this.snap[id] = JSON.stringify(data);
    this.persist([data], []);
    return 'changed';
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
    return Promise.all(jobs).then(migrateStock);
  }
  /** 旧バージョンの「在庫数」を、今の時点の棚卸の記録に置き換える */
  function migrateStock() {
    var old = read(KEY.legacyStock, null);
    if (!old) return;
    var products = Store.getProducts();
    var at = nowISO();
    var moves = Object.keys(old).filter(function (pid) { return old[pid]; }).map(function (pid, i) {
      var p = products.find(function (x) { return x.id === pid; });
      return { id: 'M' + Date.now() + '-m' + i, at: at, date: at.slice(0, 10), type: 'count', productId: pid, name: p ? p.name : pid, delta: 0, actual: old[pid], note: 'データ移行' };
    });
    moves.forEach(function (m) { C.moves.add(m); });
    localStorage.removeItem(KEY.legacyStock);
  }

  // ---------- 在庫数（記録から計算・結果を覚えておく） ----------
  var stockMemo = { v: -1, value: null };

  // ---------- 商品・設定の変更検出 ----------
  var productTombstones = read('nikupos.productTombstones', {}); // 削除した商品ID（同期用）

  var Store = {
    KEY: KEY,
    C: C,
    COLLECTIONS: COLLECTIONS,
    SHARED_SETTINGS: SHARED_SETTINGS,
    usingIndexedDB: function () { return !!db; },
    version: function () { return version; },

    init: function () {
      return openDB().then(function (d) { db = d; }, function () { db = null; })
        .then(function () { return Promise.all(COLLECTIONS.map(function (n) { return C[n].load(); })); })
        .then(migrateLegacy);
    },

    // 商品
    getProducts: function () { return read(KEY.products, null) || clone(DEFAULT_PRODUCTS); },
    saveProducts: function (list) {
      var before = {};
      (read(KEY.products, null) || clone(DEFAULT_PRODUCTS)).forEach(function (p) { before[p.id] = JSON.stringify(p); });
      var changedIds = [];
      list.forEach(function (p) {
        var j = JSON.stringify(p);
        if (before[p.id] !== j) { p._m = nowISO(); changedIds.push(p.id); delete productTombstones[p.id]; }
        delete before[p.id];
      });
      var removed = Object.keys(before);
      removed.forEach(function (id) { productTombstones[id] = nowISO(); });
      var ok = write(KEY.products, list);
      if (removed.length) write('nikupos.productTombstones', productTombstones);
      if (changedIds.length) changed('products', changedIds, false);
      if (removed.length) changed('products', removed, true);
      return ok;
    },

    // 設定（共通の項目とこの端末だけの項目）
    getSettings: function () {
      var s = read(KEY.settings, {});
      var merged = clone(DEFAULT_SETTINGS);
      Object.keys(s).forEach(function (k) { merged[k] = s[k]; });
      return merged;
    },
    saveSettings: function (s) {
      var before = Store.getSettings();
      var sharedChanged = SHARED_SETTINGS.some(function (k) { return JSON.stringify(before[k]) !== JSON.stringify(s[k]); });
      if (sharedChanged) s._sharedM = nowISO();
      var ok = write(KEY.settings, s);
      if (sharedChanged) changed('config', ['shared'], false);
      return ok;
    },
    getCart: function () { return read(KEY.cart, null); },
    saveCart: function (cart) { return write(KEY.cart, cart); },
    getHolds: function () { return read(KEY.holds, []); },
    saveHolds: function (list) { return write(KEY.holds, list); },

    /** 重ならないID（複数の端末で同時に作っても重ならないよう乱数を付ける） */
    newId: function (prefix) {
      return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    },
    /** 番号（複数端末で使うときは、端末の記号を頭に付けた表示用の番号も作る） */
    makeNo: function (seqKey) {
      var n = nextNo(KEY[seqKey]);
      var code = Store.getSettings().deviceCode;
      return { no: n, noLabel: code ? code + '-' + n : String(n) };
    },

    // 店頭の売上
    getSales: function () { return C.sales.all(); },
    addSale: function (sale) { return C.sales.add(sale); },
    updateSale: function (sale) { return C.sales.update(sale); },
    nextSeq: function () { return nextNo(KEY.seq); },
    /** 古い売上をこの端末から削除。在庫数が変わらないよう、その時点の在庫を棚卸として記録してから消す */
    removeSalesBefore: function (date) {
      var p = date.split('-').map(Number);
      var cutoff = new Date(p[0], p[1] - 1, p[2]).toISOString();
      var targets = C.sales.all().filter(function (s) { return s.date < date; });
      if (!targets.length) return 0;
      var st = Calc.computeStock(C.moves.all(), C.sales.all(), C.wholesale.all(), cutoff);
      var products = Store.getProducts();
      var at = new Date(new Date(cutoff).getTime() - 1).toISOString();
      Object.keys(st).forEach(function (pid, i) {
        var pr = products.find(function (x) { return x.id === pid; });
        if (!pr || !pr.trackStock) return;
        C.moves.add({ id: 'M' + Date.now() + '-c' + i, at: at, date: date, type: 'count', productId: pid, name: pr.name, delta: 0, actual: st[pid], note: '古い売上の整理' });
      });
      return C.sales.removeLocal(function (s) { return s.date < date; });
    },

    // 予約
    getReservations: function () { return C.reservations.all(); },
    saveReservations: function (list) { return C.reservations.saveAll(list); },
    nextReservationNo: function () { return nextNo(KEY.rseq); },

    // 卸
    getCustomers: function () { return C.customers.all(); },
    saveCustomers: function (list) { return C.customers.saveAll(list); },
    getSlips: function () { return C.wholesale.all(); },
    saveSlips: function (list) { return C.wholesale.saveAll(list); },
    getInvoices: function () { return C.invoices.all(); },
    saveInvoices: function (list) { return C.invoices.saveAll(list); },
    getReceipts: function () { return C.receipts.all(); },
    saveReceipts: function (list) { return C.receipts.saveAll(list); },

    // 在庫（数量は g または 個）
    getStock: function () {
      if (stockMemo.v !== version) {
        stockMemo.value = Calc.computeStock(C.moves.all(), C.sales.all(), C.wholesale.all());
        stockMemo.v = version;
      }
      return stockMemo.value;
    },
    getMoves: function () { return C.moves.all(); },

    // 入出金・レジ締め・操作ログ・発注書
    getCashMoves: function () { return C.cashmoves.all(); },
    addCashMove: function (m) { return C.cashmoves.add(m); },
    saveCashMoves: function (list) { return C.cashmoves.saveAll(list); },
    getClosings: function () { return C.closings.all(); },
    addClosing: function (x) { return C.closings.add(x); },
    getLogs: function () { return C.logs.all(); },
    addLog: function (x) { return C.logs.add(x); },
    getPriceChanges: function () { return C.pricechanges.all(); },
    savePriceChanges: function (list) { return C.pricechanges.saveAll(list); },
    getOrders: function () { return C.orders.all(); },
    saveOrders: function (list) { return C.orders.saveAll(list); },
    addMoves: function (list) { list.forEach(function (m) { C.moves.add(m); }); },

    // ---------- クラウド同期用 ----------
    onLocalChange: function (f) { localHooks.push(f); },
    onRemoteChange: function (f) { remoteHooks.push(f); },
    /** 送信する内容（null なら削除済み） */
    syncGet: function (col, id) {
      if (C[col]) return C[col].get(id);
      if (col === 'products') return Store.getProducts().find(function (p) { return p.id === id; }) || null;
      if (col === 'config' && id === 'shared') {
        var s = Store.getSettings();
        var out = { id: 'shared', _m: s._sharedM || '' };
        SHARED_SETTINGS.forEach(function (k) { out[k] = s[k]; });
        return out;
      }
      return null;
    },
    /** 最初に全部送るときの一覧 */
    syncAllKeys: function () {
      var keys = [];
      COLLECTIONS.forEach(function (n) { C[n].all().forEach(function (it) { keys.push(n + '|' + it.id); }); });
      Store.getProducts().forEach(function (p) { keys.push('products|' + p.id); });
      keys.push('config|shared');
      return keys;
    },
    localDataCount: function () {
      return COLLECTIONS.reduce(function (s, n) { return s + C[n].all().length; }, 0);
    },
    /** 別の端末からの変更をまとめて反映 */
    applyRemote: function (docs) {
      var n = 0;
      var products = null;
      var settings = null;
      // クラウドの方が古かったデータ（オフライン中の変更が後から届いて上書きした場合など）。手元の新しい方を送り直す
      var stale = {};
      function markStale(col, id) { (stale[col] = stale[col] || []).push(id); }
      docs.forEach(function (d) {
        if (C[d.col]) {
          var r = C[d.col].applyRemote(d.id, d.data, d.del);
          if (r === 'changed') n++;
          else if (r === 'stale') markStale(d.col, d.id);
        } else if (d.col === 'products') {
          products = products || Store.getProducts();
          var i = products.findIndex(function (p) { return p.id === d.id; });
          if (d.del) {
            if (i >= 0) { products.splice(i, 1); n++; }
          } else if (i >= 0 && (products[i]._m || '') > (d.data._m || '')) {
            markStale('products', d.id);
          } else if (i < 0 || (products[i]._m || '') < (d.data._m || '')) {
            if (i >= 0) products[i] = d.data; else products.push(d.data);
            n++;
          }
        } else if (d.col === 'config' && d.id === 'shared' && d.data) {
          settings = settings || Store.getSettings();
          // クラウドにつなぐ前にこの端末だけで登録した管理者は、お店の管理者（クラウド側）があればそちらに合わせる
          if (settings.adminsLocal) {
            if (d.data.admins && d.data.admins.length) {
              settings.admins = d.data.admins;
              settings.adminRecovery = d.data.adminRecovery;
              n++;
            }
            delete settings.adminsLocal;
          }
          if ((settings._sharedM || '') > (d.data._m || '')) markStale('config', 'shared');
          else if ((settings._sharedM || '') < (d.data._m || '')) {
            SHARED_SETTINGS.forEach(function (k) { if (d.data[k] !== undefined) settings[k] = d.data[k]; });
            settings._sharedM = d.data._m;
            n++;
          }
        }
      });
      Object.keys(stale).forEach(function (col) { localHooks.forEach(function (f) { f(col, stale[col], false); }); });
      if (products) write(KEY.products, products);
      if (settings) write(KEY.settings, settings);
      if (n) {
        version++;
        remoteHooks.forEach(function (f) { f(n); });
      }
      return n;
    },

    // バックアップ
    exportAll: function () {
      var data = {
        app: 'NIKUPOS',
        version: 3,
        exportedAt: nowISO(),
        products: Store.getProducts(),
        settings: Store.getSettings(),
        counters: {}
      };
      ['seq', 'rseq', 'wseq', 'iseq', 'oseq'].forEach(function (k) { data.counters[k] = read(KEY[k], 0); });
      COLLECTIONS.forEach(function (n) { data[n] = C[n].all(); });
      return data;
    },
    importAll: function (data) {
      if (!data || data.app !== 'NIKUPOS') return Promise.reject(new Error('NIKUPOSのバックアップファイルではありません'));
      write(KEY.products, data.products || clone(DEFAULT_PRODUCTS));
      var keepLocal = Store.getSettings();
      var s = data.settings || clone(DEFAULT_SETTINGS);
      s.deviceCode = keepLocal.deviceCode; // 端末の記号はこの端末のものを使う
      write(KEY.settings, s);
      var counters = data.counters || { seq: data.seq, rseq: data.rseq }; // version 1 との互換
      ['seq', 'rseq', 'wseq', 'iseq', 'oseq'].forEach(function (k) { write(KEY[k], counters[k] || 0); });
      if (data.stock) write(KEY.legacyStock, data.stock); // version 2 の在庫数 → 棚卸の記録に変換
      return Promise.all(COLLECTIONS.map(function (n) { return C[n].replaceAll(data[n] || []); })).then(migrateStock);
    },
    /** この端末のデータを空にする（クラウドのデータで置き換えるとき） */
    clearLocalData: function () {
      return Promise.all(COLLECTIONS.map(function (n) { return C[n].replaceAll([]); }));
    },
    /** 使用量の目安 */
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
      return Promise.resolve({});
    }
  };

  root.Store = Store;
})(this);
