/*
 * 担当者ログイン・権限・操作ログ
 *  - 担当者（店主／従業員）と暗証番号を登録すると、起動時と切り替え時に担当者を選ぶ。登録しなければ従来どおり誰でも使える
 *  - 取消・返品・値引きなど、店主の承認が必要な操作は、従業員が操作すると店主の暗証番号を求める（どれを必要にするかは店主が選ぶ）
 *  - 誰が・いつ・何をしたか（承認者を含む）を操作ログに残す。売上には担当者名を記録
 * 暗証番号は端末に平文では保存しない（簡易的な変換をした値を保存）。
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc;

  var ACTIONS = [
    ['void', '取引の取消'], ['return', '返品・返金'], ['discount', '手動の値引き'], ['cashmove', '入出金'],
    ['closing', 'レジの精算'], ['drawer', '会計なしで引き出しを開ける'], ['products', '商品・価格の変更'], ['settings', '設定・セールの変更・データ管理']
  ];
  var DEFAULT_PERMS = { 'void': true, 'return': true, discount: true, cashmove: false, closing: false, drawer: false, products: true, settings: true };
  var CUR_KEY = 'nikupos.currentStaff';
  var LOCK_KEY = 'nikupos.autoLockMin';

  function staffList() { return POS.settings().staff || []; }
  function perms() { var p = POS.settings().permissions; return p || DEFAULT_PERMS; }
  function enabled() { return staffList().length > 0; }
  function hashPin(pin) {
    // FNV-1a（暗証番号をそのまま保存しないための簡易な変換）
    var h = 0x811c9dc5;
    var str = 'nikupos:' + pin;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }
  function current() {
    if (!enabled()) return null;
    var id = localStorage.getItem(CUR_KEY);
    return staffList().find(function (s) { return s.id === id; }) || null;
  }
  function setCurrent(s) {
    if (s) localStorage.setItem(CUR_KEY, s.id); else localStorage.removeItem(CUR_KEY);
    drawChip();
  }

  // ---------- 操作ログ ----------
  POS.log = function (action, detail, extra) {
    var now = new Date();
    var c = current();
    Store.addLog(Object.assign({
      id: Store.newId('G'), at: now.toISOString(), date: POS.localDate(now), dev: POS.myDev(),
      staff: c ? c.name : '', action: action, detail: detail || ''
    }, extra || {}));
  };
  POS.currentStaff = current;

  // ---------- 権限 ----------
  POS.requirePerm = function (action, label) {
    if (!enabled()) return Promise.resolve(true);
    var c = current();
    if (c && c.role === 'owner') return Promise.resolve(true);
    if (action !== 'staffAdmin' && !perms()[action]) return Promise.resolve(true);
    return askPin('店主の承認が必要です', label || '', staffList().filter(function (s) { return s.role === 'owner'; })).then(function (owner) {
      if (!owner) return false;
      POS.log('approve', (label || action) + ' を承認', { approvedBy: owner.name });
      return true;
    });
  };

  /** 担当者を選んで暗証番号を入れる。成功したらその担当者で resolve（キャンセルは null） */
  function askPin(title, sub, candidates, closeable) {
    return new Promise(function (resolve) {
      var who = candidates.length === 1 ? candidates[0] : null;
      var pin = '';
      POS.openModal(
        '<h3>' + esc(title) + '</h3><div class="sub">' + esc(sub) + '</div>' +
        '<div class="seg" id="pinWho" style="margin:6px 0">' + candidates.map(function (s) {
          return '<button type="button" class="btn" data-who="' + s.id + '">' + esc(s.name) + (s.role === 'owner' ? '（店主）' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="display"><span class="label">暗証番号</span><span class="value" id="pinDots"></span></div>' +
        '<p class="note" id="pinMsg"></p>' + POS.keypadHtml() +
        '<div class="modal-foot">' + (closeable === false ? '<span></span>' : '<button class="btn" data-act="cancel">キャンセル</button>') +
        '<button class="btn primary" id="mOk" data-act="ok">OK</button></div>',
        function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.who) { who = candidates.find(function (s) { return s.id === b.dataset.who; }); pin = ''; draw(); }
          else if (b.dataset.key) { pin = POS.applyKey(pin, b.dataset.key, 8); draw(); }
          else if (b.dataset.act === 'cancel') { POS.closeModal(); resolve(null); }
          else if (b.dataset.act === 'ok') {
            if (!who) { $('pinMsg').textContent = '名前を選んでください'; return; }
            if (hashPin(pin) !== who.pinHash) { pin = ''; draw(); $('pinMsg').textContent = '暗証番号が違います'; return; }
            POS.closeModal();
            resolve(who);
          }
        },
        closeable !== false
      );
      function draw() {
        $('pinDots').textContent = pin.replace(/./g, '●') || '　';
        $('pinMsg').textContent = '';
        POS.modalBody.querySelectorAll('[data-who]').forEach(function (x) { x.classList.toggle('on', who && x.dataset.who === who.id); });
      }
      draw();
    });
  }

  // ---------- ログイン・切り替え ----------
  function login() {
    if (!enabled()) return;
    askPin('担当者を選んでください', 'レジを使う人の名前を選び、暗証番号を入れてください。', staffList(), false).then(function (s) {
      if (!s) return;
      setCurrent(s);
      POS.log('login', s.name + ' が担当');
      POS.toast(s.name + ' さんでログインしました');
    });
  }
  function drawChip() {
    var chip = $('staffChip');
    if (!chip) return;
    var c = current();
    chip.hidden = !enabled();
    chip.textContent = c ? c.name : 'ログイン';
  }
  $('staffChip').addEventListener('click', function () {
    var c = current();
    if (c) POS.log('logout', c.name + ' が担当を終了');
    setCurrent(null);
    login();
  });

  // 一定時間操作がなければ担当者の選択に戻る（この端末の設定）
  var lastActive = Date.now();
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { lastActive = Date.now(); }, true); });
  setInterval(function () {
    var min = Number(localStorage.getItem(LOCK_KEY) || 0);
    if (!min || !enabled() || !current()) return;
    if (Date.now() - lastActive > min * 60000 && POS.modalBody.innerHTML === '') {
      POS.log('logout', current().name + '（自動ロック）');
      setCurrent(null);
      login();
    }
  }, 30000);

  // ---------- 設定画面：担当者と権限 ----------
  function renderStaffSettings() {
    var box = $('staffSettings');
    if (!box) return;
    var list = staffList();
    var p = perms();
    box.innerHTML = '<div class="sync-box">' +
      '<p class="note">担当者を登録すると、レジを使う人を選んでから操作するようになり、売上と操作ログに名前が残ります。' +
      '登録しなければ、今までどおり誰でも使えます。最初の1人は店主として登録してください。</p>' +
      (list.length ? list.map(function (s) {
        return '<div class="plist-item"><div class="info"><div class="n">' + esc(s.name) + '</div><div class="d">' + (s.role === 'owner' ? '店主' : '従業員') + '</div></div>' +
          '<button class="btn" data-st="edit" data-id="' + s.id + '">編集</button></div>';
      }).join('') : '') +
      '<div class="btn-row"><button class="btn primary small" data-st="new">＋ 担当者を追加</button></div>' +
      (list.length ? '<h3 style="margin:12px 0 4px;font-size:16px">店主の承認が必要な操作（従業員が操作するとき）</h3><div class="form" style="gap:4px">' +
        ACTIONS.map(function (a) {
          return '<label class="check"><input type="checkbox" data-perm="' + a[0] + '"' + (p[a[0]] ? ' checked' : '') + '> ' + a[1] + '</label>';
        }).join('') + '</div>' +
        '<label class="form" style="margin-top:8px">自動ロック（分・この端末。0なら使わない）<input type="number" inputmode="numeric" min="0" id="autoLock" value="' + (localStorage.getItem(LOCK_KEY) || 0) + '" style="max-width:160px"></label>' +
        '<div class="btn-row"><button class="btn small" data-st="perms">権限と自動ロックを保存</button></div>' : '') +
      '</div>';
  }
  var prevSettings = POS.views.settings;
  POS.views.settings = function () { if (prevSettings) prevSettings(); renderStaffSettings(); };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#staffSettings [data-st]');
    if (!b) return;
    var act = b.dataset.st;
    // 担当者の管理は店主だけ（まだ誰もいなければ誰でも最初の店主を登録できる）
    POS.requirePerm('staffAdmin', '担当者の管理').then(function (ok) {
      if (!ok) return;
      if (act === 'new') openStaffModal(null);
      if (act === 'edit') openStaffModal(staffList().find(function (s) { return s.id === b.dataset.id; }));
      if (act === 'perms') {
        var np = {};
        document.querySelectorAll('#staffSettings [data-perm]').forEach(function (x) { np[x.dataset.perm] = x.checked; });
        POS.settings().permissions = np;
        POS.saveSettings();
        localStorage.setItem(LOCK_KEY, String(Math.max(0, Math.floor(Number($('autoLock').value) || 0))));
        POS.log('settings', '権限の設定を変更');
        POS.toast('保存しました');
      }
    });
  });

  function openStaffModal(orig) {
    var list = staffList();
    var isNew = !orig;
    var s = orig ? JSON.parse(JSON.stringify(orig)) : { name: '', role: list.length ? 'staff' : 'owner' };
    POS.openModal(
      '<h3>' + (isNew ? '担当者を追加' : '担当者の編集') + '</h3>' +
      '<form class="form" id="stForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>名前<input name="name" value="' + esc(s.name) + '" autocomplete="off"></label>' +
      '<label>役割<div class="seg"><button type="button" class="btn small" data-role="owner">店主（すべての操作ができる）</button>' +
      '<button type="button" class="btn small" data-role="staff">従業員</button></div></label>' +
      '<label>暗証番号（4〜8桁の数字）' + (isNew ? '' : '・変えないときは空欄') + '<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew ? '<button class="btn" data-act="cancel">キャンセル</button>' : '<button class="btn danger-outline" data-act="del">削除</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.role) { s.role = b.dataset.role; draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'del') {
          var owners = list.filter(function (x) { return x.role === 'owner' && x.id !== s.id; });
          if (orig.role === 'owner' && !owners.length && list.length > 1) { alert('店主が1人もいなくなります。先にほかの人を店主にしてください。'); return; }
          if (!confirm(s.name + ' さんを削除しますか？')) return;
          POS.settings().staff = list.filter(function (x) { return x.id !== s.id; });
          POS.saveSettings();
          POS.log('settings', '担当者を削除：' + s.name);
          if (current() === null) setCurrent(null);
          POS.closeModal();
          renderStaffSettings();
          drawChip();
        } else if (b.dataset.act === 'save') {
          var f = $('stForm').elements;
          s.name = f.name.value.trim();
          var pin = f.pin.value.trim();
          if (!s.name) { alert('名前を入れてください'); return; }
          if ((isNew || pin) && !/^\d{4,8}$/.test(pin)) { alert('暗証番号は4〜8桁の数字にしてください'); return; }
          if (pin) s.pinHash = hashPin(pin);
          var others = list.filter(function (x) { return x.id !== s.id; });
          if (s.role !== 'owner' && !others.some(function (x) { return x.role === 'owner'; })) { alert('店主が1人もいなくなります。少なくとも1人は店主にしてください。'); return; }
          if (isNew) { s.id = Store.newId('U'); list.push(s); } else list[list.findIndex(function (x) { return x.id === s.id; })] = s;
          POS.settings().staff = list;
          if (!POS.settings().permissions) POS.settings().permissions = DEFAULT_PERMS;
          POS.saveSettings();
          POS.log('settings', (isNew ? '担当者を追加：' : '担当者を変更：') + s.name + '（' + (s.role === 'owner' ? '店主' : '従業員') + '）');
          if (isNew && list.length === 1) setCurrent(s); // 最初の店主はそのままログイン
          POS.closeModal();
          renderStaffSettings();
          drawChip();
          POS.toast('保存しました');
        }
      },
      false
    );
    function draw() { POS.modalBody.querySelectorAll('[data-role]').forEach(function (x) { x.classList.toggle('on', x.dataset.role === s.role); }); }
    draw();
  }

  // ---------- 操作ログ（売上タブ） ----------
  var LABEL = {
    login: 'ログイン', logout: 'ログアウト', approve: '承認', 'void': '取消', 'return': '返品', discount: '値引き', cashmove: '入出金',
    'cashmove-delete': '入出金の削除', closing: '精算', settings: '設定', receipt: '領収書', product: '商品', order: '発注'
  };
  var logDate = POS.localDate(new Date());
  POS.salesTabs.log = function (box) {
    var list = Store.getLogs().filter(function (l) { return l.date === logDate; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    box.innerHTML = '<div class="toolbar"><input type="date" id="logDate" value="' + logDate + '"><span class="note">全端末の操作</span></div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>時刻</th><th>端末</th><th>担当</th><th>操作</th><th>内容</th><th>承認</th></tr></thead><tbody>' +
        list.map(function (l) {
          return '<tr><td>' + POS.timeStr(new Date(l.at)) + '</td><td>' + esc(l.dev || '') + '</td><td>' + esc(l.staff || '') + '</td>' +
            '<td>' + esc(LABEL[l.action] || l.action) + '</td><td style="white-space:normal">' + esc(l.detail) + '</td><td>' + esc(l.approvedBy || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="note">この日の操作の記録はありません。</p>') +
      '<p class="note">取消・返品・値引き・入出金・精算・設定の変更・ログイン・承認などを記録します（会計そのものは売上の取引一覧で確認できます）。</p>';
    $('logDate').onchange = function () { logDate = this.value || POS.localDate(new Date()); POS.renderSalesTab(); };
  };

  // 起動時
  drawChip();
  if (enabled() && !current()) setTimeout(login, 300);
});
