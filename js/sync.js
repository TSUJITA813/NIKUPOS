/*
 * クラウド同期（複数の端末で同じデータを使う）
 *
 * 保存先：Firebase（Google）の Cloud Firestore。REST API を直接使う（追加のライブラリ不要）。
 *   shops/{ログインしたお店のユーザーID}/records/{種類~ID}
 *     col: データの種類, d: 内容(JSON文字列), del: 削除済みか, dev: 送った端末, _u: サーバーが受け取った時刻
 * 動き：
 *   - この端末での変更は「送信待ち」に入れ、まとめて送る
 *   - 30秒ごと（画面を開いている間）と変更の直後に、サーバーの新しい変更を受け取って反映する
 *   - 通信できない間もレジは使える。つながったときに送受信する
 *   - 同じデータが両方の端末で変更された場合は、後から変更した方を採用する
 */
(function (root) {
  'use strict';

  var CFG_KEY = 'nikupos.sync';
  var OUT_KEY = 'nikupos.syncOutbox';
  var POLL_MS = 30000;
  var PUSH_BATCH = 400;   // Firestore の1回の書き込みは500件まで
  var PULL_LIMIT = 1000;

  function read(key, fb) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 容量不足 */ } }

  // cfg: { enabled, apiKey, projectId, email, uid, refreshToken, cursor, cursorInclusive, fullUpload, lastSync,
  //        authBase, tokenBase, fsBase（開発用に差し替え可能） }
  var cfg = read(CFG_KEY, { enabled: false });
  var outbox = read(OUT_KEY, []);
  var outSet = {};
  outbox.forEach(function (k) { outSet[k] = true; });
  var idToken = null;
  var idExp = 0;
  var busy = false;
  var inflight = {};  // 送信中のデータ
  var requeue = {};   // 送信中にまた変更されたデータ（送信後にもう一度送る）
  var again = false;
  var timer = null;
  var status = { state: cfg.enabled ? 'idle' : 'off', error: '', lastSync: cfg.lastSync || '' };
  var listeners = [];

  function saveCfg() { write(CFG_KEY, cfg); }
  function saveOutbox() { write(OUT_KEY, outbox); }
  function setStatus(state, error) {
    status.state = state;
    status.error = error || '';
    status.pending = outbox.length + (cfg.fullUpload ? cfg.fullUpload.length : 0);
    listeners.forEach(function (f) { f(status); });
  }

  function authBase() { return cfg.authBase || 'https://identitytoolkit.googleapis.com'; }
  function tokenBase() { return cfg.tokenBase || 'https://securetoken.googleapis.com'; }
  function fsBase() { return cfg.fsBase || 'https://firestore.googleapis.com'; }
  function dbPath() { return 'projects/' + cfg.projectId + '/databases/(default)/documents'; }
  function shopPath() { return dbPath() + '/shops/' + cfg.uid; }

  function httpError(res, body) {
    var msg = (body && body.error && (body.error.message || body.error.status)) || ('HTTP ' + res.status);
    var e = new Error(msg);
    e.status = res.status;
    return e;
  }
  function postJSON(url, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (b) {
        if (!res.ok) throw httpError(res, b);
        return b;
      });
    });
  }

  // ---------- ログイン ----------
  function signIn(o) {
    return postJSON(authBase() + '/v1/accounts:signInWithPassword?key=' + encodeURIComponent(o.apiKey),
      { email: o.email, password: o.password, returnSecureToken: true });
  }
  function refreshToken() {
    var body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cfg.refreshToken);
    return fetch(tokenBase() + '/v1/token?key=' + encodeURIComponent(cfg.apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (b) {
        if (!res.ok) throw httpError(res, b);
        idToken = b.id_token;
        idExp = Date.now() + Number(b.expires_in || 3600) * 1000;
        if (b.refresh_token && b.refresh_token !== cfg.refreshToken) { cfg.refreshToken = b.refresh_token; saveCfg(); }
        return idToken;
      });
    });
  }
  function token() {
    if (idToken && Date.now() < idExp - 60000) return Promise.resolve(idToken);
    return refreshToken();
  }

  // ---------- 送信 ----------
  function enqueue(col, ids) {
    if (!cfg.enabled) return;
    ids.forEach(function (id) {
      var k = col + '|' + id;
      if (inflight[k]) requeue[k] = true;
      if (!outSet[k]) { outSet[k] = true; outbox.push(k); }
    });
    saveOutbox();
    status.pending = outbox.length + (cfg.fullUpload ? cfg.fullUpload.length : 0);
    schedule(1500);
  }

  function encode(key) {
    var i = key.indexOf('|');
    var col = key.slice(0, i);
    var id = key.slice(i + 1);
    var rec = Store.syncGet(col, id);
    return {
      update: {
        name: dbPath() + '/shops/' + cfg.uid + '/records/' + encodeURIComponent(col + '~' + id),
        fields: {
          col: { stringValue: col },
          id: { stringValue: id },
          d: { stringValue: rec ? JSON.stringify(rec) : '' },
          del: { booleanValue: !rec },
          dev: { stringValue: Store.getSettings().deviceCode || '' }
        }
      },
      updateTransforms: [{ fieldPath: '_u', setToServerValue: 'REQUEST_TIME' }]
    };
  }

  function pushOnce() {
    var fromFull = false;
    var keys;
    if (outbox.length) keys = outbox.slice(0, PUSH_BATCH);
    else if (cfg.fullUpload && cfg.fullUpload.length) { keys = cfg.fullUpload.slice(0, PUSH_BATCH); fromFull = true; }
    else return Promise.resolve(false);
    if (!fromFull) keys.forEach(function (k) { inflight[k] = true; });
    return token().then(function (t) {
      return postJSON(fsBase() + '/v1/' + dbPath() + ':commit', { writes: keys.map(encode) }, t);
    }).then(function () {
      if (fromFull) {
        cfg.fullUpload = cfg.fullUpload.slice(keys.length);
        if (!cfg.fullUpload.length) cfg.fullUpload = null;
        saveCfg();
      } else {
        // 送信中に同じデータがまた変更された場合に備え、送った分だけ取り除く
        outbox = outbox.slice(keys.length);
        keys.forEach(function (k) {
          delete outSet[k];
          delete inflight[k];
          if (requeue[k]) { delete requeue[k]; outbox.push(k); }
        });
        outSet = {};
        outbox.forEach(function (k) { outSet[k] = true; });
        saveOutbox();
      }
      return true;
    }, function (err) {
      keys.forEach(function (k) { delete inflight[k]; delete requeue[k]; });
      throw err;
    });
  }

  // ---------- 受信 ----------
  function decode(doc) {
    var f = doc.fields || {};
    var col = f.col && f.col.stringValue;
    var id = f.id && f.id.stringValue;
    var del = !!(f.del && f.del.booleanValue);
    var data = null;
    if (!del && f.d && f.d.stringValue) {
      try { data = JSON.parse(f.d.stringValue); } catch (e) { return null; }
    }
    if (!col || !id) return null;
    return { col: col, id: id, del: del, data: data, u: f._u && f._u.timestampValue };
  }

  function pullOnce() {
    var q = {
      from: [{ collectionId: 'records' }],
      orderBy: [{ field: { fieldPath: '_u' }, direction: 'ASCENDING' }],
      limit: PULL_LIMIT
    };
    if (cfg.cursor) {
      q.where = { fieldFilter: { field: { fieldPath: '_u' }, op: cfg.cursorInclusive ? 'GREATER_THAN_OR_EQUAL' : 'GREATER_THAN', value: { timestampValue: cfg.cursor } } };
    }
    return token().then(function (t) {
      return postJSON(fsBase() + '/v1/' + shopPath() + ':runQuery', { structuredQuery: q }, t);
    }).then(function (rows) {
      var docs = (rows || []).filter(function (r) { return r.document; }).map(function (r) { return decode(r.document); }).filter(Boolean);
      if (docs.length) {
        Store.applyRemote(docs);
        cfg.cursor = docs[docs.length - 1].u || cfg.cursor;
      }
      var full = (rows || []).filter(function (r) { return r.document; }).length >= PULL_LIMIT;
      // 続きがあるときは、同じ時刻のデータを取りこぼさないよう同じ時刻から読む
      // （ただし全件が同じ時刻なら先に進めないので、次の時刻から）
      cfg.cursorInclusive = full && !(docs.length && docs[0].u === docs[docs.length - 1].u);
      saveCfg();
      return full;
    });
  }

  function pullAll() {
    var n = 0;
    function loop() { return pullOnce().then(function (more) { return more && ++n < 200 ? loop() : null; }); }
    return loop();
  }

  // ---------- 同期の実行 ----------
  function syncNow() {
    if (!cfg.enabled) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    if (root.navigator && navigator.onLine === false) { setStatus('offline'); schedule(POLL_MS); return Promise.resolve(); }
    busy = true;
    setStatus('syncing');
    var rounds = 0;
    function pushLoop() {
      return pushOnce().then(function (more) { return more && ++rounds < 50 ? pushLoop() : null; });
    }
    var pulls = 0;
    function pullLoop() {
      return pullOnce().then(function (more) { return more && ++pulls < 50 ? pullLoop() : null; });
    }
    return pushLoop().then(pullLoop).then(function () {
      cfg.lastSync = new Date().toISOString();
      status.lastSync = cfg.lastSync;
      saveCfg();
      setStatus('idle');
    }).catch(function (err) {
      var msg;
      if (err && (err.status === 400 || err.status === 401) && /TOKEN|token|INVALID_REFRESH|USER_DISABLED|USER_NOT_FOUND/.test(err.message)) {
        msg = 'ログインの有効期限が切れました。設定画面でもう一度ログインしてください。';
        idToken = null;
      } else if (err && err.status === 403) {
        msg = 'データへのアクセスが許可されていません。Firestoreのルール設定を確認してください。';
      } else if (err && err.status) {
        msg = '同期エラー：' + err.message;
      } else {
        msg = '';
        setStatus('offline');
        return;
      }
      setStatus('error', msg);
    }).then(function () {
      busy = false;
      if (again) { again = false; schedule(500); } else schedule(POLL_MS);
    });
  }

  function schedule(ms) {
    if (!cfg.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (root.document && document.hidden) { schedule(POLL_MS); return; }
      syncNow();
    }, ms);
  }

  // ---------- 公開 ----------
  var Sync = {
    status: function () { return status; },
    config: function () { return cfg; },
    onStatus: function (f) { listeners.push(f); },
    syncNow: syncNow,
    /** ログインできるか確かめるだけ（保存しない） */
    checkLogin: function (o) { return signIn(o); },

    /**
     * 接続（ログイン）
     * @param o { apiKey, projectId, email, password, mode: 'merge'(この端末のデータも送る) | 'cloud'(この端末のデータを消してクラウドを使う) }
     */
    connect: function (o) {
      return signIn(o).then(function (b) {
        cfg = {
          enabled: true, apiKey: o.apiKey, projectId: o.projectId, email: o.email,
          uid: b.localId, refreshToken: b.refreshToken, cursor: null, cursorInclusive: false, fullUpload: null,
          authBase: cfg.authBase, tokenBase: cfg.tokenBase, fsBase: cfg.fsBase
        };
        idToken = b.idToken;
        idExp = Date.now() + Number(b.expiresIn || 3600) * 1000;
        outbox = [];
        outSet = {};
        saveOutbox();
        saveCfg();
        var prep = o.mode === 'cloud' ? Store.clearLocalData() : Promise.resolve();
        // 先にクラウドのデータを全部受け取り（新しい方を採用）、その後でこの端末のデータを送る。
        // こうすると、この端末の古いデータでクラウドの新しいデータを上書きしない。
        busy = true;
        setStatus('syncing');
        return prep.then(pullAll).then(function () {
          if (o.mode !== 'cloud') cfg.fullUpload = Store.syncAllKeys();
          saveCfg();
        }).then(function () {
          busy = false;
          return syncNow();
        }, function (err) {
          busy = false;
          cfg.enabled = false;
          saveCfg();
          setStatus('off');
          throw err;
        });
      });
    },
    /** この端末のデータを全部送り直す（バックアップから復元した後など） */
    resendAll: function () {
      if (!cfg.enabled) return Promise.resolve();
      cfg.fullUpload = Store.syncAllKeys();
      saveCfg();
      return syncNow();
    },
    disconnect: function () {
      clearTimeout(timer);
      cfg = { enabled: false, authBase: cfg.authBase, tokenBase: cfg.tokenBase, fsBase: cfg.fsBase };
      idToken = null;
      outbox = [];
      outSet = {};
      saveCfg();
      saveOutbox();
      setStatus('off');
    },
    /** 起動時に呼ぶ */
    start: function () {
      Store.onLocalChange(function (col, ids) { enqueue(col, ids); });
      if (!cfg.enabled) return;
      setStatus('idle');
      schedule(300);
      if (root.addEventListener) {
        root.addEventListener('online', function () { schedule(300); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(300); });
      }
    }
  };

  root.Sync = Sync;
})(this);
