/*
 * 管理画面（ID・パスワードでログイン）
 *  レジアプリの「🔒管理」タブ、またはパソコンで …/admin.html（…/#admin）を開くと使えます。
 *  ダッシュボード・分析・操作ログ・商品と価格・設定は、管理者のログインが必要です。
 *  パスワードはそのまま保存せず、PBKDF2（SHA-256・21万回）で変換した値だけを保存します。
 *  クラウド同期を使うと、管理者のID・パスワードは全端末で共通になります。
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc;
  var SESSION_KEY = 'nikupos.adminSession';
  var FAIL_KEY = 'nikupos.adminFails';
  var TIMEOUT_KEY = 'nikupos.adminTimeout';
  var ITER = 210000;
  var ADMIN_VIEWS = ['admin', 'products', 'settings'];
  var TABS = [['dash', 'ダッシュボード'], ['analysis', '分析'], ['log', '操作ログ'], ['products', '商品・価格'], ['settings', '設定']];
  var adminTab = 'dash';

  // ---------- パスワードの変換 ----------
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function randomHex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a.buffer); }
  function cryptoOk() { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); }
  function derive(password, salt, iter) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
    }).then(hex);
  }
  /** 比べるときに時間で差が出ないように */
  function same(a, b) {
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  function admins() { return POS.settings().admins || []; }
  function normId(id) { return String(id || '').trim().toLowerCase(); }

  function makeAccount(id, password) {
    var salt = randomHex(16);
    return derive(password, salt, ITER).then(function (h) { return { id: normId(id), salt: salt, hash: h, iter: ITER, createdAt: new Date().toISOString() }; });
  }
  function checkPassword(acc, password) {
    return derive(password, acc.salt, acc.iter || ITER).then(function (h) { return same(h, acc.hash); });
  }
  /** 回復用コード（パスワードを忘れたとき用）。紛らわしい文字（0/O/1/I）は使わない */
  function newRecoveryCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < 12; i++) s += chars[a[i] % chars.length] + (i === 3 || i === 7 ? '-' : '');
    return s;
  }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function saveRecovery(code) {
    var salt = randomHex(16);
    return derive(normCode(code), salt, ITER).then(function (h) {
      POS.settings().adminRecovery = { salt: salt, hash: h, iter: ITER, at: new Date().toISOString() };
    });
  }

  // ---------- ログインの状態（この端末・このアプリを開いている間） ----------
  function timeoutMin() { var v = Number(localStorage.getItem(TIMEOUT_KEY)); return v > 0 ? v : 15; }
  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function isAdmin() {
    var s = session();
    if (!s) return false;
    if (!admins().some(function (a) { return a.id === s.id; })) return false; // 削除されたID
    if (Date.now() - s.last > timeoutMin() * 60000) { logout(true); return false; }
    return true;
  }
  function touch() {
    var s = session();
    if (!s) return;
    s.last = Date.now();
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
  }
  function startSession(id) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: id, at: Date.now(), last: Date.now() })); } catch (e) { /* noop */ }
  }
  function logout(auto) {
    var s = session();
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
    if (s) POS.log('admin-logout', s.id + (auto ? '（一定時間操作がなかったため）' : ''));
  }
  ['pointerdown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (session()) touch(); }, true);
  });
  // 一定時間操作がなければ、管理画面を閉じる
  setInterval(function () {
    var s = session();
    if (!s) return;
    if (Date.now() - s.last > timeoutMin() * 60000) {
      logout(true);
      if (inAdminView()) POS.showView('admin');
    }
  }, 20000);

  // ---------- 失敗の回数（5回続けて間違えたら、しばらく待つ） ----------
  function fails() { try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } }
  function setFails(f) { try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); } catch (e) { /* noop */ } }
  function lockedFor() { var f = fails(); return Math.max(0, f.until - Date.now()); }
  function addFail() {
    var f = fails();
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + Math.min(30, Math.pow(2, f.n - 5)) * 60000; } // 1分・2分・4分…（最大30分）
    setFails(f);
  }

  // ---------- 画面の切り替えの見張り ----------
  function inAdminView() {
    var v = document.querySelector('.view.active');
    return v && ADMIN_VIEWS.indexOf(v.id.replace('view-', '')) >= 0;
  }
  POS.adminViews = ADMIN_VIEWS;
  POS.isAdmin = isAdmin;
  POS.guardView = function (name) {
    if (ADMIN_VIEWS.indexOf(name) < 0) { $('adminNav').hidden = true; return name; }
    if (!isAdmin()) { $('adminNav').hidden = true; return 'admin'; }
    if (name === 'products' || name === 'settings') adminTab = name;
    else if (name === 'admin' && (adminTab === 'products' || adminTab === 'settings')) adminTab = 'dash';
    drawNav();
    return name;
  };
  POS.openAdmin = function (tab) {
    if (tab) adminTab = tab;
    POS.showView(tab === 'products' || tab === 'settings' ? tab : 'admin');
  };
  // 分析・ダッシュボードの再描画（管理画面の中では管理画面を描き直す）
  var origRender = POS.renderSalesTab;
  POS.renderSalesTab = function () {
    var v = document.querySelector('.view.active');
    if (v && v.id === 'view-admin') renderAdmin(); else origRender();
  };

  function drawNav() {
    var s = session();
    var nav = $('adminNav');
    nav.hidden = false;
    nav.innerHTML = '<div class="admin-nav-inner">' + TABS.map(function (t) {
      return '<button class="btn small' + (adminTab === t[0] ? ' on' : '') + '" data-at="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '<span class="spacer"></span><span class="admin-who">管理者：' + esc(s ? s.id : '') + '</span>' +
      '<button class="btn small" data-at="logout">ログアウト</button></div>';
  }
  $('adminNav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-at]');
    if (!b) return;
    if (b.dataset.at === 'logout') {
      logout(false);
      $('adminNav').hidden = true;
      POS.showView('register');
      POS.toast('管理画面からログアウトしました');
      return;
    }
    POS.openAdmin(b.dataset.at);
  });

  // ---------- 管理画面 ----------
  POS.views.admin = function () { renderAdmin(); };
  function renderAdmin() {
    var root = $('adminRoot');
    if (!isAdmin()) {
      $('adminNav').hidden = true;
      root.innerHTML = admins().length ? loginHtml() : registerHtml();
      bindAuth(root);
      return;
    }
    drawNav();
    root.innerHTML = '<div id="adminPane"></div>';
    var pane = $('adminPane');
    if (POS.salesTabs[adminTab]) POS.salesTabs[adminTab](pane);
  }

  function loginHtml() {
    var wait = lockedFor();
    return '<div class="auth-box"><h2>🔒 管理画面にログイン</h2>' +
      '<p class="note">売上・利益のダッシュボード、商品と価格、設定などは、管理者のID・パスワードが必要です。</p>' +
      '<form class="form" id="authForm" autocomplete="on">' +
      '<label>管理者ID<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label>パスワード<input name="pw" type="password" autocomplete="current-password" required></label>' +
      '<p class="auth-msg" id="authMsg">' + (wait ? '何度も間違えたため、' + Math.ceil(wait / 60000) + '分ほど待ってからやり直してください。' : '') + '</p>' +
      '<button class="btn primary" type="submit">ログイン</button></form>' +
      '<p class="note"><button class="linkish" type="button" data-auth="forgot">パスワードを忘れたとき</button></p></div>';
  }
  function registerHtml() {
    return '<div class="auth-box"><h2>🔒 管理者の登録</h2>' +
      '<p class="note">はじめに、管理画面に入るための管理者IDとパスワードを決めてください（店主の方が登録してください）。' +
      'クラウド同期を使っている場合は、全端末で同じID・パスワードになります。</p>' +
      '<p class="note">※ ほかの端末ですでに管理者を登録していて、この端末をあとからクラウド同期につなぐ場合も、ここで仮の管理者を登録してください。' +
      'クラウドにつなぐと、お店の管理者のID・パスワードに切り替わります。</p>' +
      '<form class="form" id="regForm" autocomplete="on">' +
      '<label>管理者ID（半角英数字 3文字以上）<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_.\\-@]{3,}" required></label>' +
      '<label>パスワード（8文字以上）<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<label>パスワード（確認）<input name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>' +
      '<p class="auth-msg" id="authMsg"></p>' +
      '<button class="btn primary" type="submit">登録する</button></form></div>';
  }
  function msg(t) { var m = $('authMsg'); if (m) m.textContent = t; }

  function bindAuth(root) {
    if (!cryptoOk()) {
      msg('この接続ではパスワードの機能が使えません。https:// で始まるアドレス（GitHub Pages など）で開いてください。');
      return;
    }
    var lf = $('authForm');
    if (lf) lf.addEventListener('submit', function (e) {
      e.preventDefault();
      var wait = lockedFor();
      if (wait) { msg('何度も間違えたため、' + Math.ceil(wait / 60000) + '分ほど待ってからやり直してください。'); return; }
      var id = normId(lf.elements.id.value), pw = lf.elements.pw.value;
      var acc = admins().find(function (a) { return a.id === id; });
      msg('確認しています…');
      // IDが違うときも同じだけ時間をかける
      (acc ? checkPassword(acc, pw) : derive(pw, 'dummy-salt', ITER).then(function () { return false; })).then(function (ok) {
        if (!ok) {
          addFail();
          POS.log('admin-fail', 'ID「' + id + '」でログインに失敗');
          msg('IDかパスワードが違います。');
          lf.elements.pw.value = '';
          lf.elements.pw.focus();
          return;
        }
        setFails({ n: 0, until: 0 });
        startSession(id);
        POS.log('admin-login', id);
        POS.openAdmin(adminTab);
      });
    });
    var rf = $('regForm');
    if (rf) rf.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = normId(rf.elements.id.value), pw = rf.elements.pw.value;
      if (!/^[a-z0-9_.\-@]{3,}$/.test(id)) { msg('管理者IDは半角英数字で3文字以上にしてください。'); return; }
      if (pw.length < 8) { msg('パスワードは8文字以上にしてください。'); return; }
      if (pw !== rf.elements.pw2.value) { msg('確認のパスワードが一致しません。'); return; }
      if (admins().length) { renderAdmin(); return; } // 別の端末で先に登録された
      msg('登録しています…');
      var code = newRecoveryCode();
      makeAccount(id, pw).then(function (acc) {
        POS.settings().admins = [acc];
        // まだクラウドにつないでいない端末：あとでつないだとき、お店の管理者がいればそちらを使う
        if (!(window.Sync && Sync.config().enabled)) POS.settings().adminsLocal = true; else delete POS.settings().adminsLocal;
        return saveRecovery(code);
      }).then(function () {
        POS.saveSettings();
        POS.log('admin-register', id);
        startSession(id);
        showRecovery(code, true);
      });
    });
    root.querySelectorAll('[data-auth="forgot"]').forEach(function (b) { b.addEventListener('click', openForgot); });
  }

  /** 回復用コードを見せる（このときだけ表示） */
  function showRecovery(code, first) {
    POS.openModal('<h3>回復用コード（大切に保管）</h3>' +
      '<p>パスワードを忘れたときに、このコードで新しいパスワードを設定できます。<b>この画面にしか表示されません。</b>紙に書くか、印刷して、レジから離れた安全な場所に保管してください。</p>' +
      '<div class="recovery-code">' + esc(code) + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="print">印刷</button><button class="btn primary" data-act="ok">保管しました</button></div>',
    function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'print') POS.printHtml('<div class="c title">NIKUPOS 管理画面</div><div class="c">回復用コード</div><hr><div class="c big">' + esc(code) + '</div><hr>' +
        '<div>パスワードを忘れたときに使います。安全な場所に保管してください。</div><div>' + POS.dateTimeStr(new Date()) + '</div>');
      if (b.dataset.act === 'ok') { POS.closeModal(); if (first) POS.openAdmin('dash'); else renderAdminSettings(); }
    }, false);
  }

  function openForgot() {
    var rec = POS.settings().adminRecovery;
    if (!rec) { alert('回復用コードが設定されていません。'); return; }
    POS.openModal('<h3>パスワードを忘れたとき</h3><div class="sub">管理者を登録したときに表示された「回復用コード」を入れると、新しいパスワードを設定できます。</div>' +
      '<form class="form" id="fgForm" onsubmit="return false"><label>回復用コード<input name="code" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX"></label>' +
      '<label>管理者ID<input name="id" autocomplete="username" autocapitalize="none" value="' + esc(admins()[0] ? admins()[0].id : '') + '"></label>' +
      '<label>新しいパスワード（8文字以上）<input name="pw" type="password" autocomplete="new-password"></label>' +
      '<label>新しいパスワード（確認）<input name="pw2" type="password" autocomplete="new-password"></label>' +
      '<p class="auth-msg" id="fgMsg"></p></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="ok">パスワードを設定</button></div>',
    function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'cancel') { POS.closeModal(); return; }
      if (b.dataset.act !== 'ok') return;
      var f = $('fgForm').elements;
      var m = function (t) { $('fgMsg').textContent = t; };
      var wait = lockedFor();
      if (wait) { m('何度も間違えたため、' + Math.ceil(wait / 60000) + '分ほど待ってからやり直してください。'); return; }
      var id = normId(f.id.value);
      var acc = admins().find(function (a) { return a.id === id; });
      if (!acc) { m('その管理者IDはありません。'); return; }
      if (f.pw.value.length < 8) { m('パスワードは8文字以上にしてください。'); return; }
      if (f.pw.value !== f.pw2.value) { m('確認のパスワードが一致しません。'); return; }
      m('確認しています…');
      derive(normCode(f.code.value), rec.salt, rec.iter || ITER).then(function (h) {
        if (!same(h, rec.hash)) { addFail(); POS.log('admin-fail', '回復用コードが違う'); m('回復用コードが違います。'); return; }
        setFails({ n: 0, until: 0 });
        var code = newRecoveryCode(); // 使ったコードは無効にして、新しいコードを出す
        return makeAccount(id, f.pw.value).then(function (na) {
          POS.settings().admins = admins().map(function (a) { return a.id === id ? na : a; });
          return saveRecovery(code);
        }).then(function () {
          POS.saveSettings();
          POS.log('admin-reset', id + ' のパスワードを回復用コードで再設定');
          startSession(id);
          showRecovery(code, true);
        });
      });
    }, false);
  }

  // ---------- 設定画面：管理者の管理 ----------
  function renderAdminSettings() {
    var box = $('adminSettings');
    if (!box) return;
    if (!isAdmin()) { box.innerHTML = ''; return; }
    var me = session().id;
    box.innerHTML = '<div class="sync-box">' +
      admins().map(function (a) {
        return '<div class="plist-item"><div class="info"><div class="n">' + esc(a.id) + (a.id === me ? '（ログイン中）' : '') + '</div></div>' +
          '<button class="btn small" data-ad="pw" data-id="' + esc(a.id) + '">パスワード変更</button>' +
          (admins().length > 1 && a.id !== me ? '<button class="btn small danger-outline" data-ad="del" data-id="' + esc(a.id) + '">削除</button>' : '') + '</div>';
      }).join('') +
      '<div class="btn-row"><button class="btn small" data-ad="add">＋ 管理者を追加</button><button class="btn small" data-ad="code">回復用コードを作り直す</button></div>' +
      '<label class="form" style="margin-top:8px">操作がないときに自動でログアウトするまで（分・この端末）<input type="number" inputmode="numeric" min="1" max="480" id="adminTimeout" value="' + timeoutMin() + '" style="max-width:160px"></label>' +
      '<p class="note">管理者のID・パスワードは、クラウド同期を使っている全端末で共通です。この画面は ' + timeoutMin() + '分 操作がないと自動でログアウトします。</p></div>';
  }
  $('adminSettings').addEventListener('change', function (e) {
    if (e.target.id !== 'adminTimeout') return;
    var v = Math.max(1, Math.min(480, Math.floor(Number(e.target.value) || 15)));
    localStorage.setItem(TIMEOUT_KEY, String(v));
    POS.toast('自動ログアウトを ' + v + '分 にしました');
    renderAdminSettings();
  });
  $('adminSettings').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ad]');
    if (!b || !isAdmin()) return;
    var act = b.dataset.ad;
    if (act === 'code') {
      if (!confirm('新しい回復用コードを作ります。今までのコードは使えなくなります。よろしいですか？')) return;
      var code = newRecoveryCode();
      saveRecovery(code).then(function () { POS.saveSettings(); POS.log('admin-code', '回復用コードを作り直し'); showRecovery(code, false); });
      return;
    }
    if (act === 'del') {
      var id = b.dataset.id;
      if (!confirm('管理者「' + id + '」を削除しますか？')) return;
      POS.settings().admins = admins().filter(function (a) { return a.id !== id; });
      POS.saveSettings();
      POS.log('admin-delete', id);
      renderAdminSettings();
      return;
    }
    openAccountModal(act === 'add' ? null : b.dataset.id);
  });
  function openAccountModal(id) {
    var isNew = !id;
    POS.openModal('<h3>' + (isNew ? '管理者を追加' : 'パスワードの変更（' + esc(id) + '）') + '</h3>' +
      '<form class="form" id="acForm" onsubmit="return false">' +
      (isNew ? '<label>管理者ID（半角英数字 3文字以上）<input name="id" autocomplete="off" autocapitalize="none"></label>'
        : '<label>今のパスワード（' + esc(session().id) + '）<input name="cur" type="password" autocomplete="current-password"></label>') +
      '<label>' + (isNew ? '' : '新しい') + 'パスワード（8文字以上）<input name="pw" type="password" autocomplete="new-password"></label>' +
      '<label>確認<input name="pw2" type="password" autocomplete="new-password"></label><p class="auth-msg" id="acMsg"></p></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="ok">保存</button></div>',
    function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'cancel') { POS.closeModal(); return; }
      if (b.dataset.act !== 'ok') return;
      var f = $('acForm').elements;
      var m = function (t) { $('acMsg').textContent = t; };
      var nid = isNew ? normId(f.id.value) : id;
      if (isNew && !/^[a-z0-9_.\-@]{3,}$/.test(nid)) { m('管理者IDは半角英数字で3文字以上にしてください。'); return; }
      if (isNew && admins().some(function (a) { return a.id === nid; })) { m('そのIDはもう使われています。'); return; }
      if (f.pw.value.length < 8) { m('パスワードは8文字以上にしてください。'); return; }
      if (f.pw.value !== f.pw2.value) { m('確認のパスワードが一致しません。'); return; }
      m('保存しています…');
      var check = isNew ? Promise.resolve(true) : checkPassword(admins().find(function (a) { return a.id === session().id; }), f.cur.value);
      check.then(function (ok) {
        if (!ok) { m('今のパスワードが違います。'); return; }
        return makeAccount(nid, f.pw.value).then(function (acc) {
          var list = admins().filter(function (a) { return a.id !== nid; });
          list.push(acc);
          POS.settings().admins = list;
          POS.saveSettings();
          POS.log(isNew ? 'admin-add' : 'admin-password', nid);
          POS.closeModal();
          renderAdminSettings();
          POS.toast(isNew ? '管理者を追加しました' : 'パスワードを変更しました');
        });
      });
    });
  }
  var origSettingsView = POS.views.settings;
  POS.views.settings = function () { if (origSettingsView) origSettingsView(); renderAdminSettings(); };

  // 開発・テスト用（ブラウザの開発者ツールから）
  window.NikuposAdmin = {
    register: function (id, pw) {
      if (admins().length) return Promise.reject(new Error('管理者はすでに登録されています'));
      var code = newRecoveryCode();
      return makeAccount(id, pw).then(function (acc) { POS.settings().admins = [acc]; return saveRecovery(code); })
        .then(function () { POS.saveSettings(); return code; });
    },
    login: function (id, pw) {
      var acc = admins().find(function (a) { return a.id === normId(id); });
      return (acc ? checkPassword(acc, pw) : Promise.resolve(false)).then(function (ok) { if (ok) startSession(acc.id); return ok; });
    },
    logout: function () { logout(false); },
    isAdmin: isAdmin
  };
});
