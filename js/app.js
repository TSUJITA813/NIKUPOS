/*
 * NIKUPOS 画面ロジック
 */
(function () {
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
  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }
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
    if (name === 'sales') renderSales();
    if (name === 'products') renderProductList();
    if (name === 'settings') renderSettings();
  }

  function tick() {
    var d = new Date();
    $('clock').textContent = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + timeStr(d);
  }

  // ================= モーダル =================
  var modal = $('modal');
  var modalBody = $('modalBody');
  var modalCloseable = true;

  function openModal(html, onClick, closeable) {
    modalBody.innerHTML = html;
    modalBody.onclick = onClick || null;
    modalCloseable = closeable !== false;
    $('toast').hidden = true;
    modal.hidden = false;
  }
  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = '';
    modalBody.onclick = null;
  }
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
    $('cartSum').innerHTML = html;

    $('miniCount').textContent = t.count + '点';
    $('miniTotal').textContent = yen(t.total);
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
    if (line) openLineModal(line);
  });

  $('btnOpenCart').addEventListener('click', function () { $('toast').hidden = true; $('cartPanel').classList.add('open'); });
  $('btnCloseCart').addEventListener('click', function () { $('cartPanel').classList.remove('open'); });
  $('btnClearCart').addEventListener('click', function () {
    if (!confirm('カートの商品をすべて取り消しますか？')) return;
    cart = { lines: [], discount: null };
    saveCart();
    $('cartPanel').classList.remove('open');
  });
  $('btnPay').addEventListener('click', openPayModal);
  $('btnPayMini').addEventListener('click', openPayModal);
  $('btnTxDiscount').addEventListener('click', openTxDiscountModal);

  // ---------- 重量入力（グラム売り） ----------
  function openQtyModal(p, line) {
    var val = line ? String(line.qty) : '';
    var price = line ? line.price : p.price;
    function draw() {
      var g = Number(val || 0);
      var amt = Calc.lineBase({ unit: 'g', price: price, qty: g }, round());
      $('mG').textContent = num(g) + ' g';
      $('mAmt').textContent = yen(amt);
      $('mOk').disabled = !g;
    }
    openModal(
      '<h3>' + esc(p.name) + '</h3><div class="sub">' + yen(price) + ' / 100g</div>' +
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
        if (b.dataset.key) { val = applyKey(val, b.dataset.key, 5); draw(); }
        else if (b.dataset.g) { val = b.dataset.g; draw(); }
        else if (b.dataset.act === 'cancel') closeModal();
        else if (b.dataset.act === 'ok') {
          var g = Number(val || 0);
          if (!g) return;
          if (line) line.qty = g;
          else cart.lines.push(newLine(p, g));
          closeModal();
          saveCart();
          if (!line) toast(p.name + ' ' + num(g) + 'g を追加');
        }
      }
    );
    draw();
  }

  // ---------- 金額入力（自由価格） ----------
  function openOpenPriceModal(p, line) {
    var val = line ? String(line.price) : '';
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
        if (b.dataset.key) { val = applyKey(val, b.dataset.key, 7); draw(); }
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
          if (target === 'qty') qtyVal = applyKey(qtyVal, b.dataset.key, line.unit === 'pc' ? 3 : line.unit === 'g' ? 5 : 7);
          else { yenVal = applyKey(yenVal, b.dataset.key, 6); disc = { type: 'yen', value: Number(yenVal || 0) }; }
          draw();
        } else if (b.dataset.step) {
          qtyVal = String(Math.max(1, Number(qtyVal || 0) + Number(b.dataset.step)));
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
    $('cartPanel').classList.remove('open');
    var t = Calc.totals(cart.lines, cart.discount, round());
    var method = 'cash';
    var val = '';
    function received() { return method === 'cash' ? Number(val || 0) : t.total; }
    function draw() {
      $('mR').textContent = yen(received());
      var ch = received() - t.total;
      $('mC').textContent = ch >= 0 ? yen(ch) : '不足 ' + yen(-ch);
      $('mOk').disabled = ch < 0;
      $('mCashArea').style.display = method === 'cash' ? '' : 'none';
      modalBody.querySelectorAll('[data-method]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.method === method);
      });
    }
    var bills = [1000, 2000, 5000, 10000].filter(function (b) { return b >= t.total || b === 10000; });
    var quick = ['<button class="btn" data-set="' + t.total + '">ちょうど</button>']
      .concat(bills.slice(0, 3).map(function (b) { return '<button class="btn" data-set="' + b + '">' + num(b) + '円</button>'; }));
    openModal(
      '<h3>お会計</h3>' +
      '<div class="seg"><button class="btn" data-method="cash">現金</button><button class="btn" data-method="cashless">キャッシュレス</button></div>' +
      '<div class="display"><span class="label">合計</span><span class="value">' + yen(t.total) + '</span></div>' +
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
          if (received() < t.total) return;
          completeSale(method, received());
        }
      }
    );
    draw();
  }

  function completeSale(method, received) {
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
      method: method,
      received: received,
      change: received - t.total,
      void: false
    };
    var sales = Store.getSales();
    sales.push(sale);
    if (!Store.saveSales(sales)) return;
    cart = { lines: [], discount: null };
    saveCart();

    openModal(
      '<div class="done-mark">✅</div>' +
      '<div class="big-change">' + (method === 'cash' ? 'おつり<strong>' + yen(sale.change) + '</strong>' :
        'キャッシュレス決済<strong>' + yen(t.total) + '</strong>') + '</div>' +
      '<div class="sub" style="text-align:center">取引No.' + sale.no + '　合計 ' + yen(t.total) +
      (method === 'cash' ? '　お預かり ' + yen(received) : '') + '</div>' +
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
    h += '<div class="row"><span>' + dateTimeStr(d) + '</span><span>No.' + sale.no + '</span></div><hr>';
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
    if (sale.method === 'cash') {
      h += '<div class="row"><span>お預かり</span><span>' + yen(sale.received) + '</span></div>';
      h += '<div class="row"><span>おつり</span><span>' + yen(sale.change) + '</span></div>';
    } else {
      h += '<div class="row"><span>キャッシュレス</span><span>' + yen(t.total) + '</span></div>';
    }
    if (sale.lines.some(function (l) { return l.taxRate === 8; })) h += '<div>※は軽減税率(8%)対象商品</div>';
    if (settings.footer) h += '<div class="c" style="margin-top:6px">' + esc(settings.footer).replace(/\n/g, '<br>') + '</div>';
    return h;
  }

  function printReceipt(sale, reprint) { printHtml(receiptHtml(sale, reprint)); }

  // ================= 売上画面 =================
  function summarize(date) {
    var sales = Store.getSales().filter(function (s) { return s.date === date; });
    var valid = sales.filter(function (s) { return !s.void; });
    var sum = { sales: sales, count: valid.length, total: 0, cash: 0, cashless: 0, discount: 0, voids: sales.length - valid.length, rates: {}, items: {} };
    valid.forEach(function (s) {
      sum.total += s.totals.total;
      sum[s.method] += s.totals.total;
      sum.discount += s.totals.discount + (s.totals.lineDiscount || 0);
      s.totals.byRate.forEach(function (r) {
        var x = sum.rates[r.rate] || (sum.rates[r.rate] = { amount: 0, tax: 0 });
        x.amount += r.amount;
        x.tax += r.tax;
      });
      s.lines.forEach(function (l) {
        var it = sum.items[l.name] || (sum.items[l.name] = { name: l.name, unit: l.unit, qty: 0, count: 0, amount: 0 });
        it.qty += l.unit === 'open' ? 1 : l.qty;
        it.count += 1;
        it.amount += l.amount;
      });
    });
    return sum;
  }

  function renderSales() {
    $('salesDate').value = salesDate;
    var s = summarize(salesDate);
    var h = '<div class="cards">';
    h += card('売上合計', yen(s.total));
    h += card('客数', s.count + '件');
    h += card('客単価', yen(s.count ? Math.round(s.total / s.count) : 0));
    h += card('現金', yen(s.cash));
    h += card('キャッシュレス', yen(s.cashless));
    h += card('値引き合計', yen(s.discount));
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
          '<td>' + (x.method === 'cash' ? '現金' : 'キャッシュレス') + (x.void ? '（取消）' : '') + '</td>' +
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
          if (!confirm('取引No.' + sale.no + '（' + yen(sale.totals.total) + '）を取り消しますか？\n返金は手作業で行ってください。')) return;
          var sales = Store.getSales();
          var x = sales.find(function (y) { return y.id === sale.id; });
          x.void = true;
          x.voidAt = new Date().toISOString();
          Store.saveSales(sales);
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
    h += '<hr>' + row('現金', yen(s.cash)) + row('キャッシュレス', yen(s.cashless)) + row('値引き合計', yen(s.discount)) + row('取消', s.voids + '件');
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
        rows.push([s.date, timeStr(new Date(s.at)), s.no, s.method === 'cash' ? '現金' : 'キャッシュレス', s.void ? '取消' : '',
          l.name, l.taxRate, l.price, l.unit === 'open' ? 1 : l.qty, l.unit === 'g' ? 'g' : '個', l.discountAmount || 0, l.amount, s.totals.total]);
      });
      if (s.totals.discount) {
        rows.push([s.date, timeStr(new Date(s.at)), s.no, s.method === 'cash' ? '現金' : 'キャッシュレス', s.void ? '取消' : '',
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
          UNIT_LABEL[p.unit] + (p.unit === 'open' ? '' : ' ' + yen(p.price)) + '・税率' + p.taxRate + '%</div></div>' +
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
    }
    draw();
  }

  // ================= 設定 =================
  function renderSettings() {
    var f = $('settingsForm');
    ['storeName', 'address', 'tel', 'invoiceNo', 'footer', 'rounding', 'paperWidth'].forEach(function (k) { f[k].value = settings[k]; });
    f.categories.value = settings.categories.join(',');
    f.autoPrint.checked = !!settings.autoPrint;
    var kb = Math.round(Store.usageBytes() / 1024);
    $('storageNote').textContent = '保存中の売上：' + Store.getSales().length + '件（約' + num(kb) + 'KB）';
    $('installNote').innerHTML = installHint();
  }

  $('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this;
    ['storeName', 'address', 'tel', 'invoiceNo', 'footer', 'rounding', 'paperWidth'].forEach(function (k) { settings[k] = f[k].value.trim(); });
    settings.categories = f.categories.value.split(/[,、，]/).map(function (s) { return s.trim(); }).filter(Boolean);
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
    if (!confirm('現在のデータ（商品・設定・売上）をバックアップの内容で置き換えます。よろしいですか？')) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        Store.importAll(JSON.parse(reader.result));
        products = Store.getProducts();
        settings = Store.getSettings();
        applyStoreName();
        renderSettings();
        toast('復元しました');
      } catch (err) {
        alert('復元できませんでした：' + err.message);
      }
    };
    reader.readAsText(file);
  });

  $('btnPurge').addEventListener('click', function () {
    var d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    var input = prompt('この日付より前の売上を削除します（YYYY-MM-DD）。\n先にバックアップを保存することをおすすめします。', localDate(d));
    if (!input) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) { alert('日付の形式が正しくありません'); return; }
    var sales = Store.getSales();
    var keep = sales.filter(function (s) { return s.date >= input; });
    var removed = sales.length - keep.length;
    if (!removed) { alert('削除対象の売上はありません'); return; }
    if (!confirm(removed + '件の売上を削除します。元に戻せません。よろしいですか？')) return;
    Store.saveSales(keep);
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

  // ================= 起動 =================
  applyStoreName();
  tick();
  setInterval(tick, 10000);
  currentCat = '__all';
  renderRegister();

  // ブラウザにデータを消されにくくする（対応ブラウザのみ）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
