/*
 * 卸（飲食店などへの販売）
 *  伝票：受注 → 納品（実際の重さに修正）→ 納品書印刷。納品で在庫が減る
 *  取引先：単価（取引先ごとに最後に使った単価を記憶）、支払条件（掛け・締め日／現金）、売掛残高
 *  請求・入金：締め日ごとの請求書（適格請求書）、入金の記録
 * 金額は税抜単価 × 数量、消費税は伝票・請求書ごとに税率別に1回だけ端数処理（外税）。
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;
  var inv = function () { return POS.inv; }; // inventory.js のヘルパー

  var tab = 'slips';
  var wsDate = POS.localDate(new Date());
  var scope = 'day'; // 'day' | 'open'(未納品すべて)
  var STATUS = { order: '受注', delivered: '納品済', cancelled: '取消' };
  var PAY = { credit: '掛け', cash: '現金' };
  var METHOD = { cash: '現金', transfer: '振込', other: 'その他' };

  function today() { return POS.localDate(new Date()); }
  function round() { return POS.round(); }
  function settings() { return POS.settings(); }
  function productById(id) { return POS.products().find(function (p) { return p.id === id; }); }
  function customerById(id) { return Store.getCustomers().find(function (c) { return c.id === id; }); }
  function kg(g) { return (Math.round(g) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) + 'kg'; }
  function qtyText(l) { return l.unit === 'g' ? kg(l.qty) : num(l.qty) + '個'; }
  function unitPriceText(l) { return yen(l.price) + (l.unit === 'g' ? '/kg' : '/個'); }
  function closingText(c) {
    if (c.payment !== 'credit') return '現金（納品時）';
    return '掛け・' + (c.closingDay >= 29 ? '月末' : '毎月' + c.closingDay + '日') + '締め';
  }
  function sortedCustomers() {
    return Store.getCustomers().slice().sort(function (a, b) { return (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'); });
  }

  POS.addBadge(function () {
    var t = today();
    var n = Store.getSlips().filter(function (s) { return s.status === 'order' && s.date <= t; }).length;
    var b = $('wsBadge');
    b.hidden = !n;
    b.textContent = n;
  });

  // ================= 画面 =================
  function render() {
    var h = '<div class="subtabs">' +
      [['slips', '伝票（受注・納品）'], ['customers', '取引先'], ['billing', '請求・入金']].map(function (t) {
        return '<button class="btn' + (tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';
    if (tab === 'slips') h += renderSlips();
    else if (tab === 'customers') h += renderCustomers();
    else h += renderBilling();
    $('wsRoot').innerHTML = h;
    if (tab === 'slips') $('wsDate').value = wsDate;
  }
  POS.views.wholesale = render;

  // ---------- 伝票一覧 ----------
  function slipCard(s) {
    var c = customerById(s.customerId);
    var btns = '';
    if (s.status === 'order') {
      btns += '<button class="btn primary" data-s="deliver" data-id="' + s.id + '">納品する</button>' +
        '<button class="btn" data-s="edit" data-id="' + s.id + '">編集</button>' +
        '<button class="btn" data-s="note" data-id="' + s.id + '">注文書控え</button>' +
        '<button class="btn danger-outline" data-s="cancel" data-id="' + s.id + '">取消</button>';
    } else if (s.status === 'delivered') {
      btns += '<button class="btn primary" data-s="note" data-id="' + s.id + '">納品書</button>';
      if (!s.invoiceId) {
        btns += '<button class="btn" data-s="edit" data-id="' + s.id + '">修正</button>' +
          '<button class="btn danger-outline" data-s="cancel" data-id="' + s.id + '">取消</button>';
      }
    }
    return '<div class="list-item' + (s.status === 'cancelled' ? ' dim' : '') + '">' +
      '<div class="li-top"><span class="li-title">' + esc(c ? c.name : s.customerName) + '</span>' +
      '<span class="pill' + (s.status === 'delivered' ? ' ok' : s.status === 'cancelled' ? ' gray' : '') + '">' + STATUS[s.status] + '</span>' +
      '<span class="pill gray">' + PAY[s.payment] + '</span>' +
      (s.invoiceId ? '<span class="pill gray">請求済</span>' : '') +
      '<span class="li-amt">' + yen(s.totals.total) + '</span></div>' +
      '<div class="li-sub">No.' + s.no + '・' + POS.weekday(s.date) + (s.status === 'order' ? ' 納品予定' : '') + '・税抜 ' + yen(s.totals.subtotal) + '</div>' +
      '<div style="margin-top:4px">' + s.lines.map(function (l) { return esc(l.name) + ' ' + qtyText(l); }).join('、') + '</div>' +
      (s.note ? '<div class="resv-note">' + esc(s.note) + '</div>' : '') +
      (btns ? '<div class="btn-row">' + btns + '</div>' : '') + '</div>';
  }

  function renderSlips() {
    var all = Store.getSlips();
    var list = scope === 'open'
      ? all.filter(function (s) { return s.status === 'order'; })
      : all.filter(function (s) { return s.date === wsDate; });
    var ord = { order: 0, delivered: 1, cancelled: 2 };
    list = list.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || ord[a.status] - ord[b.status] || a.no - b.no; });
    var h = '<div class="toolbar">' +
      '<button class="btn small" data-nav="-1" aria-label="前の日">◀</button><input type="date" id="wsDate">' +
      '<button class="btn small" data-nav="1" aria-label="次の日">▶</button>' +
      '<button class="btn small" data-nav="0">今日</button>' +
      '<button class="btn small' + (scope === 'open' ? ' on' : '') + '" data-scope="open">未納品の受注すべて</button>' +
      '<span class="spacer"></span><button class="btn primary small" data-s="new">＋ 新規伝票</button></div>';
    if (scope === 'day') {
      var del = list.filter(function (s) { return s.status === 'delivered'; });
      var ordn = list.filter(function (s) { return s.status === 'order'; }).length;
      h += '<p class="note">' + POS.weekday(wsDate) + '　納品 ' + del.length + '件 ' +
        yen(del.reduce(function (x, s) { return x + s.totals.total; }, 0)) + '（税込）・未納品の受注 ' + ordn + '件' +
        '　<button class="btn small" data-csv="month">この月の伝票をCSV出力</button></p>';
    }
    if (!Store.getCustomers().length) {
      h += '<p class="note">まず「取引先」タブで、卸先のお店を登録してください。</p>';
    }
    h += list.length ? list.map(slipCard).join('') : '<p class="note">伝票はありません。</p>';
    return h;
  }

  // ---------- 取引先一覧 ----------
  function renderCustomers() {
    var slips = Store.getSlips();
    var receipts = Store.getReceipts();
    var h = '<div class="toolbar"><h2>取引先</h2><span class="spacer"></span>' +
      '<button class="btn primary small" data-c="new">＋ 取引先を追加</button></div>';
    var list = sortedCustomers();
    if (!list.length) return h + '<p class="note">取引先がありません。「＋ 取引先を追加」から登録してください。</p>';
    h += list.map(function (c) {
      var bal = Calc.receivableBalance(c.id, slips, receipts);
      return '<div class="list-item"><div class="li-top"><span class="li-title">' + esc(c.name) + '</span>' +
        '<span class="pill gray">' + closingText(c) + '</span>' +
        (c.payment === 'credit' ? '<span class="li-amt' + (bal < 0 ? ' neg' : '') + '">売掛残 ' + yen(bal) + '</span>' : '') + '</div>' +
        '<div class="li-sub">' + [c.person && esc(c.person) + ' 様', c.tel && '<a class="resv-tel" href="tel:' + esc(c.tel.replace(/[^\d+]/g, '')) + '">' + esc(c.tel) + '</a>', esc(c.address || '')].filter(Boolean).join('・') + '</div>' +
        '<div class="btn-row"><button class="btn" data-c="edit" data-id="' + c.id + '">編集</button>' +
        '<button class="btn" data-s="new" data-cid="' + c.id + '">伝票を作成</button>' +
        (c.payment === 'credit' ? '<button class="btn" data-b="receipt" data-cid="' + c.id + '">入金を登録</button>' +
          '<button class="btn" data-b="invoice" data-cid="' + c.id + '">請求書を作成</button>' : '') +
        '</div></div>';
    }).join('');
    return h;
  }

  // ---------- 請求・入金 ----------
  function renderBilling() {
    var slips = Store.getSlips();
    var h = '<div class="btn-row"><button class="btn primary" data-b="invoice">請求書を作成</button>' +
      '<button class="btn" data-b="bulk">締め日で一括作成</button>' +
      '<button class="btn" data-b="receipt">入金を登録</button></div>';

    // 未請求
    var pending = {};
    slips.forEach(function (s) {
      if (s.status === 'delivered' && s.payment === 'credit' && !s.invoiceId) {
        var p = pending[s.customerId] || (pending[s.customerId] = { n: 0, total: 0 });
        p.n++;
        p.total += s.totals.total;
      }
    });
    var pk = Object.keys(pending);
    h += '<h2>まだ請求していない納品</h2>';
    h += pk.length ? '<div class="table-wrap"><table><thead><tr><th>取引先</th><th class="r">伝票</th><th class="r">金額（税込）</th></tr></thead><tbody>' +
      pk.map(function (cid) {
        var c = customerById(cid);
        return '<tr><td>' + esc(c ? c.name : '') + '</td><td class="r">' + pending[cid].n + '件</td><td class="r num">' + yen(pending[cid].total) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="note">ありません。</p>';

    var invs = Store.getInvoices().slice().sort(function (a, b) { return b.no - a.no; }).slice(0, 50);
    var latest = {};
    Store.getInvoices().forEach(function (i) { if (!latest[i.customerId] || latest[i.customerId].no < i.no) latest[i.customerId] = i; });
    h += '<h2>請求書</h2>';
    h += invs.length ? invs.map(function (i) {
      return '<div class="list-item"><div class="li-top"><span class="li-title">' + esc(i.customerName) + '</span>' +
        '<span class="li-sub">No.' + i.no + '・' + i.periodTo + ' 締め</span>' +
        '<span class="li-amt">' + yen(i.billed) + '</span></div>' +
        '<div class="li-sub">今回お買上 ' + yen(i.purchase) + '（うち消費税 ' + yen(i.tax) + '）・繰越 ' + yen(i.carry) + '・発行 ' + i.issueDate + '</div>' +
        '<div class="btn-row"><button class="btn" data-b="print" data-id="' + i.id + '">印刷</button>' +
        (latest[i.customerId] === i ? '<button class="btn danger-outline" data-b="undo" data-id="' + i.id + '">作り直す（取消）</button>' : '') +
        '</div></div>';
    }).join('') : '<p class="note">まだ請求書はありません。</p>';

    var rcs = Store.getReceipts().slice().sort(function (a, b) { return b.date.localeCompare(a.date) || (b.id < a.id ? -1 : 1); }).slice(0, 50);
    h += '<h2>入金</h2>';
    h += rcs.length ? '<div class="table-wrap"><table><thead><tr><th>日付</th><th>取引先</th><th>方法</th><th class="r">金額</th><th></th></tr></thead><tbody>' +
      rcs.map(function (r) {
        var c = customerById(r.customerId);
        return '<tr><td>' + r.date + '</td><td>' + esc(c ? c.name : '') + '</td><td>' + METHOD[r.method] + (r.note ? '・' + esc(r.note) : '') + '</td>' +
          '<td class="r num">' + yen(r.amount) + '</td><td>' +
          (r.invoiceId ? '<span class="note">請求書に反映済</span>' : '<button class="btn small danger-outline" data-b="delreceipt" data-id="' + r.id + '">削除</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="note">まだ入金の記録はありません。</p>';
    return h;
  }

  // ---------- 操作 ----------
  $('wsRoot').addEventListener('change', function (e) {
    if (e.target.id === 'wsDate') { wsDate = e.target.value || today(); scope = 'day'; render(); }
  });
  $('wsRoot').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var d = b.dataset;
    if (d.tab) { tab = d.tab; render(); return; }
    if (d.nav != null) {
      if (d.nav === '0') wsDate = today();
      else {
        var p = wsDate.split('-').map(Number);
        wsDate = POS.localDate(new Date(p[0], p[1] - 1, p[2] + Number(d.nav)));
      }
      scope = 'day';
      render();
      return;
    }
    if (d.scope) { scope = scope === 'open' ? 'day' : 'open'; render(); return; }
    if (d.csv) { exportMonthCsv(); return; }
    var slip = d.id ? Store.getSlips().find(function (s) { return s.id === d.id; }) : null;
    if (d.s === 'new') {
      if (!Store.getCustomers().length) { tab = 'customers'; render(); openCustomerModal(null); return; }
      openSlipModal(null, d.cid);
    } else if (d.s === 'edit' || d.s === 'deliver') openSlipModal(slip, null, d.s === 'deliver');
    else if (d.s === 'note') printSlip(slip);
    else if (d.s === 'cancel') cancelSlip(slip);
    else if (d.c === 'new') openCustomerModal(null);
    else if (d.c === 'edit') openCustomerModal(customerById(d.id));
    else if (d.b === 'receipt') openReceiptModal(d.cid);
    else if (d.b === 'invoice') openInvoiceModal(d.cid);
    else if (d.b === 'bulk') bulkInvoices();
    else if (d.b === 'print') printInvoice(Store.getInvoices().find(function (i) { return i.id === d.id; }));
    else if (d.b === 'undo') undoInvoice(Store.getInvoices().find(function (i) { return i.id === d.id; }));
    else if (d.b === 'delreceipt') {
      if (!confirm('この入金の記録を削除しますか？')) return;
      Store.saveReceipts(Store.getReceipts().filter(function (r) { return r.id !== d.id; }));
      render();
      POS.refreshBadges();
    }
  });

  // ================= 伝票の作成・編集 =================
  /** 数量の差分（在庫の増減に使う） */
  function diffLines(oldLines, newLines) {
    var m = {};
    var info = {};
    (oldLines || []).forEach(function (l) { m[l.productId] = (m[l.productId] || 0) - l.qty; info[l.productId] = l; });
    (newLines || []).forEach(function (l) { m[l.productId] = (m[l.productId] || 0) + l.qty; info[l.productId] = l; });
    return Object.keys(m).filter(function (k) { return m[k]; }).map(function (k) {
      return { productId: k, name: info[k].name, unit: info[k].unit, qty: m[k] };
    });
  }

  function openSlipModal(orig, presetCustomerId, deliverIntent) {
    var customers = sortedCustomers();
    var isNew = !orig;
    var s = orig ? JSON.parse(JSON.stringify(orig)) : {
      customerId: presetCustomerId || (customers[0] && customers[0].id), date: wsDate >= today() ? wsDate : today(),
      lines: [], payment: null, note: '', status: 'order'
    };
    var cust = function () { return customerById(s.customerId); };
    if (!s.payment) s.payment = cust() ? cust().payment : 'credit';
    var lines = s.lines.map(function (l) {
      return { productId: l.productId, name: l.name, unit: l.unit, price: l.price, taxRate: l.taxRate, qty: l.qty, qtyText: inv().qtyInputValue(l.unit, l.qty) };
    });
    var products = POS.products().filter(function (p) { return p.unit !== 'open'; });
    var options = POS.categories().map(function (c) {
      var ps = products.filter(function (p) { return p.category === c; }).sort(function (a, b) { return a.order - b.order; });
      return ps.length ? '<optgroup label="' + esc(c) + '">' + ps.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
      }).join('') + '</optgroup>' : '';
    }).join('');

    var title = isNew ? '新規伝票' : (deliverIntent ? '納品（No.' + s.no + '）' : '伝票 No.' + s.no);
    var foot = s.status === 'delivered'
      ? '<button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">保存</button>'
      : '<button class="btn" data-act="order">受注で保存</button><button class="btn primary" data-act="deliver">納品済にする</button>';
    POS.openModal(
      '<h3>' + title + '</h3>' +
      (deliverIntent ? '<div class="sub">実際に納める重さ・数量に直してから「納品済にする」を押してください。</div>' : '') +
      '<form class="form" id="wForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>取引先<select name="customer">' + customers.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === s.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label>納品日<input type="date" name="date" value="' + esc(s.date) + '"></label>' +
      '<div><div class="wsline-head"><span>商品</span><span>数量</span><span>単価(税抜)</span><span></span></div>' +
      '<div id="wLines"></div>' +
      '<div class="radd"><select id="wSel">' + options + '</select><button type="button" class="btn" data-act="add">＋ 追加</button></div>' +
      '<div class="tot-box" id="wTot"></div></div>' +
      '<label>お支払い<div class="seg"><button type="button" class="btn small" data-pay="credit">掛け（請求書）</button>' +
      '<button type="button" class="btn small" data-pay="cash">現金（納品時に受取）</button></div></label>' +
      '<label>メモ<input name="note" value="' + esc(s.note) + '" autocomplete="off" placeholder="例：午前中に納品、骨なし"></label>' +
      '</form>' +
      '<div class="modal-foot">' + foot + '</div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'add') {
          var p = productById($('wSel').value);
          var c = cust();
          var price = (c && c.prices && c.prices[p.id]) || p.wsPrice || 0;
          lines.push({ productId: p.id, name: p.name, unit: p.unit, price: price, taxRate: p.taxRate, qty: 0, qtyText: '' });
          drawLines();
          var ins = POS.modalBody.querySelectorAll('#wLines input[data-f="q"]');
          ins[ins.length - 1].focus();
        } else if (b.dataset.del != null) {
          lines.splice(Number(b.dataset.del), 1);
          drawLines();
        } else if (b.dataset.pay) {
          s.payment = b.dataset.pay;
          drawPay();
        } else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'order') save('order');
        else if (b.dataset.act === 'deliver') save('delivered');
        else if (b.dataset.act === 'save') save('delivered');
      },
      false
    );
    var form = $('wForm').elements;
    form.customer.addEventListener('change', function () {
      s.customerId = form.customer.value;
      var c = cust();
      if (c) {
        s.payment = c.payment;
        // まだ単価を手で変えていない行は、この取引先の単価に合わせる
        lines.forEach(function (l) {
          if (l.priceEdited) return;
          var p = productById(l.productId);
          l.price = (c.prices && c.prices[l.productId]) || (p && p.wsPrice) || l.price;
        });
      }
      drawLines();
      drawPay();
    });
    POS.modalBody.oninput = function (e) {
      var i = e.target.dataset.i;
      if (i == null) return;
      var l = lines[Number(i)];
      if (e.target.dataset.f === 'q') { l.qtyText = e.target.value; l.qty = inv().parseQty(l.qtyText, l.unit); }
      else { l.price = Math.floor(Number(e.target.value) || 0); l.priceEdited = true; }
      drawTotals();
    };
    // はかりの文字列なども、入力欄を離れたら「3.25」のような表記に整える
    POS.modalBody.onchange = function (e) {
      var i = e.target.dataset.i;
      if (i == null || e.target.dataset.f !== 'q') return;
      var l = lines[Number(i)];
      if (l.qty > 0) { l.qtyText = inv().qtyInputValue(l.unit, l.qty); e.target.value = l.qtyText; }
    };

    function drawLines() {
      $('wLines').innerHTML = lines.length ? lines.map(function (l, i) {
        return '<div class="wsline"><div class="rname">' + esc(l.name) +
          '<small>' + (l.unit === 'g' ? 'kg・円/kg' : '個・円/個') + (l.taxRate === 10 ? '・税10%' : '') + '</small></div>' +
          '<input type="text" inputmode="decimal" data-i="' + i + '" data-f="q" value="' + esc(l.qtyText) + '" placeholder="' + inv().unitHint(l.unit) + '">' +
          '<input type="number" inputmode="numeric" data-i="' + i + '" data-f="p" value="' + (l.price || '') + '" placeholder="円">' +
          '<button type="button" data-del="' + i + '" aria-label="削除">×</button></div>';
      }).join('') : '<p class="note">下で商品を選んで「追加」</p>';
      drawTotals();
    }
    function calcLines() {
      return lines.map(function (l) {
        var x = { productId: l.productId, name: l.name, unit: l.unit, price: l.price, taxRate: l.taxRate, qty: l.qty };
        x.amount = Calc.wsLineAmount(x, round());
        return x;
      });
    }
    function drawTotals() {
      var t = Calc.wsTotals(calcLines(), round());
      $('wTot').innerHTML = '<div class="sum-row"><span>小計（税抜）</span><span class="num">' + yen(t.subtotal) + '</span></div>' +
        t.byRate.map(function (r) {
          return '<div class="sum-row"><span>' + r.rate + '%対象 ' + yen(r.amount) + '</span><span class="num">消費税 ' + yen(r.tax) + '</span></div>';
        }).join('') +
        '<div class="sum-row total"><span>合計（税込）</span><span class="num">' + yen(t.total) + '</span></div>';
    }
    function drawPay() {
      POS.modalBody.querySelectorAll('[data-pay]').forEach(function (x) { x.classList.toggle('on', x.dataset.pay === s.payment); });
    }

    function save(status) {
      if (!s.customerId || !cust()) { alert('取引先を選んでください'); return; }
      if (!lines.length) { alert('商品を追加してください'); return; }
      for (var i = 0; i < lines.length; i++) {
        if (!(lines[i].qty > 0)) { alert('「' + lines[i].name + '」の数量を入れてください'); return; }
        if (!(lines[i].price > 0) && !confirm('「' + lines[i].name + '」の単価が0円です。このまま保存しますか？')) return;
      }
      var c = cust();
      var newLines = calcLines();
      var wasDelivered = orig && orig.status === 'delivered';
      s.customerName = c.name;
      s.date = form.date.value || today();
      s.note = form.note.value.trim();
      s.lines = newLines;
      s.totals = Calc.wsTotals(newLines, round());
      s.status = status;
      if (status === 'delivered' && !wasDelivered) s.deliveredAt = new Date().toISOString();

      var list = Store.getSlips();
      if (isNew) {
        s.id = 'W' + Date.now();
        s.no = Store.nextSlipNo();
        s.createdAt = new Date().toISOString();
        list.push(s);
      } else {
        list[list.findIndex(function (x) { return x.id === s.id; })] = s;
      }
      Store.saveSlips(list);

      // 在庫：納品済の分だけ減らす（修正時は差分）
      var diff = diffLines(wasDelivered ? orig.lines : [], status === 'delivered' ? newLines : []);
      if (diff.length) POS.stockChange(diff, -1, { type: 'wholesale', ref: '卸No.' + s.no, note: c.name });

      // 取引先ごとの単価を記憶
      c.prices = c.prices || {};
      newLines.forEach(function (l) { if (l.price > 0) c.prices[l.productId] = l.price; });
      Store.saveCustomers(Store.getCustomers());

      POS.closeModal();
      wsDate = s.date;
      scope = 'day';
      tab = 'slips';
      render();
      POS.refreshBadges();
      if (status === 'delivered' && !wasDelivered) {
        POS.toast('納品済にしました' + (s.payment === 'cash' ? '（現金 ' + yen(s.totals.total) + ' を受け取ってください）' : ''));
      } else POS.toast('保存しました');
    }

    drawLines();
    drawPay();
  }

  function cancelSlip(s) {
    if (s.invoiceId) { alert('請求書に含まれている伝票は取り消せません。先に請求書を作り直してください。'); return; }
    if (!confirm('伝票No.' + s.no + '（' + s.customerName + '・' + yen(s.totals.total) + '）を取り消しますか？' +
      (s.status === 'delivered' ? '\n在庫は元に戻ります。' : ''))) return;
    var list = Store.getSlips();
    var x = list.find(function (y) { return y.id === s.id; });
    if (x.status === 'delivered') POS.stockChange(diffLines(x.lines, []), -1, { type: 'wholesale', ref: '卸No.' + x.no, note: '取消' });
    x.status = 'cancelled';
    x.cancelledAt = new Date().toISOString();
    Store.saveSlips(list);
    render();
    POS.refreshBadges();
    POS.toast('取り消しました');
  }

  // ================= 取引先 =================
  function openCustomerModal(orig) {
    var isNew = !orig;
    var c = orig ? JSON.parse(JSON.stringify(orig)) : { name: '', person: '', tel: '', address: '', payment: 'credit', closingDay: 31, note: '', prices: {} };
    var days = [5, 10, 15, 20, 25, 31];
    var used = !isNew && Store.getSlips().some(function (s) { return s.customerId === c.id; });
    POS.openModal(
      '<h3>' + (isNew ? '取引先を追加' : '取引先の編集') + '</h3>' +
      '<form class="form" id="cForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>店名・会社名<input name="name" value="' + esc(c.name) + '" autocomplete="off" placeholder="例：居酒屋 とりまる"></label>' +
      '<label>ご担当者<input name="person" value="' + esc(c.person) + '" autocomplete="off"></label>' +
      '<label>電話番号<input name="tel" type="tel" inputmode="tel" value="' + esc(c.tel) + '" autocomplete="off"></label>' +
      '<label>住所<input name="address" value="' + esc(c.address) + '" autocomplete="off"></label>' +
      '<label>お支払い<div class="seg"><button type="button" class="btn small" data-pay="credit">掛け（締め日に請求）</button>' +
      '<button type="button" class="btn small" data-pay="cash">現金（納品時）</button></div></label>' +
      '<label id="cClose">締め日<select name="closingDay">' + days.map(function (d) {
        return '<option value="' + d + '"' + (d === c.closingDay ? ' selected' : '') + '>' + (d === 31 ? '月末' : '毎月' + d + '日') + '</option>';
      }).join('') + '</select></label>' +
      '<label>メモ<input name="note" value="' + esc(c.note) + '" autocomplete="off"></label>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew || used ? '<button class="btn" data-act="cancel">キャンセル</button>' : '<button class="btn danger-outline" data-act="del">削除</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.pay) { c.payment = b.dataset.pay; draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'del') {
          if (!confirm('「' + c.name + '」を削除しますか？')) return;
          Store.saveCustomers(Store.getCustomers().filter(function (x) { return x.id !== c.id; }));
          POS.closeModal();
          render();
        } else if (b.dataset.act === 'save') {
          var f = $('cForm').elements;
          c.name = f.name.value.trim();
          if (!c.name) { alert('店名を入力してください'); return; }
          c.person = f.person.value.trim();
          c.tel = f.tel.value.trim();
          c.address = f.address.value.trim();
          c.closingDay = Number(f.closingDay.value);
          c.note = f.note.value.trim();
          var list = Store.getCustomers();
          if (isNew) { c.id = 'C' + Date.now(); list.push(c); }
          else list[list.findIndex(function (x) { return x.id === c.id; })] = c;
          Store.saveCustomers(list);
          POS.closeModal();
          render();
          POS.toast('保存しました');
        }
      },
      false
    );
    function draw() {
      POS.modalBody.querySelectorAll('[data-pay]').forEach(function (x) { x.classList.toggle('on', x.dataset.pay === c.payment); });
      $('cClose').style.display = c.payment === 'credit' ? '' : 'none';
    }
    draw();
  }

  // ================= 入金 =================
  function openReceiptModal(presetId) {
    var customers = sortedCustomers().filter(function (c) { return c.payment === 'credit' || c.id === presetId; });
    if (!customers.length) { alert('掛け売りの取引先がありません。'); return; }
    var cid = presetId || customers[0].id;
    var method = 'transfer';
    POS.openModal(
      '<h3>入金を登録</h3>' +
      '<form class="form" id="rcForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>取引先<select name="customer">' + customers.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cid ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<p class="note" id="rcBal"></p>' +
      '<label>入金日<input type="date" name="date" value="' + today() + '"></label>' +
      '<label>金額<input type="number" inputmode="numeric" name="amount" min="1"></label>' +
      '<label>方法<div class="seg"><button type="button" class="btn small" data-m="transfer">振込</button>' +
      '<button type="button" class="btn small" data-m="cash">現金</button><button type="button" class="btn small" data-m="other">その他</button></div></label>' +
      '<label>メモ<input name="note" autocomplete="off" placeholder="例：11月分"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">登録</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.m) { method = b.dataset.m; draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') {
          var f = $('rcForm').elements;
          var amount = Math.floor(Number(f.amount.value) || 0);
          if (!(amount > 0)) { alert('金額を入力してください'); return; }
          var list = Store.getReceipts();
          list.push({ id: 'P' + Date.now(), customerId: f.customer.value, date: f.date.value || today(), amount: amount, method: method, note: f.note.value.trim() });
          Store.saveReceipts(list);
          POS.closeModal();
          render();
          POS.toast('入金を登録しました' + (method === 'cash' ? '（レジ内現金に含めます）' : ''));
        }
      },
      false
    );
    var f = $('rcForm').elements;
    f.customer.addEventListener('change', draw);
    function draw() {
      POS.modalBody.querySelectorAll('[data-m]').forEach(function (x) { x.classList.toggle('on', x.dataset.m === method); });
      var bal = Calc.receivableBalance(f.customer.value, Store.getSlips(), Store.getReceipts());
      $('rcBal').textContent = '現在の売掛残高：' + yen(bal);
    }
    draw();
  }

  // ================= 請求書 =================
  function createInvoice(c, periodTo) {
    var inv0 = Calc.buildInvoice(c.id, periodTo, Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
    if (!inv0.slipIds.length && !inv0.receiptIds.length && !inv0.carry) return null;
    var i = Object.assign({ id: 'I' + Date.now() + Math.floor(Math.random() * 1000), no: Store.nextInvoiceNo(), issueDate: today(), customerName: c.name }, inv0);
    var invs = Store.getInvoices();
    invs.push(i);
    Store.saveInvoices(invs);
    var slips = Store.getSlips();
    slips.forEach(function (s) { if (i.slipIds.indexOf(s.id) >= 0) s.invoiceId = i.id; });
    Store.saveSlips(slips);
    var rcs = Store.getReceipts();
    rcs.forEach(function (r) { if (i.receiptIds.indexOf(r.id) >= 0) r.invoiceId = i.id; });
    Store.saveReceipts(rcs);
    return i;
  }

  function openInvoiceModal(presetId) {
    var customers = sortedCustomers().filter(function (c) { return c.payment === 'credit'; });
    if (!customers.length) { alert('掛け売りの取引先がありません。'); return; }
    var cid = presetId || customers[0].id;
    POS.openModal(
      '<h3>請求書を作成</h3>' +
      '<form class="form" id="ivForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>取引先<select name="customer">' + customers.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cid ? ' selected' : '') + '>' + esc(c.name) + '（' + closingText(c) + '）</option>';
      }).join('') + '</select></label>' +
      '<label>締め日（この日までの納品・入金をまとめます）<input type="date" name="to"></label></form>' +
      '<div class="tot-box" id="ivPrev"></div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" id="ivOk" data-act="save">作成して印刷</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') POS.closeModal();
        if (b.dataset.act === 'save') {
          var i = createInvoice(customerById(f.customer.value), f.to.value);
          if (!i) { alert('請求する内容がありません'); return; }
          POS.closeModal();
          tab = 'billing';
          render();
          printInvoice(i);
        }
      },
      false
    );
    var f = $('ivForm').elements;
    function setDefaultDate() { f.to.value = Calc.lastClosingDate(today(), customerById(f.customer.value).closingDay); }
    f.customer.addEventListener('change', function () { setDefaultDate(); draw(); });
    f.to.addEventListener('change', draw);
    function draw() {
      var x = Calc.buildInvoice(f.customer.value, f.to.value || today(), Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
      $('ivPrev').innerHTML =
        '<div class="sum-row"><span>前回請求額</span><span class="num">' + yen(x.prevBilled) + '</span></div>' +
        '<div class="sum-row"><span>入金額</span><span class="num">' + yen(x.received) + '</span></div>' +
        '<div class="sum-row"><span>繰越額</span><span class="num">' + yen(x.carry) + '</span></div>' +
        '<div class="sum-row"><span>今回お買上（' + x.slipIds.length + '伝票・税抜）</span><span class="num">' + yen(x.subtotal) + '</span></div>' +
        '<div class="sum-row"><span>消費税</span><span class="num">' + yen(x.tax) + '</span></div>' +
        '<div class="sum-row total"><span>今回請求額</span><span class="num">' + yen(x.billed) + '</span></div>';
      $('ivOk').disabled = !x.slipIds.length && !x.receiptIds.length && !x.carry;
    }
    setDefaultDate();
    draw();
  }

  function bulkInvoices() {
    var made = [];
    sortedCustomers().forEach(function (c) {
      if (c.payment !== 'credit') return;
      var i = createInvoice(c, Calc.lastClosingDate(today(), c.closingDay));
      if (i) made.push(i);
    });
    tab = 'billing';
    render();
    if (!made.length) { alert('締め日を過ぎて、まだ請求していない取引先はありません。'); return; }
    POS.toast(made.length + '件の請求書を作成しました');
    printInvoices(made);
  }

  function undoInvoice(i) {
    if (!confirm('請求書No.' + i.no + '（' + i.customerName + '）を取り消して作り直せるようにしますか？')) return;
    Store.saveInvoices(Store.getInvoices().filter(function (x) { return x.id !== i.id; }));
    var slips = Store.getSlips();
    slips.forEach(function (s) { if (s.invoiceId === i.id) delete s.invoiceId; });
    Store.saveSlips(slips);
    var rcs = Store.getReceipts();
    rcs.forEach(function (r) { if (r.invoiceId === i.id) delete r.invoiceId; });
    Store.saveReceipts(rcs);
    render();
    POS.toast('請求書を取り消しました');
  }

  // ================= 帳票（A4） =================
  function fromBlock() {
    var st = settings();
    return '<div class="from"><div class="name">' + esc(st.storeName) + '</div>' +
      (st.address ? esc(st.address) + '<br>' : '') + (st.tel ? 'TEL ' + esc(st.tel) + '<br>' : '') +
      (st.invoiceNo ? '登録番号 ' + esc(st.invoiceNo) : '') + '</div>';
  }
  function jpDate(d) {
    var p = d.split('-').map(Number);
    return p[0] + '年' + p[1] + '月' + p[2] + '日';
  }
  function rateRows(byRate) {
    return byRate.map(function (r) {
      return '<tr><th>' + r.rate + '%対象' + (r.rate === 8 ? '（軽減税率）' : '') + '</th><td>' + yen(r.amount) + '</td><th>消費税（' + r.rate + '%）</th><td>' + yen(r.tax) + '</td></tr>';
    }).join('');
  }
  function lineRows(lines, withDate, date, no) {
    return lines.map(function (l, idx) {
      return '<tr>' + (withDate ? '<td>' + (idx === 0 ? date.slice(5).replace('-', '/') : '') + '</td><td>' + (idx === 0 ? no : '') + '</td>' : '') +
        '<td>' + esc(l.name) + (l.taxRate === 8 ? ' ※' : '') + '</td><td class="r">' + qtyText(l) + '</td>' +
        '<td class="r">' + unitPriceText(l) + '</td><td class="r">' + yen(l.amount) + '</td></tr>';
    }).join('');
  }

  function slipDocHtml(s) {
    var c = customerById(s.customerId);
    var isOrder = s.status === 'order';
    var h = '<h1>' + (isOrder ? '御注文控' : '納品書') + '</h1>' +
      '<div class="head"><div><div class="to">' + esc(c ? c.name : s.customerName) + '　御中</div>' +
      '<p>' + (isOrder ? '下記のとおりご注文を承りました。' : '下記のとおり納品いたします。') + '</p>' +
      '<div>合計金額（税込）<span class="big-total">' + yen(s.totals.total) + '</span></div></div>' +
      '<div><div class="meta">No. ' + s.no + '<br>' + (isOrder ? '納品予定日 ' : '納品日 ') + jpDate(s.date) + '</div>' + fromBlock() + '</div></div>' +
      '<table><thead><tr><th>品名</th><th>数量</th><th>単価（税抜）</th><th>金額（税抜）</th></tr></thead><tbody>' +
      lineRows(s.lines, false) + '</tbody></table>' +
      '<table class="summary"><tbody>' + rateRows(s.totals.byRate) +
      '<tr><th>小計（税抜）</th><td>' + yen(s.totals.subtotal) + '</td><th>合計（税込）</th><td><b>' + yen(s.totals.total) + '</b></td></tr></tbody></table>' +
      '<div class="notes">※は軽減税率（8%）対象商品です。<br>お支払い：' + (s.payment === 'cash' ? '現金（納品時）' : '掛け（' + (c ? closingText(c) : '') + '）') +
      (s.note ? '<br>備考：' + esc(s.note) : '') + '</div>';
    return h;
  }
  function printSlip(s) { POS.printDoc(slipDocHtml(s)); }

  function invoiceDocHtml(i) {
    var c = customerById(i.customerId);
    var slips = Store.getSlips().filter(function (s) { return i.slipIds.indexOf(s.id) >= 0; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.no - b.no; });
    var st = settings();
    var h = '<h1>請求書</h1>' +
      '<div class="head"><div><div class="to">' + esc(c ? c.name : i.customerName) + '　御中</div>' +
      '<p>' + jpDate(i.periodTo) + '締め分を下記のとおりご請求申し上げます。</p>' +
      '<div>今回御請求額<span class="big-total">' + yen(i.billed) + '</span></div></div>' +
      '<div><div class="meta">請求書No. ' + i.no + '<br>発行日 ' + jpDate(i.issueDate) + '</div>' + fromBlock() + '</div></div>' +
      '<table class="summary"><thead><tr><th>前回御請求額</th><th>御入金額</th><th>繰越金額</th><th>今回お買上額（税抜）</th><th>消費税額</th><th>今回御請求額</th></tr></thead>' +
      '<tbody><tr><td>' + yen(i.prevBilled) + '</td><td>' + yen(i.received) + '</td><td>' + yen(i.carry) + '</td><td>' + yen(i.subtotal) +
      '</td><td>' + yen(i.tax) + '</td><td><b>' + yen(i.billed) + '</b></td></tr></tbody></table>' +
      '<table><thead><tr><th>日付</th><th>伝票No</th><th>品名</th><th>数量</th><th>単価（税抜）</th><th>金額（税抜）</th></tr></thead><tbody>' +
      slips.map(function (s) { return lineRows(s.lines, true, s.date, s.no); }).join('') +
      (slips.length ? '' : '<tr><td colspan="6">今回お買上はありません</td></tr>') +
      '</tbody></table>' +
      '<table class="summary"><tbody>' + rateRows(i.byRate) +
      '<tr><th>今回お買上額（税込）</th><td colspan="3"><b>' + yen(i.purchase) + '</b></td></tr></tbody></table>' +
      '<div class="notes">対象期間：' + jpDate(i.periodFrom) + '〜' + jpDate(i.periodTo) + '<br>※は軽減税率（8%）対象商品です。' +
      (st.bankInfo ? '<br>お振込先：' + esc(st.bankInfo).replace(/\n/g, '<br>') : '') + '</div>';
    return h;
  }
  function printInvoice(i) { POS.printDoc(invoiceDocHtml(i)); }
  function printInvoices(list) {
    POS.printDoc(list.map(invoiceDocHtml).join('<div style="page-break-after:always"></div>'));
  }

  // ================= CSV =================
  function exportMonthCsv() {
    var ym = wsDate.slice(0, 7);
    var rows = [['納品日', '伝票No', '状態', '取引先', '支払', '商品', '税率', '数量', '単位', '単価(税抜)', '金額(税抜)', '伝票合計(税込)', '請求書']];
    Store.getSlips().filter(function (s) { return s.date.slice(0, 7) === ym; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.no - b.no; })
      .forEach(function (s) {
        var invNo = '';
        if (s.invoiceId) {
          var iv = Store.getInvoices().find(function (i) { return i.id === s.invoiceId; });
          invNo = iv ? iv.no : '';
        }
        s.lines.forEach(function (l) {
          rows.push([s.date, s.no, STATUS[s.status], s.customerName, PAY[s.payment], l.name, l.taxRate,
            l.unit === 'g' ? l.qty / 1000 : l.qty, l.unit === 'g' ? 'kg' : '個', l.price, l.amount, s.totals.total, invNo]);
        });
      });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    POS.saveFile('nikupos-wholesale-' + ym + '.csv', csv, 'text/csv');
  }
});
