/*
 * NIKUPOS 画面ロジック
 */
Store.init().then(function () {
  'use strict';

  // ================= 状態 =================
  var products = Store.getProducts();
  var settings = Store.getSettings();
  var cart = Store.getCart() || { lines: [], discount: null };
  var currentCat = null;
  var salesDate = localDate(new Date());
  var lineSeq = Date.now();

  var COLORS = ['#e8846b', '#f1a98f', '#f4c1ad', '#c96a5a', '#a8564a', '#d9a441', '#b8743a', '#e9d27a', '#7fb07a', '#6fa8c9', '#8fa3b8', '#9aa3ab', '#7f8c8d'];
  var UNIT_LABEL = { g: '100gあたり', pc: '1個あたり', open: '金額入力' };

  // ================= ユーティリティ =================
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function yen(n) { n = Number(n || 0); return (n < 0 ? '-¥' : '¥') + Math.abs(n).toLocaleString('ja-JP'); }
  function num(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeStr(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dateTimeStr(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr(d);
  }
  function round() { return settings.rounding; }
  function qtyLabel(l) {
    if (l.unit === 'g') return num(l.qty) + 'g';
    if (l.unit === 'open') return '';
    return '×' + l.qty;
  }
  function priceLabel(p) {
    if (p.unit === 'g') return yen(p.price) + '/100g';
    if (p.unit === 'open') return '金額入力';
    return yen(p.price);
  }
  function discLabel(d) {
    if (!d || !d.value) return '';
    if (d.type === 'pct') return d.value === 50 ? '半額' : d.value + '%引';
    return yen(d.value) + '引';
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2000);
  }
  function vibrate() { if (navigator.vibrate) navigator.vibrate(15); }
  function isNarrow() { return window.matchMedia('(max-width: 759px)').matches; }

  // ================= 画面切り替え =================
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    showView(btn.dataset.view);
  });

  function showView(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    if (name === 'register') renderRegister();
    if (name === 'reservations') renderReservations();
    if (name === 'sales') renderSales();
    if (name === 'products') renderProductList();
    if (name === 'settings') renderSettings();
    if (POS.views[name]) POS.views[name]();
    refreshBadges();
  }

  function tick() {
    var d = new Date();
    $('clock').textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + timeStr(d);
  }

  // ================= モーダル =================
  var modal = $('modal');
  var modalBody = $('modalBody');
  var modalCloseable = true;
  // key: キー入力を横取りする関数（trueを返すと処理済み） / cleanup: 閉じるときの後片付け
  var modalHooks = { key: null, cleanup: null };

  function openModal(html, onClick, closeable) {
    runModalCleanup();
    modalHooks = { key: null, cleanup: null };
    modalBody.innerHTML = html;
    modalBody.onclick = onClick || null;
    modalBody.oninput = null;
    modalBody.onchange = null;
    modalCloseable = closeable !== false;
    $('toast').hidden = true;
    modal.hidden = false;
  }
  function runModalCleanup() {
    if (modalHooks.cleanup) { try { modalHooks.cleanup(); } catch (e) { /* noop */ } }
    modalHooks.cleanup = null;
  }
  function closeModal() {
    runModalCleanup();
    modalHooks.key = null;
    modal.hidden = true;
    modalBody.innerHTML = '';
    modalBody.onclick = null;
    modalBody.oninput = null;
    modalBody.onchange = null;
  }

  // 外付けキーボード・キーボード型はかりでの入力（数字・Backspace・Enter・Esc）
  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (modalHooks.key && modalHooks.key(e) === true) { e.preventDefault(); return; }
    var btn = null;
    if (/^[0-9]$/.test(e.key)) btn = modalBody.querySelector('[data-key="' + e.key + '"]');
    else if (e.key === 'Backspace') btn = modalBody.querySelector('[data-key="BS"]');
    else if (e.key === 'Enter') btn = modalBody.querySelector('#mOk:not(:disabled), [data-act="next"]');
    else if (e.key === 'Escape' && modalCloseable) { e.preventDefault(); closeModal(); return; }
    if (btn) { e.preventDefault(); btn.click(); }
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal && modalCloseable) closeModal();
  });

  function keypadHtml() {
    var keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'BS'];
    return '<div class="keypad">' + keys.map(function (k) {
      var label = k === 'BS' ? '⌫' : k;
      return '<button type="button" data-key="' + k + '"' + (k === 'BS' ? ' class="fn"' : '') + '>' + label + '</button>';
    }).join('') + '</div>';
  }

  /** キー入力を数値文字列に適用 */
  function applyKey(val, key, maxLen) {
    if (key === 'BS') return val.slice(0, -1);
    if (key === 'C') return '';
    var next = (val === '0' ? '' : val) + key;
    next = next.replace(/^0+(?=\d)/, '');
    if (next.length > (maxLen || 7)) return val;
    return next;
  }

  // ================= レジ画面 =================
  function categories() {
    var cats = settings.categories.slice();
    products.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    return cats;
  }

  function renderRegister() {
    var cats = categories();
    if (currentCat !== '__all' && cats.indexOf(currentCat) < 0) currentCat = '__all';
    var tabs = [['__all', 'すべて']].concat(cats.map(function (c) { return [c, c]; }));
    $('catTabs').innerHTML = tabs.map(function (t) {
      return '<button class="btn' + (t[0] === currentCat ? ' on' : '') + '" data-cat="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('');
    renderGrid();
    renderCart();
  }

  function renderGrid() {
    var list = products
      .filter(function (p) { return currentCat === '__all' || p.category === currentCat; })
      .sort(function (a, b) { return a.order - b.order; });
    var counts = {};
    cart.lines.forEach(function (l) {
      counts[l.productId] = (counts[l.productId] || 0) + (l.unit === 'pc' ? l.qty : 1);
    });
    $('productGrid').innerHTML = list.length ? list.map(function (p) {
      var badge = counts[p.id] ? '<span class="p-badge">' + counts[p.id] + '</span>' : '';
      return '<button class="product" data-id="' + p.id + '" style="--c:' + esc(p.color) + '">' +
        badge + '<span class="p-name">' + esc(p.name) + '</span>' +
        '<span class="p-price">' + priceLabel(p) + (p.taxRate === 10 ? '（10%）' : '') + '</span></button>';
    }).join('') : '<p class="note">商品がありません。「商品」タブから登録してください。</p>';
  }

  $('catTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]');
    if (!b) return;
    currentCat = b.dataset.cat;
    renderRegister();
  });

  $('productGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.product');
    if (!b) return;
    var p = products.find(function (x) { return x.id === b.dataset.id; });
    if (!p) return;
    vibrate();
    if (p.unit === 'pc') {
      var same = cart.lines.find(function (l) { return l.productId === p.id && !l.discount && l.price === p.price; });
      if (same) same.qty += 1;
      else cart.lines.push(newLine(p, 1));
      saveCart();
      toast(p.name + ' を追加');
    } else if (p.unit === 'g') {
      openQtyModal(p, null);
    } else {
      openOpenPriceModal(p, null);
    }
  });

  function newLine(p, qty, price) {
    return {
      key: 'L' + (lineSeq++),
      productId: p.id,
      name: p.name,
      unit: p.unit === 'open' ? 'open' : p.unit,
      price: price != null ? price : p.price,
      qty: qty,
      taxRate: p.taxRate,
      discount: null
    };
  }

  function saveCart() {
    Store.saveCart(cart);
    renderGrid();
    renderCart();
  }

  function renderCart() {
    var t = Calc.totals(cart.lines, cart.discount, round());
    var ul = $('cartLines');
    if (!cart.lines.length) {
      ul.innerHTML = '<li class="empty">商品ボタンをタップして追加</li>';
    } else {
      ul.innerHTML = cart.lines.map(function (l) {
        var detail = l.unit === 'open' ? (l.taxRate === 10 ? '10%' : '') :
          (l.unit === 'g' ? yen(l.price) + '/100g × ' + num(l.qty) + 'g' : yen(l.price) + ' × ' + l.qty);
        if (l.estimated) detail += ' <b style="color:var(--danger)">予定重量・要計量</b>';
        var disc = Calc.lineDiscount(l, round());
        return '<li data-key="' + l.key + '">' +
          '<span class="l-name">' + esc(l.name) + '</span>' +
          '<span class="l-amt num">' + yen(Calc.lineAmount(l, round())) + '</span>' +
          '<span class="l-detail">' + detail + '</span>' +
          '<span class="l-disc">' + (disc ? discLabel(l.discount) + ' -' + num(disc) : '') + '</span>' +
          '</li>';
      }).join('');
    }
    var html = '';
    html += '<div class="sum-row"><span>小計（' + t.count + '点）</span><span class="num">' + yen(t.subtotal) + '</span></div>';
    if (t.discount) html += '<div class="sum-row" style="color:var(--danger)"><span>小計値引 ' + discLabel(cart.discount) + '</span><span class="num">-' + num(t.discount) + '</span></div>';
    t.byRate.forEach(function (r) {
      html += '<div class="sum-row"><span>' + r.rate + '%対象 ' + yen(r.amount) + '</span><span class="num">内税 ' + yen(r.tax) + '</span></div>';
    });
    html += '<div class="sum-row total"><span>合計</span><span class="num">' + yen(t.total) + '</span></div>';
    var dep = cart.deposit || 0;
    if (dep) {
      html += '<div class="sum-row" style="color:var(--ok)"><span>前受金</span><span class="num">-' + num(dep) + '</span></div>';
      html += '<div class="sum-row total"><span>お支払い残額</span><span class="num">' + yen(Math.max(0, t.total - dep)) + '</span></div>';
    }
    $('cartSum').innerHTML = html;
    $('cartResv').hidden = !cart.reservationId;
    $('cartResv').textContent = cart.reservationId ? '予約No.' + cart.reservationNo + ' ' + cart.customer + ' 様' : '';

    $('miniCount').textContent = t.count + '点' + (dep ? '・前受金あり' : '');
    $('miniTotal').textContent = yen(dep ? Math.max(0, t.total - dep) : t.total);
    var empty = !cart.lines.length;
    $('btnPay').disabled = empty;
    $('btnPayMini').disabled = empty;
    $('btnClearCart').disabled = empty;
    $('btnTxDiscount').disabled = empty;
  }

  $('cartLines').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-key]');
    if (!li) return;
    var line = cart.lines.find(function (l) { return l.key === li.dataset.key; });
    if (!line) return;
    if (line.estimated) openQtyModal({ name: line.name, price: line.price }, line);
    else openLineModal(line);
  });

  $('btnOpenCart').addEventListener('click', function () { $('toast').hidden = true; $('cartPanel').classList.add('open'); });
  $('btnCloseCart').addEventListener('click', function () { $('cartPanel').classList.remove('open'); });
  $('btnClearCart').addEventListener('click', function () {
    if (!confirm(cart.reservationId ? 'レジから予約の読み込みを取り消しますか？（予約自体は残ります）' : 'カートの商品をすべて取り消しますか？')) return;
    cart = { lines: [], discount: null };
    saveCart();
    $('cartPanel').classList.remove('open');
  });
  $('btnPay').addEventListener('click', openPayModal);
  $('btnPayMini').addEventListener('click', openPayModal);
  $('btnTxDiscount').addEventListener('click', openTxDiscountModal);

  // ---------- 重量入力（グラム売り・はかり対応） ----------
  function openQtyModal(p, line) {
    var val = line ? String(line.qty) : '';
    var price = line ? line.price : p.price;
    var mode = settings.scaleMode || 'none';
    var openedAt = Date.now();
    // 手で入力するまでは、はかりの安定した値に自動で追従する
    var follow = mode !== 'none' && (!line || line.estimated);
    var kbBuf = '';
    var fresh = !!line; // 既存の値は最初のキー入力で置き換える

    function readingUsable(st) {
      var r = st.reading;
      if (!r) return false;
      return mode === 'bluetooth' ? st.connected : r.at >= openedAt;
    }
    function draw() {
      var g = Number(val || 0);
      var amt = Calc.lineBase({ unit: 'g', price: price, qty: g }, round());
      $('mG').textContent = num(g) + ' g';
      $('mAmt').textContent = yen(amt);
      $('mOk').disabled = !g;
      drawScale();
    }
    function drawScale() {
      var box = $('mScale');
      if (!box || mode === 'none') return;
      var st = Scale.state;
      var r = st.reading;
      var ok = readingUsable(st);
      var label, value, btn = '';
      if (mode === 'bluetooth' && !st.connected) {
        label = 'はかり（未接続）';
        value = '<span class="s-val unstable">—</span>';
        btn = Scale.bluetoothSupported() ? '<button class="btn small" data-act="connect">はかりに接続</button>'
          : '<span class="note">この端末は非対応</span>';
      } else {
        label = mode === 'bluetooth' ? 'はかり ' + esc(st.deviceName) : 'はかり（送信ボタンで入力）';
        value = ok ? '<span class="s-val' + (r.stable ? '' : ' unstable') + '">' + num(r.grams) + ' g' + (r.stable ? '' : '（計量中）') + '</span>'
          : '<span class="s-val unstable">—</span>';
        if (ok && r.grams > 0) btn = '<button class="btn small" data-act="usescale">この重さを使う</button>';
      }
      box.className = 'scale-box' + (ok ? ' live' : '');
      box.innerHTML = '<div><div class="s-label">' + label + '</div>' + value + '</div>' + btn;
    }
    function onScale(st) {
      var r = st.reading;
      if (follow && readingUsable(st) && r.stable && r.grams > 0) val = String(r.grams);
      if ($('mG')) draw();
    }

    openModal(
      '<h3>' + esc(p.name) + '</h3><div class="sub">' + yen(price) + ' / 100g' +
      (line && line.estimated ? '・<b style="color:var(--danger)">予約時の予定重量です。実際の重さを入力してください</b>' : '') + '</div>' +
      (mode !== 'none' ? '<div class="scale-box" id="mScale"></div>' : '') +
      '<div class="display"><span class="label">重さ</span><span class="value" id="mG"></span></div>' +
      '<div class="display sub2"><span class="label">金額</span><span class="value" id="mAmt"></span></div>' +
      '<div class="quick">' + [100, 200, 300, 500].map(function (g) {
        return '<button class="btn" data-g="' + g + '">' + g + 'g</button>';
      }).join('') + '</div>' +
      keypadHtml() +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button>' +
      '<button class="btn primary" id="mOk" data-act="ok">' + (line ? '変更' : '追加') + '</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.key) {
          // 既存の値・はかりから入った値は、最初のキー入力で置き換える
          if ((fresh || follow) && b.dataset.key !== 'BS') val = '';
          follow = false;
          fresh = false;
          val = applyKey(val, b.dataset.key, 5);
          draw();
        }
        else if (b.dataset.g) { follow = false; val = b.dataset.g; draw(); }
        else if (b.dataset.act === 'connect') {
          Scale.connectBluetooth(settings.scaleUnit).catch(function (err) {
            if (err && err.name !== 'NotFoundError') toast(Scale.state.error || 'はかりに接続できませんでした');
          });
        } else if (b.dataset.act === 'usescale') {
          if (Scale.state.reading) { val = String(Scale.state.reading.grams); draw(); }
        } else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'ok') {
          var g = Number(val || 0);
          if (!g) return;
          if (line) { line.qty = g; delete line.estimated; }
          else cart.lines.push(newLine(p, g));
          closeModal();
          saveCart();
          if (!line) toast(p.name + ' ' + num(g) + 'g を追加');
        }
      }
    );
    if (mode !== 'none') {
      modalHooks.cleanup = Scale.onChange(onScale);
      onScale(Scale.state);
    }
    if (mode === 'keyboard') {
      // キーボード型のはかりは「0.350kg⏎」のように文字で送ってくる。Enterで重さとして取り込む
      modalHooks.key = function (e) {
        if (e.key === 'Enter') {
          if (!kbBuf) return false; // 何も届いていなければ通常のEnter（確定）
          var r = Scale.parseWeight(kbBuf, settings.scaleUnit);
          kbBuf = '';
          if (r) {
            Scale.setReading(r);
            if (r.grams > 0) { val = String(r.grams); follow = false; fresh = false; draw(); }
          }
          return true;
        }
        if (e.key === 'Backspace') { kbBuf = ''; return false; }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { kbBuf += e.key; return true; }
        return false;
      };
    }
    draw();
  }

  // ---------- 金額入力（自由価格） ----------
  function openOpenPriceModal(p, line) {
    var val = line ? String(line.price) : '';
    var fresh = !!line;
    function draw() {
      $('mP').textContent = yen(Number(val || 0));
      $('mOk').disabled = !Number(val);
    }
    openModal(
      '<h3>' + esc(p.name) + '</h3><div class="sub">金額を入力（税込・' + p.taxRate + '%）</div>' +
      '<div class="display"><span class="label">金額</span><span class="value" id="mP"></span></div>' +
      keypadHtml() +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button>' +
      '<button class="btn primary" id="mOk" data-act="ok">' + (line ? '変更' : '追加') + '</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.key) {
          if (fresh && b.dataset.key !== 'BS') val = '';
          fresh = false;
          val = applyKey(val, b.dataset.key, 7);
          draw();
        }
        else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'ok') {
          var v = Number(val || 0);
          if (!v) return;
          if (line) line.price = v;
          else cart.lines.push(newLine(p, 1, v));
          closeModal();
          saveCart();
        }
      }
    );
    draw();
  }

  // ---------- 明細の編集（数量・値引き・削除） ----------
  function openLineModal(line) {
    var p = products.find(function (x) { return x.id === line.productId; }) ||
      { id: line.productId, name: line.name, unit: line.unit, price: line.price, taxRate: line.taxRate };
    var qtyVal = String(line.unit === 'open' ? line.price : line.qty);
    var disc = line.discount ? { type: line.discount.type, value: line.discount.value } : null;
    var target = 'qty'; // or 'yen'
    var fresh = true;   // 既存の数量は最初のキー入力で置き換える
    var yenVal = disc && disc.type === 'yen' ? String(disc.value) : '';

    var qtyLabelText = line.unit === 'g' ? '重さ' : line.unit === 'pc' ? '数量' : '金額';
    function preview() {
      var l = { unit: line.unit, price: line.price, qty: line.qty, discount: disc };
      if (line.unit === 'open') l.price = Number(qtyVal || 0);
      else l.qty = Number(qtyVal || 0);
      return l;
    }
    function draw() {
      var l = preview();
      var q = Number(qtyVal || 0);
      $('mQ').textContent = line.unit === 'g' ? num(q) + ' g' : line.unit === 'pc' ? q + ' 個' : yen(q);
      $('mQBox').style.outline = target === 'qty' ? '3px solid var(--accent)' : 'none';
      $('mYBox').style.outline = target === 'yen' ? '3px solid var(--accent)' : 'none';
      $('mY').textContent = disc && disc.value ? '-' + num(Calc.lineDiscount(l, round())) + '（' + discLabel(disc) + '）' : 'なし';
      $('mAmt').textContent = yen(Calc.lineAmount(l, round()));
      modalBody.querySelectorAll('[data-disc]').forEach(function (b) {
        var d = b.dataset.disc;
        var on = (d === 'none' && !(disc && disc.value)) ||
          (disc && disc.type === 'pct' && String(disc.value) === d) ||
          (d === 'yen' && disc && disc.type === 'yen');
        b.classList.toggle('on', !!on);
      });
      $('mOk').disabled = !q;
    }
    var pcButtons = line.unit === 'pc'
      ? '<div class="quick" style="grid-template-columns:1fr 1fr"><button class="btn" data-step="-1">－1</button><button class="btn" data-step="1">＋1</button></div>'
      : '';
    openModal(
      '<h3>' + esc(line.name) + '</h3><div class="sub">' +
      (line.unit === 'open' ? '金額入力' : priceLabel(line)) + '・税率' + line.taxRate + '%</div>' +
      '<div class="display" id="mQBox" data-target="qty"><span class="label">' + qtyLabelText + '</span><span class="value" id="mQ"></span></div>' +
      pcButtons +
      '<div class="seg" style="margin:6px 0">' +
      '<button class="btn small" data-disc="none">値引なし</button>' +
      '<button class="btn small" data-disc="10">10%引</button>' +
      '<button class="btn small" data-disc="20">20%引</button>' +
      '<button class="btn small" data-disc="30">30%引</button>' +
      '<button class="btn small" data-disc="50">半額</button>' +
      '<button class="btn small" data-disc="yen">円引…</button></div>' +
      '<div class="display sub2" id="mYBox" data-target="yen"><span class="label">値引</span><span class="value" id="mY" style="font-size:20px"></span></div>' +
      '<div class="display sub2"><span class="label">金額</span><span class="value" id="mAmt"></span></div>' +
      keypadHtml() +
      '<div class="modal-foot"><button class="btn danger-outline" data-act="del">削除</button>' +
      '<button class="btn primary" id="mOk" data-act="ok">確定</button></div>',
      function (e) {
        var b = e.target.closest('button, [data-target]');
        if (!b) return;
        if (b.dataset.key) {
          if (target === 'qty') {
            if (fresh && b.dataset.key !== 'BS') qtyVal = '';
            fresh = false;
            qtyVal = applyKey(qtyVal, b.dataset.key, line.unit === 'pc' ? 3 : line.unit === 'g' ? 5 : 7);
          }
          else { yenVal = applyKey(yenVal, b.dataset.key, 6); disc = { type: 'yen', value: Number(yenVal || 0) }; }
          draw();
        } else if (b.dataset.step) {
          qtyVal = String(Math.max(1, Number(qtyVal || 0) + Number(b.dataset.step)));
          fresh = false;
          target = 'qty';
          draw();
        } else if (b.dataset.target) {
          target = b.dataset.target;
          if (target === 'yen' && !(disc && disc.type === 'yen')) { yenVal = ''; disc = { type: 'yen', value: 0 }; }
          draw();
        } else if (b.dataset.disc) {
          var d = b.dataset.disc;
          if (d === 'none') { disc = null; target = 'qty'; }
          else if (d === 'yen') { target = 'yen'; yenVal = ''; disc = { type: 'yen', value: 0 }; }
          else { disc = { type: 'pct', value: Number(d) }; target = 'qty'; }
          draw();
        } else if (b.dataset.act === 'del') {
          cart.lines = cart.lines.filter(function (l) { return l !== line; });
          closeModal();
          saveCart();
        } else if (b.dataset.act === 'ok') {
          var q = Number(qtyVal || 0);
          if (!q) return;
          if (line.unit === 'open') line.price = q; else line.qty = q;
          delete line.estimated;
          line.discount = disc && disc.value ? disc : null;
          closeModal();
          saveCart();
        }
      }
    );
    draw();
  }

  // ---------- 小計値引き ----------
  function openTxDiscountModal() {
    var disc = cart.discount ? { type: cart.discount.type, value: cart.discount.value } : null;
    var val = disc && disc.type === 'yen' ? String(disc.value) : '';
    function draw() {
      var t = Calc.totals(cart.lines, disc, round());
      $('mD').textContent = disc && disc.value ? '-' + num(t.discount) + '（' + discLabel(disc) + '）' : 'なし';
      $('mT').textContent = yen(t.total);
      modalBody.querySelectorAll('[data-disc]').forEach(function (b) {
        var d = b.dataset.disc;
        b.classList.toggle('on', (d === 'none' && !(disc && disc.value)) ||
          (!!disc && disc.type === 'pct' && String(disc.value) === d));
      });
    }
    openModal(
      '<h3>小計値引き</h3><div class="sub">割合を選ぶか、値引き額をテンキーで入力</div>' +
      '<div class="seg" style="margin:6px 0">' +
      '<button class="btn small" data-disc="none">なし</button>' +
      '<button class="btn small" data-disc="5">5%</button>' +
      '<button class="btn small" data-disc="10">10%</button>' +
      '<button class="btn small" data-disc="20">20%</button></div>' +
      '<div class="display sub2"><span class="label">値引</span><span class="value" id="mD" style="font-size:20px"></span></div>' +
      '<div class="display"><span class="label">合計</span><span class="value" id="mT"></span></div>' +
      keypadHtml() +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button>' +
      '<button class="btn primary" data-act="ok">確定</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.key) {
          val = applyKey(val, b.dataset.key, 6);
          disc = { type: 'yen', value: Number(val || 0) };
          draw();
        } else if (b.dataset.disc) {
          val = '';
          disc = b.dataset.disc === 'none' ? null : { type: 'pct', value: Number(b.dataset.disc) };
          draw();
        } else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'ok') {
          cart.discount = disc && disc.value ? disc : null;
          closeModal();
          saveCart();
        }
      }
    );
    draw();
  }

  // ---------- 会計 ----------
  function openPayModal() {
    if (!cart.lines.length) return;
    if (cart.lines.some(function (l) { return l.estimated; }) &&
      !confirm('予約時の予定重量のままの商品があります。このまま会計しますか？\n（実際の重さに直すには、カートの商品をタップ）')) return;
    $('cartPanel').classList.remove('open');
    var t = Calc.totals(cart.lines, cart.discount, round());
    var deposit = cart.deposit || 0;
    if (t.total - deposit <= 0) { openDepositSettleModal(t, deposit); return; }
    var due = t.total - deposit;
    var method = 'cash';
    var val = '';
    function pay() { return Calc.payments(t.total, deposit, method, Number(val || 0)); }
    function draw() {
      var p = pay();
      $('mR').textContent = yen(p.received);
      $('mC').textContent = p.change >= 0 ? yen(p.change) : '不足 ' + yen(-p.change);
      $('mOk').disabled = p.change < 0;
      $('mCashArea').style.display = method === 'cash' ? '' : 'none';
      modalBody.querySelectorAll('[data-method]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.method === method);
      });
    }
    var bills = [1000, 2000, 5000, 10000].filter(function (b) { return b >= due || b === 10000; });
    var quick = ['<button class="btn" data-set="' + due + '">ちょうど</button>']
      .concat(bills.slice(0, 3).map(function (b) { return '<button class="btn" data-set="' + b + '">' + num(b) + '円</button>'; }));
    openModal(
      '<h3>お会計' + (cart.customer ? '<span class="resv-chip">' + esc(cart.customer) + ' 様</span>' : '') + '</h3>' +
      '<div class="seg"><button class="btn" data-method="cash">現金</button><button class="btn" data-method="cashless">キャッシュレス</button></div>' +
      (deposit
        ? '<div class="display sub2"><span class="label">合計 ' + yen(t.total) + '／前受金</span><span class="value">-' + num(deposit) + '</span></div>' +
          '<div class="display"><span class="label">お支払い残額</span><span class="value">' + yen(due) + '</span></div>'
        : '<div class="display"><span class="label">合計</span><span class="value">' + yen(t.total) + '</span></div>') +
      '<div class="display sub2"><span class="label">お預かり</span><span class="value" id="mR"></span></div>' +
      '<div class="display change"><span class="label">おつり</span><span class="value" id="mC"></span></div>' +
      '<div id="mCashArea"><div class="quick">' + quick.join('') + '</div>' + keypadHtml() + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">戻る</button>' +
      '<button class="btn primary big" id="mOk" data-act="ok">会計確定</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.key) { val = applyKey(val, b.dataset.key, 7); draw(); }
        else if (b.dataset.set) { val = b.dataset.set; draw(); }
        else if (b.dataset.method) { method = b.dataset.method; draw(); }
        else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'ok') {
          var p = pay();
          if (p.change < 0) return;
          completeSale(p);
        }
      }
    );
    draw();
  }

  /** 前受金だけで足りる場合（差額は返金） */
  function openDepositSettleModal(t, deposit) {
    var p = Calc.payments(t.total, deposit, 'cash', 0);
    openModal(
      '<h3>前受金で精算</h3>' +
      '<div class="display"><span class="label">合計</span><span class="value">' + yen(t.total) + '</span></div>' +
      '<div class="display sub2"><span class="label">前受金</span><span class="value">' + yen(deposit) + '</span></div>' +
      '<div class="display change"><span class="label">返金</span><span class="value">' + yen(p.refund) + '</span></div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">戻る</button>' +
      '<button class="btn primary big" id="mOk" data-act="ok">精算確定</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') closeModal();
        if (b.dataset.act === 'ok') completeSale(p);
      }
    );
  }

  function completeSale(p) {
    var t = Calc.totals(cart.lines, cart.discount, round());
    var now = new Date();
    var sale = {
      id: 'S' + now.getTime(),
      no: Store.nextSeq(),
      at: now.toISOString(),
      date: localDate(now),
      lines: cart.lines.map(function (l) {
        return {
          productId: l.productId, name: l.name, unit: l.unit, price: l.price, qty: l.qty,
          taxRate: l.taxRate, discount: l.discount,
          discountAmount: Calc.lineDiscount(l, round()),
          amount: Calc.lineAmount(l, round())
        };
      }),
      discount: cart.discount,
      totals: t,
      method: p.cashless > 0 ? 'cashless' : 'cash',
      received: p.received,
      change: p.change,
      refund: p.refund,
      payments: { deposit: p.deposit, cash: p.cash, cashless: p.cashless },
      reservationId: cart.reservationId || null,
      customer: cart.customer || '',
      void: false
    };
    Store.addSale(sale);
    stockChange(sale.lines, -1);
    if (sale.reservationId) {
      var list = Store.getReservations();
      var r = list.find(function (x) { return x.id === sale.reservationId; });
      if (r) { r.status = 'done'; r.saleId = sale.id; r.doneAt = sale.at; saveResvList(list); }
    }
    cart = { lines: [], discount: null };
    saveCart();

    var big;
    if (p.refund) big = '前受金の返金<strong>' + yen(p.refund) + '</strong>';
    else if (p.cashless) big = 'キャッシュレス決済<strong>' + yen(p.cashless) + '</strong>';
    else if (p.due <= 0) big = '前受金で精算<strong>' + yen(t.total) + '</strong>';
    else big = 'おつり<strong>' + yen(p.change) + '</strong>';
    openModal(
      '<div class="done-mark">✅</div>' +
      '<div class="big-change">' + big + '</div>' +
      '<div class="sub" style="text-align:center">取引No.' + sale.no + '　合計 ' + yen(t.total) +
      (p.deposit ? '　前受金 ' + yen(p.deposit) : '') +
      (p.cash > 0 ? '　お預かり ' + yen(p.received) : '') + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="print">レシート印刷</button>' +
      '<button class="btn primary big" data-act="next">次のお客様</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'print') printReceipt(sale);
        if (b.dataset.act === 'next') closeModal();
      },
      false
    );
    if (settings.autoPrint) setTimeout(function () { printReceipt(sale); }, 300);
  }

  // ================= 印刷 =================
  function printHtml(html) {
    var w = settings.paperWidth === '80' ? 'w80' : settings.paperWidth === 'a4' ? 'wa4' : 'w58';
    $('printArea').innerHTML = '<div class="receipt ' + w + '">' + html + '</div>';
    setTimeout(function () { window.print(); }, 50);
  }

  function receiptHtml(sale, reprint) {
    var d = new Date(sale.at);
    var h = '';
    h += '<div class="c title">' + esc(settings.storeName) + '</div>';
    if (settings.address) h += '<div class="c">' + esc(settings.address) + '</div>';
    if (settings.tel) h += '<div class="c">TEL ' + esc(settings.tel) + '</div>';
    if (settings.invoiceNo) h += '<div class="c">登録番号 ' + esc(settings.invoiceNo) + '</div>';
    h += '<div class="c" style="margin-top:4px">' + (settings.invoiceNo ? '領収書（適格簡易請求書）' : '領収書') + '</div>';
    if (sale.void) h += '<div class="voidmark">取 消</div>';
    if (reprint) h += '<div class="c">＊＊ 再発行 ＊＊</div>';
    h += '<div class="row"><span>' + dateTimeStr(d) + '</span><span>No.' + sale.no + '</span></div>';
    if (sale.customer) h += '<div>' + esc(sale.customer) + ' 様（ご予約）</div>';
    h += '<hr>';
    sale.lines.forEach(function (l) {
      var mark = l.taxRate === 8 ? '※' : '';
      h += '<div class="row"><span>' + mark + esc(l.name) + '</span><span>' + yen(l.amount + (l.discountAmount || 0)) + '</span></div>';
      if (l.unit === 'g') h += '<div class="ind">' + yen(l.price) + '/100g × ' + num(l.qty) + 'g</div>';
      else if (l.unit === 'pc' && l.qty > 1) h += '<div class="ind">' + yen(l.price) + ' × ' + l.qty + '</div>';
      if (l.discountAmount) h += '<div class="row ind"><span>値引 ' + discLabel(l.discount) + '</span><span>-' + num(l.discountAmount) + '</span></div>';
    });
    var t = sale.totals;
    h += '<hr><div class="row"><span>小計</span><span>' + yen(t.subtotal) + '</span></div>';
    if (t.discount) h += '<div class="row"><span>値引 ' + discLabel(sale.discount) + '</span><span>-' + num(t.discount) + '</span></div>';
    h += '<div class="row big"><span>合計</span><span>' + yen(t.total) + '</span></div>';
    t.byRate.forEach(function (r) {
      h += '<div class="row"><span>(' + r.rate + '%対象</span><span>' + yen(r.amount) + ')</span></div>';
      h += '<div class="row"><span>(内消費税等 ' + r.rate + '%</span><span>' + yen(r.tax) + ')</span></div>';
    });
    h += '<hr>';
    var pm = Calc.salePayments(sale);
    if (pm.deposit) h += row('前受金', '-' + num(pm.deposit));
    if (sale.refund) {
      h += row('前受金のご返金', yen(sale.refund));
    } else if (pm.cashless) {
      h += row('キャッシュレス', yen(pm.cashless));
    } else if (pm.cash > 0 || !pm.deposit) {
      h += row('お預かり', yen(sale.received));
      h += row('おつり', yen(sale.change));
    }
    if (sale.lines.some(function (l) { return l.taxRate === 8; })) h += '<div>※は軽減税率(8%)対象商品</div>';
    if (settings.footer) h += '<div class="c" style="margin-top:6px">' + esc(settings.footer).replace(/\n/g, '<br>') + '</div>';
    return h;
  }

  function printReceipt(sale, reprint) { printHtml(receiptHtml(sale, reprint)); }

  // ================= 売上画面 =================
  function summarize(date) {
    return Calc.summarizeDay(Store.getSales(), Store.getReservations(), date, { slips: Store.getSlips(), receipts: Store.getReceipts() });
  }

  function payLabel(x) {
    var p = Calc.salePayments(x);
    var parts = [];
    if (p.deposit) parts.push('前受金');
    if (p.cash > 0) parts.push('現金');
    if (p.cashless) parts.push('キャッシュレス');
    if (x.refund) parts.push('返金');
    return parts.join('＋') || '現金';
  }

  function renderSales() {
    $('salesDate').value = salesDate;
    var s = summarize(salesDate);
    var h = '<div class="cards">';
    h += card('店頭の売上合計', yen(s.total));
    h += card('客数', s.count + '件');
    h += card('客単価', yen(s.count ? Math.round(s.total / s.count) : 0));
    h += card('現金', yen(s.cash) + (s.cash < 0 ? '<div class="note">前受金の差額返金を含む</div>' : ''));
    h += card('キャッシュレス', yen(s.cashless));
    h += card('値引き合計', yen(s.discount));
    if (s.depositUsed) h += card('前受金から充当', yen(s.depositUsed));
    var dIn = s.depositIn.cash + s.depositIn.cashless;
    var dOut = s.depositRefund.cash + s.depositRefund.cashless;
    if (dIn) h += card('前受金の受取', yen(dIn) + '<div class="note">現金 ' + yen(s.depositIn.cash) + '</div>');
    if (dOut) h += card('前受金の返金', yen(dOut) + '<div class="note">現金 ' + yen(s.depositRefund.cash) + '</div>');
    var w = s.wholesale;
    if (w.count) h += card('卸の納品（税込）', yen(w.total) + '<div class="note">' + w.count + '件・うち掛け ' + yen(w.credit) + '</div>');
    if (w.cashOnDelivery || w.receiptCash) h += card('卸の現金回収', yen(w.cashOnDelivery + w.receiptCash));
    if (w.receiptOther) h += card('卸の振込などの入金', yen(w.receiptOther));
    h += card('レジ内現金の増減', yen(s.drawerCash) + '<div class="note">現金売上＋前受金−返金＋卸の現金回収</div>');
    Object.keys(s.rates).sort(function (a, b) { return a - b; }).forEach(function (r) {
      h += card(r + '%対象（内税）', yen(s.rates[r].amount) + '<div class="note">税 ' + yen(s.rates[r].tax) + '</div>');
    });
    if (s.voids) h += card('取消', s.voids + '件');
    h += '</div>';

    var items = Object.keys(s.items).map(function (k) { return s.items[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    h += '<h2>商品別</h2>';
    if (items.length) {
      h += '<div class="table-wrap"><table><thead><tr><th>商品</th><th class="r">数量</th><th class="r">金額</th></tr></thead><tbody>';
      items.forEach(function (it) {
        var q = it.unit === 'g' ? num(it.qty) + 'g（' + it.count + '回）' : num(it.qty) + (it.unit === 'open' ? '回' : '個');
        h += '<tr><td>' + esc(it.name) + '</td><td class="r num">' + q + '</td><td class="r num">' + yen(it.amount) + '</td></tr>';
      });
      h += '</tbody></table></div><p class="note">商品別金額は行ごとの値引き後・小計値引き前の金額です。</p>';
    } else {
      h += '<p class="note">この日の売上はありません。</p>';
    }

    h += '<h2>取引一覧</h2>';
    if (s.sales.length) {
      h += '<div class="table-wrap"><table><thead><tr><th>No.</th><th>時刻</th><th class="r">点数</th><th class="r">合計</th><th>支払</th><th></th></tr></thead><tbody>';
      s.sales.slice().reverse().forEach(function (x) {
        h += '<tr class="' + (x.void ? 'void' : '') + '"><td>' + x.no + '</td><td>' + timeStr(new Date(x.at)) + '</td>' +
          '<td class="r">' + x.lines.length + '</td><td class="r num">' + yen(x.totals.total) + '</td>' +
          '<td>' + payLabel(x) + (x.customer ? '・' + esc(x.customer) + '様' : '') + (x.void ? '（取消）' : '') + '</td>' +
          '<td class="act"><button class="btn small" data-detail="' + x.id + '">詳細</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    $('salesSummary').innerHTML = h;
  }
  function card(k, v) { return '<div class="card"><div class="k">' + k + '</div><div class="v num">' + v + '</div></div>'; }

  $('salesDate').addEventListener('change', function () { salesDate = this.value || localDate(new Date()); renderSales(); });
  $('btnPrevDay').addEventListener('click', function () { shiftDay(-1); });
  $('btnNextDay').addEventListener('click', function () { shiftDay(1); });
  function shiftDay(n) {
    var p = salesDate.split('-').map(Number);
    salesDate = localDate(new Date(p[0], p[1] - 1, p[2] + n));
    renderSales();
  }

  $('salesSummary').addEventListener('click', function (e) {
    var b = e.target.closest('[data-detail]');
    if (!b) return;
    var sale = Store.getSales().find(function (x) { return x.id === b.dataset.detail; });
    if (sale) openSaleDetail(sale);
  });

  function openSaleDetail(sale) {
    openModal(
      '<h3>取引No.' + sale.no + (sale.void ? '（取消済）' : '') + '</h3>' +
      '<div class="receipt" style="width:auto;padding:8px 0;font-size:14px">' + receiptHtml(sale) + '</div>' +
      '<div class="btn-row">' +
      '<button class="btn" data-act="reprint">レシート再発行</button>' +
      (sale.void ? '' : '<button class="btn danger-outline" data-act="void">この取引を取消</button>') +
      '<span class="spacer"></span><button class="btn primary" data-act="close">閉じる</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'close') closeModal();
        if (b.dataset.act === 'reprint') printReceipt(sale, true);
        if (b.dataset.act === 'void') {
          if (!confirm('取引No.' + sale.no + '（' + yen(sale.totals.total) + '）を取り消しますか？\n返金は手作業で行ってください。在庫は元に戻ります。' + (sale.reservationId ? '\n予約は「予約中」に戻ります。' : ''))) return;
          var x = Store.getSales().find(function (y) { return y.id === sale.id; });
          x.void = true;
          x.voidAt = new Date().toISOString();
          Store.updateSale(x);
          stockChange(x.lines, 1);
          if (x.reservationId) {
            var rl = Store.getReservations();
            var rr = rl.find(function (y) { return y.id === x.reservationId; });
            if (rr && rr.status === 'done') { rr.status = 'reserved'; rr.saleId = null; saveResvList(rl); }
          }
          closeModal();
          renderSales();
          toast('取消しました');
        }
      }
    );
  }

  $('btnPrintReport').addEventListener('click', function () {
    var s = summarize(salesDate);
    var h = '<div class="c title">精算レポート</div><div class="c">' + esc(settings.storeName) + '</div>';
    h += '<div class="c">' + salesDate + '</div><div class="c">出力 ' + dateTimeStr(new Date()) + '</div><hr>';
    h += row('売上合計', yen(s.total)) + row('客数', s.count + '件') + row('客単価', yen(s.count ? Math.round(s.total / s.count) : 0));
    h += '<hr>' + row('現金', yen(s.cash)) + row('キャッシュレス', yen(s.cashless)) + row('前受金から充当', yen(s.depositUsed)) +
      row('値引き合計', yen(s.discount)) + row('取消', s.voids + '件');
    h += '<hr>' + row('前受金の受取（現金）', yen(s.depositIn.cash)) + row('前受金の受取（キャッシュレス）', yen(s.depositIn.cashless)) +
      row('前受金の返金（現金）', yen(s.depositRefund.cash));
    h += '<hr>' + row('卸の納品（税込）', yen(s.wholesale.total) + '（' + s.wholesale.count + '件）') +
      row('卸の現金回収', yen(s.wholesale.cashOnDelivery + s.wholesale.receiptCash)) +
      row('卸の振込などの入金', yen(s.wholesale.receiptOther));
    h += '<hr>' + row('<b>レジ内現金の増減</b>', '<b>' + yen(s.drawerCash) + '</b>');
    h += '<hr>';
    Object.keys(s.rates).sort(function (a, b) { return a - b; }).forEach(function (r) {
      h += row(r + '%対象', yen(s.rates[r].amount)) + row('　内消費税', yen(s.rates[r].tax));
    });
    h += '<hr><div>商品別</div>';
    Object.keys(s.items).map(function (k) { return s.items[k]; }).sort(function (a, b) { return b.amount - a.amount; }).forEach(function (it) {
      h += row(esc(it.name) + ' ' + (it.unit === 'g' ? num(it.qty) + 'g' : num(it.qty)), yen(it.amount));
    });
    printHtml(h);
  });
  function row(a, b) { return '<div class="row"><span>' + a + '</span><span>' + b + '</span></div>'; }

  $('btnExportCsv').addEventListener('click', function () {
    var sales = Store.getSales().filter(function (s) { return s.date === salesDate; });
    var rows = [['日付', '時刻', '取引No', '支払', '取消', '商品', '税率', '単価', '数量', '単位', '値引', '金額', '取引合計']];
    sales.forEach(function (s) {
      s.lines.forEach(function (l) {
        rows.push([s.date, timeStr(new Date(s.at)), s.no, payLabel(s), s.void ? '取消' : '',
          l.name, l.taxRate, l.price, l.unit === 'open' ? 1 : l.qty, l.unit === 'g' ? 'g' : '個', l.discountAmount || 0, l.amount, s.totals.total]);
      });
      if (s.totals.discount) {
        rows.push([s.date, timeStr(new Date(s.at)), s.no, payLabel(s), s.void ? '取消' : '',
          '小計値引', '', '', '', '', s.totals.discount, -s.totals.discount, s.totals.total]);
      }
    });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (c) { var v = String(c); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    saveFile('nikupos-sales-' + salesDate + '.csv', csv, 'text/csv');
  });

  /** ファイル保存。スマホでは共有シート（「ファイルに保存」等）を優先 */
  function saveFile(name, content, type) {
    var blob = new Blob([content], { type: type });
    var file;
    try { file = new File([blob], name, { type: type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && isNarrowOrTouch()) {
      navigator.share({ files: [file], title: name }).catch(function (err) {
        if (err && err.name !== 'AbortError') downloadBlob(blob, name);
      });
      return;
    }
    downloadBlob(blob, name);
  }
  function isNarrowOrTouch() { return isNarrow() || ('ontouchstart' in window); }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ================= 商品マスタ =================
  function renderProductList() {
    var h = '';
    categories().forEach(function (c) {
      var list = products.filter(function (p) { return p.category === c; }).sort(function (a, b) { return a.order - b.order; });
      if (!list.length) return;
      h += '<div class="plist-cat"><h2>' + esc(c) + '</h2>';
      list.forEach(function (p, i) {
        h += '<div class="plist-item"><span class="sw" style="background:' + esc(p.color) + '"></span>' +
          '<div class="info"><div class="n">' + esc(p.name) + '</div><div class="d">' +
          UNIT_LABEL[p.unit] + (p.unit === 'open' ? '' : ' ' + yen(p.price)) + '・税率' + p.taxRate + '%' +
          (p.wsPrice ? '・卸 ' + yen(p.wsPrice) + (p.unit === 'g' ? '/kg' : '/個') : '') +
          (p.trackStock ? '・在庫管理' : '') + '</div></div>' +
          '<button class="btn" data-move="-1" data-id="' + p.id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="上へ">▲</button>' +
          '<button class="btn" data-move="1" data-id="' + p.id + '"' + (i === list.length - 1 ? ' disabled' : '') + ' aria-label="下へ">▼</button>' +
          '<button class="btn" data-edit="' + p.id + '">編集</button></div>';
      });
      h += '</div>';
    });
    $('productList').innerHTML = h || '<p class="note">商品がありません。</p>';
  }

  $('productList').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) {
      openProductModal(products.find(function (p) { return p.id === b.dataset.edit; }));
    } else if (b.dataset.move) {
      var p = products.find(function (x) { return x.id === b.dataset.id; });
      var list = products.filter(function (x) { return x.category === p.category; }).sort(function (a, c) { return a.order - c.order; });
      var i = list.indexOf(p);
      var j = i + Number(b.dataset.move);
      if (j < 0 || j >= list.length) return;
      var tmp = list[j].order;
      list[j].order = p.order;
      p.order = tmp;
      Store.saveProducts(products);
      renderProductList();
    }
  });
  $('btnAddProduct').addEventListener('click', function () { openProductModal(null); });

  function openProductModal(p) {
    var isNew = !p;
    var d = p ? JSON.parse(JSON.stringify(p)) : { name: '', category: categories()[0] || '生肉', unit: 'g', price: '', taxRate: 8, color: COLORS[0] };
    var cats = categories();
    openModal(
      '<h3>' + (isNew ? '商品を追加' : '商品を編集') + '</h3>' +
      '<form class="form" id="pForm" onsubmit="return false">' +
      '<label>商品名<input name="name" value="' + esc(d.name) + '" required autocomplete="off"></label>' +
      '<label>カテゴリ<select name="category">' + cats.map(function (c) {
        return '<option' + (c === d.category ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select></label>' +
      '<label>売り方<div class="seg" id="pUnit">' +
      '<button type="button" class="btn small" data-unit="g">グラム売り</button>' +
      '<button type="button" class="btn small" data-unit="pc">個数売り</button>' +
      '<button type="button" class="btn small" data-unit="open">金額入力</button></div></label>' +
      '<label id="pPriceLabel"><span id="pPriceText"></span><input name="price" type="number" inputmode="numeric" min="0" step="1" value="' + esc(d.price) + '"></label>' +
      '<label id="pWsLabel"><span id="pWsText"></span><input name="wsPrice" type="number" inputmode="numeric" min="0" step="1" value="' + esc(d.wsPrice || '') + '" placeholder="卸をしない商品は空欄"></label>' +
      '<label class="check" id="pTrackLabel"><input type="checkbox" name="trackStock"' + (d.trackStock ? ' checked' : '') + '> 在庫を管理する</label>' +
      '<label id="pMinLabel"><span id="pMinText"></span><input name="minStock" type="text" inputmode="decimal" value="' +
      (d.minStock ? (d.unit === 'g' ? d.minStock / 1000 : d.minStock) : '') + '" placeholder="例：' + (d.unit === 'g' ? '2' : '10') + '"></label>' +
      '<label>税率<div class="seg" id="pTax">' +
      '<button type="button" class="btn small" data-tax="8">8%（食品・持ち帰り）</button>' +
      '<button type="button" class="btn small" data-tax="10">10%（レジ袋など）</button></div></label>' +
      '<label>ボタンの色<div class="colors" id="pColors">' + COLORS.map(function (c) {
        return '<button type="button" data-color="' + c + '" style="background:' + c + '"></button>';
      }).join('') + '</div></label>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew ? '<button class="btn" data-act="cancel">キャンセル</button>' :
        '<button class="btn danger-outline" data-act="del">削除</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.unit) { d.unit = b.dataset.unit; draw(); }
        else if (b.dataset.tax) { d.taxRate = Number(b.dataset.tax); draw(); }
        else if (b.dataset.color) { d.color = b.dataset.color; draw(); }
        else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'del') {
          if (!confirm('「' + p.name + '」を削除しますか？（過去の売上データは残ります）')) return;
          products = products.filter(function (x) { return x.id !== p.id; });
          Store.saveProducts(products);
          closeModal();
          renderProductList();
        } else if (b.dataset.act === 'save') {
          var f = $('pForm');
          var name = f.elements.name.value.trim();
          var price = Math.floor(Number(f.elements.price.value || 0));
          if (!name) { alert('商品名を入力してください'); return; }
          if (d.unit !== 'open' && !(price > 0)) { alert('単価を入力してください'); return; }
          d.name = name;
          d.category = f.elements.category.value;
          d.price = d.unit === 'open' ? 0 : price;
          d.wsPrice = d.unit === 'open' ? 0 : Math.floor(Number(f.elements.wsPrice.value || 0));
          d.trackStock = d.unit !== 'open' && f.elements.trackStock.checked;
          var minv = parseFloat(f.elements.minStock.value || '0') || 0;
          d.minStock = d.unit === 'g' ? Math.round(minv * 1000) : Math.round(minv);
          if (isNew) {
            d.id = 'p' + Date.now();
            d.order = products.reduce(function (m, x) { return Math.max(m, x.order); }, 0) + 1;
            products.push(d);
          } else {
            var idx = products.findIndex(function (x) { return x.id === p.id; });
            products[idx] = d;
          }
          Store.saveProducts(products);
          closeModal();
          renderProductList();
          toast('保存しました');
        }
      }
    );
    function draw() {
      modalBody.querySelectorAll('[data-unit]').forEach(function (x) { x.classList.toggle('on', x.dataset.unit === d.unit); });
      modalBody.querySelectorAll('[data-tax]').forEach(function (x) { x.classList.toggle('on', Number(x.dataset.tax) === d.taxRate); });
      modalBody.querySelectorAll('[data-color]').forEach(function (x) { x.classList.toggle('on', x.dataset.color === d.color); });
      $('pPriceLabel').style.display = d.unit === 'open' ? 'none' : '';
      $('pPriceText').textContent = d.unit === 'g' ? '単価（100gあたり・税込・円）' : '単価（1個あたり・税込・円）';
      var open = d.unit === 'open';
      $('pWsLabel').style.display = open ? 'none' : '';
      $('pTrackLabel').style.display = open ? 'none' : '';
      $('pMinLabel').style.display = open ? 'none' : '';
      $('pWsText').textContent = d.unit === 'g' ? '卸単価（1kgあたり・税抜・円）' : '卸単価（1個あたり・税抜・円）';
      $('pMinText').textContent = '発注点：在庫がこれを下回ったら知らせる（' + (d.unit === 'g' ? 'kg' : '個') + '）';
    }
    draw();
  }

  // ================= 予約・取り置き =================
  var STATUS_LABEL = { reserved: '予約中', ready: '準備済', done: '受渡済', cancelled: '取消' };
  var resvDate = localDate(new Date());
  var resvScope = 'day';
  var resvQuery = '';

  function saveResvList(list) {
    Store.saveReservations(list);
    updateResvBadge();
  }
  function updateResvBadge() {
    var today = localDate(new Date());
    var n = Store.getReservations().filter(function (r) { return r.date === today && Calc.isActiveReservation(r); }).length;
    var b = $('resvBadge');
    b.hidden = !n;
    b.textContent = n;
  }
  function weekday(dateStr) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + '日月火水木金土'[d.getDay()] + '）';
  }
  function itemQty(it) {
    if (it.unit === 'g') return '約' + num(it.qty) + 'g';
    if (it.unit === 'open') return yen(it.price);
    return it.qty + '個';
  }
  function prepQty(it) {
    if (it.unit === 'g') return num(it.qty) + 'g' + (it.qty >= 1000 ? '（' + (it.qty / 1000).toFixed(1) + 'kg）' : '');
    if (it.unit === 'open') return it.qty + '件';
    return num(it.qty) + '個';
  }
  function depositText(r) {
    return yen(r.deposit) + '（' + (r.depositMethod === 'cashless' ? 'キャッシュレス' : '現金') + '）';
  }

  function renderReservations() {
    $('resvDate').value = resvDate;
    $('resvSearch').value = resvQuery;
    document.querySelectorAll('#resvScope [data-scope]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.scope === resvScope);
    });
    var today = localDate(new Date());
    var q = resvQuery.trim();
    var qd = q.replace(/\D/g, '');
    var order = { reserved: 0, ready: 0, done: 1, cancelled: 2 };
    var list = Store.getReservations().filter(function (r) {
      if (q) return (r.name || '').indexOf(q) >= 0 || (qd.length >= 2 && (r.phone || '').replace(/\D/g, '').indexOf(qd) >= 0);
      if (resvScope === 'day') return r.date === resvDate;
      return r.date >= today && Calc.isActiveReservation(r);
    }).sort(function (a, b) {
      return a.date.localeCompare(b.date) || (order[a.status] - order[b.status]) ||
        (a.time || '99').localeCompare(b.time || '99') || a.no - b.no;
    });

    var h = '';
    if (resvScope === 'day' && !q) {
      var active = list.filter(Calc.isActiveReservation);
      h += '<p class="note">' + weekday(resvDate) + (resvDate === today ? '・今日' : '') + '　受取予定 ' + active.length + '件' +
        (list.length - active.length ? '（受渡済・取消 ' + (list.length - active.length) + '件）' : '') + '</p>';
    }
    if (!list.length) {
      h += '<p class="note">' + (q ? '該当する予約はありません。' : '予約はありません。「＋ 新規予約」から登録できます。') + '</p>';
    }
    var lastDate = null;
    list.forEach(function (r) {
      if ((resvScope !== 'day' || q) && r.date !== lastDate) {
        h += '<div class="resv-group">' + weekday(r.date) + (r.date === today ? '・今日' : '') + '</div>';
        lastDate = r.date;
      }
      var active = Calc.isActiveReservation(r);
      h += '<div class="resv ' + r.status + '">' +
        '<div class="resv-top"><span class="resv-time">' + (r.time || '時間未定') + '</span>' +
        '<span class="resv-name">' + esc(r.name) + ' 様</span>' +
        (r.phone ? '<a class="resv-tel" href="tel:' + esc(r.phone.replace(/[^\d+]/g, '')) + '">' + esc(r.phone) + '</a>' : '') +
        '<span class="resv-status">' + STATUS_LABEL[r.status] + '</span></div>' +
        '<div class="resv-items">' + r.items.map(function (it) { return esc(it.name) + ' ' + itemQty(it); }).join('、') + '</div>' +
        '<div class="resv-meta">No.' + r.no + '・概算 ' + yen(Calc.reservationEstimate(r, round())) +
        (r.deposit ? '・前受金 ' + depositText(r) + (r.depositRefundDate ? ' 返金済' : '') : '') + '</div>' +
        (r.note ? '<div class="resv-note">' + esc(r.note) + '</div>' : '') +
        '<div class="btn-row">' +
        (active ? '<button class="btn primary" data-act="checkout" data-id="' + r.id + '">レジで会計</button>' +
          '<button class="btn" data-act="ready" data-id="' + r.id + '">' + (r.status === 'ready' ? '準備前に戻す' : '準備済にする') + '</button>' +
          '<button class="btn" data-act="edit" data-id="' + r.id + '">編集</button>' : '') +
        (r.status !== 'cancelled' ? '<button class="btn" data-act="slip" data-id="' + r.id + '">予約票</button>' : '') +
        '</div></div>';
    });
    $('resvList').innerHTML = h;
  }

  $('resvDate').addEventListener('change', function () {
    resvDate = this.value || localDate(new Date());
    resvScope = 'day';
    renderReservations();
  });
  function shiftResvDay(n) {
    var p = resvDate.split('-').map(Number);
    resvDate = localDate(new Date(p[0], p[1] - 1, p[2] + n));
    resvScope = 'day';
    renderReservations();
  }
  $('btnResvPrev').addEventListener('click', function () { shiftResvDay(-1); });
  $('btnResvNext').addEventListener('click', function () { shiftResvDay(1); });
  $('btnResvToday').addEventListener('click', function () { resvDate = localDate(new Date()); resvScope = 'day'; renderReservations(); });
  $('resvScope').addEventListener('click', function (e) {
    var b = e.target.closest('[data-scope]');
    if (!b) return;
    resvScope = b.dataset.scope;
    renderReservations();
  });
  $('resvSearch').addEventListener('input', function () { resvQuery = this.value; renderReservations(); });
  $('btnAddResv').addEventListener('click', function () { openResvModal(null); });
  $('btnPrep').addEventListener('click', openPrepModal);

  $('resvList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var list = Store.getReservations();
    var r = list.find(function (x) { return x.id === b.dataset.id; });
    if (!r) return;
    if (b.dataset.act === 'edit') openResvModal(r);
    else if (b.dataset.act === 'slip') printResvSlip(r);
    else if (b.dataset.act === 'ready') {
      r.status = r.status === 'ready' ? 'reserved' : 'ready';
      saveResvList(list);
      renderReservations();
    } else if (b.dataset.act === 'checkout') loadReservationToCart(r);
  });

  /** 予約をレジに読み込む */
  function loadReservationToCart(r) {
    if (cart.lines.length && cart.reservationId !== r.id &&
      !confirm('レジに会計途中の商品があります。予約の内容に置き換えますか？')) return;
    cart = {
      lines: r.items.map(function (it) {
        var l = {
          key: 'L' + (lineSeq++), productId: it.productId, name: it.name, unit: it.unit,
          price: it.price, qty: it.qty, taxRate: it.taxRate, discount: null
        };
        if (it.unit === 'g') l.estimated = true; // 実際の重さで量り直す
        return l;
      }),
      discount: null,
      reservationId: r.id,
      reservationNo: r.no,
      customer: r.name,
      deposit: r.depositRefundDate ? 0 : (r.deposit || 0)
    };
    saveCart();
    showView('register');
    if (isNarrow()) $('cartPanel').classList.add('open');
    if (cart.lines.some(function (l) { return l.estimated; })) toast('グラム売りの商品をタップして、実際の重さを入力してください');
  }

  /** 予約の登録・編集 */
  function openResvModal(orig) {
    var isNew = !orig;
    var today = localDate(new Date());
    var r = orig ? JSON.parse(JSON.stringify(orig)) : {
      name: '', phone: '', date: resvDate >= today ? resvDate : today, time: '', items: [], note: '',
      deposit: 0, depositMethod: 'cash', status: 'reserved'
    };
    var depositLocked = !isNew && orig.deposit > 0;
    var depMethod = r.depositMethod || 'cash';
    var cats = categories();
    var options = cats.map(function (c) {
      var ps = products.filter(function (p) { return p.category === c; }).sort(function (a, b) { return a.order - b.order; });
      if (!ps.length) return '';
      return '<optgroup label="' + esc(c) + '">' + ps.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.name) + '（' + priceLabel(p) + '）</option>';
      }).join('') + '</optgroup>';
    }).join('');

    openModal(
      '<h3>' + (isNew ? '新規予約' : '予約 No.' + r.no + ' の編集') + '</h3>' +
      '<form class="form" id="rForm" onsubmit="return false" style="margin-top:10px">' +
      '<label>お名前<input name="name" value="' + esc(r.name) + '" autocomplete="off"></label>' +
      '<label>電話番号<input name="phone" type="tel" inputmode="tel" value="' + esc(r.phone) + '" autocomplete="off"></label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<label>受取日<input name="date" type="date" value="' + esc(r.date) + '"></label>' +
      '<label>受取時刻<input name="time" type="time" step="900" value="' + esc(r.time) + '"></label></div>' +
      '<div><div class="note" style="margin-bottom:4px">商品（グラム売りは予定の重さ。受取時に実際の重さで精算します）</div>' +
      '<div id="rItems"></div>' +
      '<div class="radd"><select id="rAddSel">' + options + '</select>' +
      '<button type="button" class="btn" data-act="additem">＋ 追加</button></div>' +
      '<div class="sum-row" style="margin-top:6px;font-size:16px;color:var(--ink)"><span>概算金額</span><strong id="rEst" class="num"></strong></div></div>' +
      (depositLocked
        ? '<label>前受金<div class="locked">' + depositText(r) + '　' + weekday(r.depositDate) + ' 受取済' + (r.depositRefundDate ? '・返金済' : '') + '</div></label>'
        : '<label>前受金（受け取った場合）<input name="deposit" type="number" inputmode="numeric" min="0" step="1" placeholder="0"></label>' +
          '<div class="seg" id="rDepMethod"><button type="button" class="btn small" data-dep="cash">現金で受取</button>' +
          '<button type="button" class="btn small" data-dep="cashless">キャッシュレスで受取</button></div>') +
      '<label>メモ<textarea name="note" rows="2" placeholder="例：切り分け不要、タレ多め">' + esc(r.note) + '</textarea></label>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew ? '<button class="btn" data-act="cancel">キャンセル</button>'
        : '<button class="btn danger-outline" data-act="cancelresv">予約を取消</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'additem') {
          var p = products.find(function (x) { return x.id === $('rAddSel').value; });
          if (!p) return;
          r.items.push({
            productId: p.id, name: p.name, unit: p.unit, price: p.price, taxRate: p.taxRate,
            qty: p.unit === 'g' ? 500 : 1
          });
          drawItems();
          var inputs = modalBody.querySelectorAll('#rItems input');
          if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
        } else if (b.dataset.del != null) {
          r.items.splice(Number(b.dataset.del), 1);
          drawItems();
        } else if (b.dataset.dep) {
          depMethod = b.dataset.dep;
          drawDep();
        } else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'cancelresv') openCancelResvModal(orig);
        else if (b.dataset.act === 'save') save();
      },
      false
    );
    modalBody.oninput = function (e) {
      var i = e.target.dataset && e.target.dataset.i;
      if (i == null) return;
      var it = r.items[Number(i)];
      var v = Math.floor(Number(e.target.value || 0));
      if (it.unit === 'open') it.price = v; else it.qty = v;
      drawEst();
    };

    function drawItems() {
      $('rItems').innerHTML = r.items.length ? r.items.map(function (it, i) {
        var hint = it.unit === 'g' ? '予定重量（g）' : it.unit === 'open' ? '金額（円）' : '個数';
        return '<div class="ritem"><div class="rname">' + esc(it.name) + '<small>' + hint + '</small></div>' +
          '<input type="number" inputmode="numeric" min="1" step="1" data-i="' + i + '" value="' + (it.unit === 'open' ? (it.price || '') : it.qty) + '">' +
          '<button type="button" data-del="' + i + '" aria-label="削除">×</button></div>';
      }).join('') : '<p class="note">下で商品を選んで「追加」</p>';
      drawEst();
    }
    function drawEst() { $('rEst').textContent = yen(Calc.reservationEstimate(r, round())); }
    function drawDep() {
      modalBody.querySelectorAll('[data-dep]').forEach(function (x) { x.classList.toggle('on', x.dataset.dep === depMethod); });
    }

    function save() {
      var f = $('rForm').elements;
      var name = f.name.value.trim();
      if (!name) { alert('お名前を入力してください'); return; }
      if (!f.date.value) { alert('受取日を入力してください'); return; }
      if (!r.items.length) { alert('商品を1つ以上追加してください'); return; }
      var bad = r.items.find(function (it) { return it.unit === 'open' ? !(it.price > 0) : !(it.qty > 0); });
      if (bad) { alert('「' + bad.name + '」の数量・金額を入力してください'); return; }
      r.name = name;
      r.phone = f.phone.value.trim();
      r.date = f.date.value;
      r.time = f.time.value;
      r.note = f.note.value.trim();
      if (!depositLocked) {
        var dep = Math.floor(Number(f.deposit.value || 0));
        if (dep > 0) {
          r.deposit = dep;
          r.depositMethod = depMethod;
          r.depositDate = today;
        } else {
          r.deposit = 0;
        }
      }
      var list = Store.getReservations();
      if (isNew) {
        r.id = 'R' + Date.now();
        r.no = Store.nextReservationNo();
        r.createdAt = new Date().toISOString();
        list.push(r);
      } else {
        var idx = list.findIndex(function (x) { return x.id === r.id; });
        list[idx] = r;
      }
      saveResvList(list);
      closeModal();
      resvDate = r.date;
      resvScope = 'day';
      resvQuery = '';
      renderReservations();
      toast(isNew ? '予約 No.' + r.no + ' を登録しました' : '予約を保存しました');
    }

    drawItems();
    if (!depositLocked) drawDep();
  }

  function openCancelResvModal(r) {
    if (cart.reservationId === r.id) { alert('この予約はレジで会計中です。レジの「全取消」をしてから取り消してください。'); return; }
    var hasDeposit = r.deposit > 0 && !r.depositRefundDate;
    openModal(
      '<h3>予約 No.' + r.no + ' を取り消しますか？</h3>' +
      '<div class="sub">' + esc(r.name) + ' 様・' + weekday(r.date) + ' ' + (r.time || '') + '</div>' +
      (hasDeposit ? '<p>前受金 <b>' + depositText(r) + '</b> を受け取っています。</p>' : '') +
      '<div class="btn-row" style="flex-direction:column;align-items:stretch">' +
      (hasDeposit
        ? '<button class="btn danger" data-act="refund">前受金を返金して取消</button>' +
          '<button class="btn danger-outline" data-act="keep">返金せずに取消</button>'
        : '<button class="btn danger" data-act="keep">取り消す</button>') +
      '<button class="btn" data-act="back">戻る</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'back') { closeModal(); return; }
        var list = Store.getReservations();
        var x = list.find(function (y) { return y.id === r.id; });
        x.status = 'cancelled';
        x.cancelledAt = new Date().toISOString();
        if (b.dataset.act === 'refund') x.depositRefundDate = localDate(new Date());
        saveResvList(list);
        closeModal();
        renderReservations();
        toast('予約を取り消しました');
      }
    );
  }

  /** 仕込み集計（その日に受け取りの商品の合計） */
  function openPrepModal() {
    var date = resvDate;
    var s = Calc.prepSummary(Store.getReservations(), date);
    var h = '<h3>仕込み集計</h3><div class="sub">' + weekday(date) + ' 受取分・予約 ' + s.count + '件（取消・受渡済を除く）</div>';
    if (s.items.length) {
      h += '<div class="table-wrap"><table><thead><tr><th>商品</th><th class="r">合計</th><th class="r">予約数</th></tr></thead><tbody>' +
        s.items.map(function (it) {
          return '<tr><td>' + esc(it.name) + '</td><td class="r num"><b>' + prepQty(it) + '</b></td><td class="r">' + it.reservations + '件</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      h += '<p class="note">この日に受け取りの予約はありません。</p>';
    }
    h += '<div class="modal-foot"><button class="btn" data-act="print"' + (s.items.length ? '' : ' disabled') + '>印刷</button>' +
      '<button class="btn primary" data-act="close">閉じる</button></div>';
    openModal(h, function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'close') closeModal();
      if (b.dataset.act === 'print') printPrepList(date, s);
    });
  }

  function printPrepList(date, s) {
    var h = '<div class="c title">仕込み表</div><div class="c">' + weekday(date) + ' 受取分</div><div class="c">予約 ' + s.count + '件</div><hr>';
    s.items.forEach(function (it) { h += row(esc(it.name), prepQty(it)); });
    h += '<hr><div>予約一覧</div>';
    Store.getReservations().filter(function (r) { return r.date === date && Calc.isActiveReservation(r); })
      .sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); })
      .forEach(function (r) {
        h += '<div style="margin-top:4px"><b>' + (r.time || '--:--') + ' ' + esc(r.name) + ' 様</b>（No.' + r.no + '）</div>';
        r.items.forEach(function (it) { h += '<div class="row ind"><span>' + esc(it.name) + '</span><span>' + itemQty(it) + '</span></div>'; });
        if (r.note) h += '<div class="ind">※' + esc(r.note) + '</div>';
      });
    printHtml(h);
  }

  /** お客様控えの予約票 */
  function printResvSlip(r) {
    var h = '<div class="c title">ご予約票</div><div class="c">' + esc(settings.storeName) + '</div>';
    if (settings.tel) h += '<div class="c">TEL ' + esc(settings.tel) + '</div>';
    h += '<hr>' + row('予約番号', 'No.' + r.no);
    h += '<div class="big">' + esc(r.name) + ' 様</div>';
    if (r.phone) h += row('電話番号', esc(r.phone));
    h += row('お受取', weekday(r.date) + ' ' + (r.time || '')) + '<hr>';
    r.items.forEach(function (it) { h += row(esc(it.name), itemQty(it)); });
    h += '<hr>' + row('概算金額', yen(Calc.reservationEstimate(r, round())));
    if (r.deposit) h += row('前受金（お預かり済）', yen(r.deposit));
    if (r.items.some(function (it) { return it.unit === 'g'; })) h += '<div>※グラム売りの商品は、お受取時に実際の重さで精算します。</div>';
    if (r.note) h += '<div>メモ：' + esc(r.note) + '</div>';
    h += '<div class="c" style="margin-top:6px">お受取の際にこの票をお持ちください</div>';
    printHtml(h);
  }

  // ================= 設定 =================
  function renderSettings() {
    var f = $('settingsForm');
    ['storeName', 'address', 'tel', 'invoiceNo', 'footer', 'rounding', 'paperWidth', 'scaleMode', 'scaleUnit', 'bankInfo'].forEach(function (k) { f.elements[k].value = settings[k]; });
    f.elements.categories.value = settings.categories.join(',');
    f.autoPrint.checked = !!settings.autoPrint;
    var counts = '店頭の売上 ' + num(Store.getSales().length) + '件・予約 ' + num(Store.getReservations().length) +
      '件・卸伝票 ' + num(Store.getSlips().length) + '件・在庫履歴 ' + num(Store.getMoves().length) + '件';
    $('storageNote').textContent = counts + (Store.usingIndexedDB() ? '' : '（※この端末では簡易保存モードで動作中。容量が小さいため、こまめにバックアップしてください）');
    Store.estimate().then(function (e) {
      if (!e || e.usage == null || !Store.usingIndexedDB()) return;
      var mb = function (v) { return (Math.round(v / 1024 / 1024 * 10) / 10).toLocaleString('ja-JP'); };
      $('storageNote').textContent = counts + '（使用量 約' + mb(e.usage) + 'MB' + (e.quota ? '／上限の目安 約' + num(Math.round(e.quota / 1024 / 1024)) + 'MB' : '') + '）';
    });
    $('installNote').innerHTML = installHint();
    renderScaleSettings();
  }

  function renderScaleSettings() {
    var mode = $('settingsForm').elements.scaleMode.value;
    var st = Scale.state;
    var h = '';
    if (mode === 'keyboard') {
      h += '<p class="note">はかりの「送信」「印字」ボタンを押すと、重さ入力画面に重さが自動で入ります。' +
        'iPhone・iPadでは、はかり（または変換アダプタ）をBluetoothキーボードとして接続してください。</p>';
    } else if (mode === 'bluetooth') {
      if (!Scale.bluetoothSupported()) {
        h += '<p class="note" style="color:var(--danger)">この端末・ブラウザはBluetooth直接接続に対応していません。' +
          'iPhone・iPadでは「キーボード入力型」を選んでください。</p>';
      } else {
        h += '<div class="scale-box' + (st.connected ? ' live' : '') + '"><div><div class="s-label">' +
          (st.connected ? '接続中：' + esc(st.deviceName) : '未接続' + (st.error ? '（' + esc(st.error) + '）' : '')) + '</div>' +
          '<span class="s-val">' + (st.connected && st.reading ? num(st.reading.grams) + ' g' : '—') + '</span></div>' +
          (st.connected ? '<button type="button" class="btn small" data-scale="off">切断</button>'
            : '<button type="button" class="btn small" data-scale="on">はかりに接続</button>') + '</div>' +
          '<p class="note">アプリを開き直すと接続が切れます。その場合は重さ入力画面の「はかりに接続」から再接続できます。</p>';
      }
    }
    if (mode !== 'none') h += '<p class="note">※ 量り売りに使うはかりは、計量法の検定に合格したもの（検定証印付き）を使ってください。</p>';
    $('scaleSettings').innerHTML = h;
  }
  $('settingsForm').elements.scaleMode.addEventListener('change', renderScaleSettings);
  $('scaleSettings').addEventListener('click', function (e) {
    var b = e.target.closest('[data-scale]');
    if (!b) return;
    if (b.dataset.scale === 'off') { Scale.disconnect(); return; }
    Scale.connectBluetooth($('settingsForm').elements.scaleUnit.value).catch(function () { /* 画面に表示 */ });
  });
  Scale.onChange(function () {
    if ($('view-settings').classList.contains('active')) renderScaleSettings();
  });

  $('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this;
    ['storeName', 'address', 'tel', 'invoiceNo', 'footer', 'rounding', 'paperWidth', 'scaleMode', 'scaleUnit', 'bankInfo'].forEach(function (k) { settings[k] = f.elements[k].value.trim(); });
    settings.categories = f.elements.categories.value.split(/[,、，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!settings.categories.length) settings.categories = ['その他'];
    settings.autoPrint = f.autoPrint.checked;
    Store.saveSettings(settings);
    applyStoreName();
    toast('設定を保存しました');
  });

  $('btnBackup').addEventListener('click', function () {
    var data = JSON.stringify(Store.exportAll());
    saveFile('nikupos-backup-' + localDate(new Date()) + '.json', data, 'application/json');
  });

  $('fileRestore').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    if (!confirm('現在のデータ（商品・設定・売上・予約・卸・在庫）をバックアップの内容で置き換えます。よろしいですか？')) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (err) { alert('復元できませんでした：ファイルを読み取れません'); return; }
      Store.importAll(data).then(function () {
        alert('復元しました。アプリを再読み込みします。');
        location.reload();
      }).catch(function (err) {
        alert('復元できませんでした：' + err.message);
      });
    };
    reader.readAsText(file);
  });

  $('btnPurge').addEventListener('click', function () {
    var d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    var input = prompt('この日付より前の売上を削除します（YYYY-MM-DD）。\n先にバックアップを保存することをおすすめします。', localDate(d));
    if (!input) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) { alert('日付の形式が正しくありません'); return; }
    var removed = Store.getSales().filter(function (s) { return s.date < input; }).length;
    if (!removed) { alert('削除対象の売上はありません'); return; }
    if (!confirm(removed + '件の売上を削除します。元に戻せません。よろしいですか？')) return;
    Store.removeSalesBefore(input);
    renderSettings();
    toast(removed + '件削除しました');
  });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function installHint() {
    if (isStandalone()) return 'ホーム画面のアプリとして動作中です。';
    var ua = navigator.userAgent;
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) return '<b>おすすめ：</b>Safariの共有ボタン <b>［↑］→「ホーム画面に追加」</b>でアプリとして使えます。全画面表示になり、データも消えにくくなります。';
    if (/Android/.test(ua)) return '<b>おすすめ：</b>Chromeのメニュー <b>［⋮］→「ホーム画面に追加」または「アプリをインストール」</b>でアプリとして使えます。';
    return '';
  }

  function applyStoreName() {
    $('storeName').textContent = settings.storeName || 'NIKUPOS';
    document.title = (settings.storeName ? settings.storeName + ' - ' : '') + 'NIKUPOS';
  }

  // ================= 在庫の増減（店頭・卸・在庫画面で共通） =================
  function trackedMap() {
    var m = {};
    products.forEach(function (p) { if (p.trackStock) m[p.id] = true; });
    return m;
  }
  /**
   * 在庫を増減する。move を渡すと在庫履歴に残す。
   * 店頭販売は件数が多いので履歴には残さない（売上データから集計できる）。
   */
  var moveSeq = 0;
  function stockChange(lines, sign, move) {
    var stock = Store.getStock();
    var changed = Calc.applyStock(stock, lines, sign, trackedMap());
    if (!changed.length) return changed;
    Store.saveStock(stock);
    if (move) {
      var at = new Date();
      Store.addMoves(changed.map(function (c) {
        return {
          id: 'M' + at.getTime() + '-' + (moveSeq++), at: at.toISOString(), date: localDate(at),
          type: move.type, productId: c.productId, name: c.name, delta: c.delta, after: stock[c.productId],
          cost: move.cost || null, supplier: move.supplier || '', ref: move.ref || '', note: move.note || ''
        };
      }));
    }
    refreshBadges();
    return changed;
  }

  var badgeFns = [updateResvBadge];
  function refreshBadges() { badgeFns.forEach(function (f) { f(); }); }

  /** A4 の帳票（納品書・請求書）を印刷 */
  function printDoc(html) {
    $('printArea').innerHTML = '<div class="doc">' + html + '</div>';
    setTimeout(function () { window.print(); }, 50);
  }

  var POS = {
    $: $, esc: esc, yen: yen, num: num, localDate: localDate, timeStr: timeStr, dateTimeStr: dateTimeStr, weekday: weekday,
    round: round, toast: toast, isNarrow: isNarrow, row: row, card: card, priceLabel: priceLabel,
    openModal: openModal, closeModal: closeModal, modalBody: modalBody,
    printHtml: printHtml, printDoc: printDoc, saveFile: saveFile,
    products: function () { return products; },
    settings: function () { return settings; },
    saveProducts: function () { Store.saveProducts(products); },
    categories: categories,
    stockChange: stockChange,
    trackedMap: trackedMap,
    views: {},
    addBadge: function (f) { badgeFns.push(f); },
    refreshBadges: refreshBadges,
    showView: showView
  };
  (window.NIKUPOS_MODULES || []).forEach(function (init) { init(POS); });

  // ================= 起動 =================
  applyStoreName();
  tick();
  setInterval(tick, 10000);
  currentCat = '__all';
  renderRegister();
  refreshBadges();
  setInterval(refreshBadges, 60000);

  // ブラウザにデータを消されにくくする（対応ブラウザのみ）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}).catch(function (err) {
  console.error(err);
  alert('NIKUPOSを起動できませんでした：' + (err && err.message));
});
