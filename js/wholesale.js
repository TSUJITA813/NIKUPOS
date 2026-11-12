/*
 * 卸（飲食店などへの販売）
 *  伝票：受注 → 納品（実際の重さに修正）→ 納品書印刷。納品で在庫が減る
 *  得意先：単価（得意先ごとに最後に使った単価を記憶）、支払条件（掛け：締め日・支払期限／現金）、与信限度額、
 *          売掛金（未請求・請求済未入金・支払期限切れ）、得意先元帳
 *  請求・入金：締め日ごとの請求書（適格請求書・ワンタップ発行）、入金の記録と請求書への消込
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
  var METHOD = { cash: '現金', transfer: '振込', other: 'その他', fee: '振込手数料（当方負担）' };

  function noOf(x) { return x.noLabel || x.no; }
  function today() { return POS.localDate(new Date()); }
  function round() { return POS.round(); }
  function settings() { return POS.settings(); }
  function productById(id) { return POS.products().find(function (p) { return p.id === id; }); }
  function customerById(id) { return Store.getCustomers().find(function (c) { return c.id === id; }); }
  function kg(g) { return (Math.round(g) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) + 'kg'; }
  function qtyText(l) { return l.unit === 'g' ? kg(l.qty) : num(l.qty) + '個'; }
  function unitPriceText(l) { return yen(l.price) + (l.unit === 'g' ? '/kg' : '/個'); }
  // 支払期限の選択肢 [何か月後, 日(31=末), 表示]
  var PAY_TERMS = [[0, 31, '当月末'], [1, 5, '翌月5日'], [1, 10, '翌月10日'], [1, 15, '翌月15日'], [1, 20, '翌月20日'], [1, 25, '翌月25日'],
    [1, 31, '翌月末'], [2, 10, '翌々月10日'], [2, 31, '翌々月末']];
  function payMonths(c) { return c.payMonths != null ? c.payMonths : 1; }
  function payDay(c) { return c.payDay != null ? c.payDay : 31; }
  /** 例：「月末締め・翌月末払い」 */
  function termsText(c) {
    var t = PAY_TERMS.find(function (x) { return x[0] === payMonths(c) && x[1] === payDay(c); });
    return (c.closingDay >= 29 ? '月末' : c.closingDay + '日') + '締め・' + (t ? t[2] : '') + '払い';
  }
  function closingText(c) {
    var mode = c.priceMode === 'incl' ? '・税込単価' : '';
    if (c.payment !== 'credit') return '現金（納品時）' + mode;
    return '掛け・' + termsText(c) + mode;
  }
  /** 振込手数料として処理できる差額の上限 */
  function feeMax() { var v = settings().feeMax; return v == null || v === '' ? 1000 : Number(v) || 0; }
  function monthMemo(i) { return i.periodTo.slice(0, 7).replace('-', '年') + '月締め分'; }
  function honor(c) { return (c && c.honorific) || '御中'; }
  function statusPill(st) {
    if (!st) return '';
    if (st.status === 'paid') return '<span class="pill ok">入金済</span>';
    if (st.overdue) return '<span class="pill">期限切れ 残' + yen(st.remaining) + '</span>';
    if (st.status === 'partial') return '<span class="pill warn">一部入金 残' + yen(st.remaining) + '</span>';
    return '<span class="pill warn">未入金</span>';
  }
  /** インボイス登録番号が未設定なら確認 */
  function checkInvoiceNo() {
    if (settings().invoiceNo) return true;
    return confirm('設定で「インボイス登録番号」が入っていません。このままでは適格請求書になりません。\n続けて発行しますか？');
  }
  function modeOf(x) { return x && x.priceMode === 'incl' ? 'incl' : 'excl'; }
  function modeLabel(m) { return m === 'incl' ? '税込' : '税抜'; }
  /** 得意先に合わせた単価の初期値（記憶した単価 → 商品マスタの卸単価。税込の得意先は税込に換算） */
  function defaultPrice(c, p) {
    if (c && c.prices && c.prices[p.id]) return c.prices[p.id];
    var base = p.wsPrice || 0;
    return modeOf(c) === 'incl' ? Math.round((base * (100 + p.taxRate)) / 100) : base;
  }
  function sortedCustomers() {
    return Store.getCustomers().slice().sort(function (a, b) {
      return (a.code || '\uffff').localeCompare(b.code || '\uffff', 'ja', { numeric: true }) ||
        (a.kana || a.name).localeCompare(b.kana || b.name, 'ja');
    });
  }
  function summaryOf(c) {
    return Calc.receivableSummary(c.id, Store.getSlips(), Store.getReceipts(), Store.getInvoices(), today());
  }
  /** 締め日を過ぎて、まだ請求していない納品がある掛けの得意先 */
  function pendingClosings() {
    return sortedCustomers().filter(function (c) {
      if (c.payment !== 'credit') return false;
      var x = Calc.buildInvoice(c.id, Calc.lastClosingDate(today(), c.closingDay), Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
      return x.slipIds.length > 0;
    });
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
      [['slips', '伝票（受注・納品）'], ['customers', '得意先'], ['billing', '売掛・請求・入金']].map(function (t) {
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
      '<div class="li-sub">No.' + noOf(s) + '・' + POS.weekday(s.date) + (s.status === 'order' ? ' 納品予定' : '') + (modeOf(s) === 'incl' ? '・税込単価' : '・税抜 ' + yen(s.totals.subtotal)) + '</div>' +
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
      h += '<p class="note">まず「得意先」タブで、卸先のお店を登録してください。</p>';
    }
    h += list.length ? list.map(slipCard).join('') : '<p class="note">伝票はありません。</p>';
    return h;
  }

  // ---------- 得意先一覧 ----------
  function renderCustomers() {
    var h = '<div class="toolbar"><h2>得意先</h2><span class="spacer"></span>' +
      '<button class="btn primary small" data-c="new">＋ 得意先を追加</button></div>';
    var list = sortedCustomers();
    if (!list.length) return h + '<p class="note">得意先がありません。「＋ 得意先を追加」から登録してください。</p>';
    h += list.map(function (c) {
      var credit = c.payment === 'credit';
      var sm = credit ? summaryOf(c) : null;
      var over = credit && c.creditLimit > 0 && sm.balance > c.creditLimit;
      return '<div class="list-item"><div class="li-top">' +
        (c.code ? '<span class="pill gray">' + esc(c.code) + '</span>' : '') +
        '<span class="li-title">' + esc(c.name) + '</span>' +
        '<span class="pill gray">' + closingText(c) + '</span>' +
        (credit ? '<span class="li-amt' + (sm.balance < 0 ? ' neg' : '') + '">売掛残 ' + yen(sm.balance) + '</span>' : '') + '</div>' +
        (credit ? '<div class="li-sub">未請求 ' + yen(sm.unbilled) + '・請求済未入金 ' + yen(sm.billedUnpaid) +
          (sm.overdue ? '・<b class="neg">期限切れ ' + yen(sm.overdue) + '</b>' : '') +
          (sm.nextDue ? '・次の支払期限 ' + POS.weekday(sm.nextDue) : '') +
          (c.creditLimit ? '・与信限度 ' + yen(c.creditLimit) + (over ? ' <b class="neg">超過</b>' : '') : '') + '</div>' : '') +
        '<div class="li-sub">' + [c.person && esc(c.person) + ' 様', c.tel && '<a class="resv-tel" href="tel:' + esc(c.tel.replace(/[^\d+]/g, '')) + '">' + esc(c.tel) + '</a>', esc(c.address || '')].filter(Boolean).join('・') + '</div>' +
        '<div class="btn-row"><button class="btn" data-s="new" data-cid="' + c.id + '">伝票を作成</button>' +
        (credit ? '<button class="btn primary" data-b="oneinv" data-cid="' + c.id + '">締め分の請求書</button>' +
          '<button class="btn" data-b="receipt" data-cid="' + c.id + '">入金を登録</button>' : '') +
        '<button class="btn" data-c="ledger" data-id="' + c.id + '">得意先元帳</button>' +
        '<button class="btn" data-c="edit" data-id="' + c.id + '">編集</button>' +
        '</div></div>';
    }).join('');
    return h;
  }

  // ---------- 売掛・請求・入金 ----------
  function renderBilling() {
    var credits = sortedCustomers().filter(function (c) { return c.payment === 'credit'; });
    var sums = {};
    var tot = { balance: 0, unbilled: 0, billedUnpaid: 0, overdue: 0 };
    credits.forEach(function (c) {
      var x = sums[c.id] = summaryOf(c);
      Object.keys(tot).forEach(function (k) { tot[k] += x[k]; });
    });
    var pend = pendingClosings();
    var h = '';
    if (pend.length) {
      h += '<div class="list-item" style="border-left:6px solid var(--accent)"><div class="li-top"><span class="li-title">締め日を過ぎた未請求があります（' + pend.length + '社）</span></div>' +
        '<div class="li-sub">' + pend.map(function (c) { return esc(c.name); }).join('、') + '</div>' +
        '<div class="btn-row"><button class="btn primary" data-b="bulk">' + pend.length + '社分の請求書をまとめて発行・印刷</button></div></div>';
    }
    h += '<div class="cards">' +
      POS.card('売掛金の合計', yen(tot.balance)) +
      POS.card('うち支払期限切れ', '<span class="' + (tot.overdue ? 'neg' : '') + '">' + yen(tot.overdue) + '</span>') +
      POS.card('請求済・未入金', yen(tot.billedUnpaid)) +
      POS.card('未請求（締め前）', yen(tot.unbilled)) + '</div>';
    h += '<div class="btn-row"><button class="btn" data-b="invoice">請求書を作成（締め日を指定）</button>' +
      '<button class="btn" data-b="receipt">入金を登録</button></div>';

    h += '<h2>得意先ごとの売掛金</h2>';
    h += credits.length ? '<div class="table-wrap"><table><thead><tr><th>得意先</th><th class="r">売掛残</th><th class="r">期限切れ</th>' +
      '<th class="r">請求済未入金</th><th class="r">未請求</th><th>次の支払期限</th></tr></thead><tbody>' +
      credits.map(function (c) {
        var x = sums[c.id];
        return '<tr data-cid="' + c.id + '" style="cursor:pointer"><td>' + esc(c.name) + '</td><td class="r num"><b>' + yen(x.balance) + '</b></td>' +
          '<td class="r num' + (x.overdue ? ' neg' : '') + '">' + (x.overdue ? yen(x.overdue) : '—') + '</td>' +
          '<td class="r num">' + yen(x.billedUnpaid) + '</td><td class="r num">' + yen(x.unbilled) + '</td>' +
          '<td>' + (x.nextDue ? POS.weekday(x.nextDue) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="note">行をタップすると得意先元帳を表示します。入金は古い請求書から順に充てています。</p>'
      : '<p class="note">掛け売りの得意先はありません。</p>';

    var invs = Store.getInvoices().slice().sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || '') || b.no - a.no; }).slice(0, 50);
    var latest = {};
    Store.getInvoices().forEach(function (i) { if (!latest[i.customerId]) latest[i.customerId] = Calc.latestInvoice(i.customerId, Store.getInvoices()); });
    h += '<h2>請求書</h2>';
    h += invs.length ? invs.map(function (i) {
      var st = sums[i.customerId] ? sums[i.customerId].invoices[i.id] : null;
      return '<div class="list-item"><div class="li-top"><span class="li-title">' + esc(i.customerName) + '</span>' +
        statusPill(st) +
        '<span class="li-sub">No.' + noOf(i) + '・' + i.periodTo + ' 締め</span>' +
        '<span class="li-amt">' + yen(i.billed) + '</span></div>' +
        '<div class="li-sub">今回お買上 ' + yen(i.purchase) + '（うち消費税 ' + yen(i.tax) + '）・繰越 ' + yen(i.carry) +
        (i.dueDate ? '・支払期限 ' + POS.weekday(i.dueDate) : '') + '・発行 ' + i.issueDate + '</div>' +
        '<div class="btn-row"><button class="btn" data-b="print" data-id="' + i.id + '">印刷</button>' +
        (st && st.status === 'partial' && st.remaining <= feeMax()
          ? '<button class="btn primary" data-b="fee" data-id="' + i.id + '">差額 ' + yen(st.remaining) + ' を振込手数料で処理</button>' : '') +
        (st && st.remaining > 0 ? '<button class="btn' + (st.status === 'partial' && st.remaining <= feeMax() ? '' : ' primary') + '" data-b="paid" data-id="' + i.id + '">入金済にする（' + yen(st.remaining) + '）</button>' : '') +
        (latest[i.customerId] === i ? '<button class="btn danger-outline" data-b="undo" data-id="' + i.id + '">作り直す（取消）</button>' : '') +
        '</div></div>';
    }).join('') : '<p class="note">まだ請求書はありません。</p>';

    var rcs = Store.getReceipts().slice().sort(function (a, b) { return b.date.localeCompare(a.date) || (b.id < a.id ? -1 : 1); }).slice(0, 50);
    h += '<h2>入金</h2>';
    h += rcs.length ? '<div class="table-wrap"><table><thead><tr><th>日付</th><th>得意先</th><th>方法</th><th class="r">金額</th><th></th></tr></thead><tbody>' +
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
    var tr = e.target.closest('tr[data-cid]');
    if (tr && !e.target.closest('button')) { openLedger(customerById(tr.dataset.cid)); return; }
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
    else if (d.c === 'ledger') openLedger(customerById(d.id));
    else if (d.b === 'oneinv') oneTapInvoice(customerById(d.cid));
    else if (d.b === 'paid') markPaid(Store.getInvoices().find(function (i) { return i.id === d.id; }));
    else if (d.b === 'fee') feeOff(Store.getInvoices().find(function (i) { return i.id === d.id; }));
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
    if (!s.priceMode) s.priceMode = isNew ? modeOf(cust()) : 'excl';
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

    var title = isNew ? '新規伝票' : (deliverIntent ? '納品（No.' + noOf(s) + '）' : '伝票 No.' + noOf(s));
    var foot = s.status === 'delivered'
      ? '<button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">保存</button>'
      : '<button class="btn" data-act="order">受注で保存</button><button class="btn primary" data-act="deliver">納品済にする</button>';
    POS.openModal(
      '<h3>' + title + '</h3>' +
      (deliverIntent ? '<div class="sub">実際に納める重さ・数量に直してから「納品済にする」を押してください。</div>' : '') +
      '<form class="form" id="wForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>得意先<select name="customer">' + customers.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === s.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label>納品日<input type="date" name="date" value="' + esc(s.date) + '"></label>' +
      '<div><div class="wsline-head"><span>商品</span><span>数量</span><span id="wPriceHead"></span><span></span></div>' +
      '<div id="wLines"></div>' +
      '<div class="radd"><select id="wSel">' + options + '</select><button type="button" class="btn" data-act="add">＋ 追加</button></div>' +
      '<div class="tot-box" id="wTot"></div></div>' +
      '<label>お支払い<div class="seg"><button type="button" class="btn small" data-pay="credit">掛け（請求書）</button>' +
      '<button type="button" class="btn small" data-pay="cash">現金（納品時に受取）</button></div></label>' +
      '<label>メモ<input name="note" value="' + esc(s.note) + '" autocomplete="off" placeholder="例：午前中に納品、骨なし"></label>' +
      (s.status !== 'delivered' ? '<label class="check"><input type="checkbox" id="wAutoPrint"' + (autoSlipPrint() ? ' checked' : '') + '> 納品済にしたら、すぐ納品書を印刷する</label>' : '') +
      '</form>' +
      '<div class="modal-foot">' + foot + '</div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'add') {
          var p = productById($('wSel').value);
          var c = cust();
          var price = defaultPrice(c, p);
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
        s.priceMode = modeOf(c);
        // まだ単価を手で変えていない行は、この得意先の単価に合わせる
        lines.forEach(function (l) {
          if (l.priceEdited) return;
          var p = productById(l.productId);
          if (p) l.price = defaultPrice(c, p);
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
        var x = { productId: l.productId, name: l.name, unit: l.unit, price: l.price, taxRate: l.taxRate, qty: l.qty, priceMode: s.priceMode };
        x.amount = Calc.wsLineAmount(x, round());
        if (l.cost != null) x.cost = l.cost; // 納品済みの伝票を直しても、納品時の原価はそのまま
        return x;
      });
    }
    function drawTotals() {
      var t = Calc.wsTotals(calcLines(), round());
      var incl = s.priceMode === 'incl';
      $('wPriceHead').textContent = '単価(' + modeLabel(s.priceMode) + ')';
      $('wTot').innerHTML = (incl ? '' : '<div class="sum-row"><span>小計（税抜）</span><span class="num">' + yen(t.subtotal) + '</span></div>') +
        t.byRate.map(function (r) {
          return incl
            ? '<div class="sum-row"><span>' + r.rate + '%対象（税込） ' + yen(r.incl) + '</span><span class="num">うち消費税 ' + yen(r.tax) + '</span></div>'
            : '<div class="sum-row"><span>' + r.rate + '%対象 ' + yen(r.amount) + '</span><span class="num">消費税 ' + yen(r.tax) + '</span></div>';
        }).join('') +
        '<div class="sum-row total"><span>合計（税込）</span><span class="num">' + yen(t.total) + '</span></div>';
    }
    function drawPay() {
      POS.modalBody.querySelectorAll('[data-pay]').forEach(function (x) { x.classList.toggle('on', x.dataset.pay === s.payment); });
    }

    function save(status) {
      if (!s.customerId || !cust()) { alert('得意先を選んでください'); return; }
      if (!lines.length) { alert('商品を追加してください'); return; }
      for (var i = 0; i < lines.length; i++) {
        if (!(lines[i].qty > 0)) { alert('「' + lines[i].name + '」の数量を入れてください'); return; }
        if (!(lines[i].price > 0) && !confirm('「' + lines[i].name + '」の単価が0円です。このまま保存しますか？')) return;
      }
      var c = cust();
      var newLines = calcLines();
      var wasDelivered = orig && orig.status === 'delivered';
      // 与信限度額（掛けで売ってよい上限）の確認
      if (s.payment === 'credit' && c.creditLimit > 0) {
        var t0 = Calc.wsTotals(newLines, round()).total;
        var bal = Calc.receivableBalance(c.id, Store.getSlips(), Store.getReceipts()) - (wasDelivered && orig.payment === 'credit' ? orig.totals.total : 0);
        if (bal + t0 > c.creditLimit &&
          !confirm(c.name + ' の売掛金が与信限度額を超えます。\n売掛残 ' + yen(bal) + ' ＋ 今回 ' + yen(t0) + ' ＞ 限度 ' + yen(c.creditLimit) + '\nこのまま保存しますか？')) return;
      }
      var printAfter = $('wAutoPrint') ? $('wAutoPrint').checked : false;
      if ($('wAutoPrint')) setAutoSlipPrint(printAfter);
      s.customerName = c.name;
      s.date = form.date.value || today();
      s.note = form.note.value.trim();
      // 納品したときの原価（税抜・1kg／1個あたり）を記録（利益の計算に使う）
      if (status === 'delivered') newLines.forEach(function (l) {
        if (l.cost != null || (l.unit !== 'g' && l.unit !== 'pc')) return;
        var pr = POS.products().find(function (x) { return x.id === l.productId; });
        if (pr && pr.cost) l.cost = pr.cost;
      });
      s.lines = newLines;
      s.totals = Calc.wsTotals(newLines, round());
      s.status = status;
      if (status === 'delivered' && !wasDelivered) { s.deliveredAt = new Date().toISOString(); s.deliveredDev = settings().deviceCode || ''; }

      var list = Store.getSlips();
      if (isNew) {
        s.id = Store.newId('W');
        var sn = Store.makeNo('wseq');
        s.no = sn.no;
        s.noLabel = sn.noLabel;
        s.createdAt = new Date().toISOString();
        list.push(s);
      } else {
        list[list.findIndex(function (x) { return x.id === s.id; })] = s;
      }
      Store.saveSlips(list);

      // 在庫は「納品済」の伝票から自動で計算される（ここでは記録しない）

      // 得意先ごとの単価を記憶
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
        if (printAfter) printSlip(s);
      } else POS.toast('保存しました');
    }

    drawLines();
    drawPay();
  }

  function autoSlipPrint() {
    try { return localStorage.getItem('nikupos.autoSlipPrint') !== '0'; } catch (e) { return true; }
  }
  function setAutoSlipPrint(v) {
    try { localStorage.setItem('nikupos.autoSlipPrint', v ? '1' : '0'); } catch (e) { /* noop */ }
  }

  function cancelSlip(s) {
    if (s.invoiceId) { alert('請求書に含まれている伝票は取り消せません。先に請求書を作り直してください。'); return; }
    if (!confirm('伝票No.' + noOf(s) + '（' + s.customerName + '・' + yen(s.totals.total) + '）を取り消しますか？' +
      (s.status === 'delivered' ? '\n在庫は元に戻ります。' : ''))) return;
    var list = Store.getSlips();
    var x = list.find(function (y) { return y.id === s.id; });
    x.status = 'cancelled';
    x.cancelledAt = new Date().toISOString();
    Store.saveSlips(list);
    render();
    POS.refreshBadges();
    POS.toast('取り消しました');
  }

  // ================= 得意先 =================
  function openCustomerModal(orig) {
    var isNew = !orig;
    var c = orig ? JSON.parse(JSON.stringify(orig)) : {
      code: '', name: '', kana: '', honorific: '御中', person: '', tel: '', address: '', payment: 'credit',
      closingDay: 31, payMonths: 1, payDay: 31, creditLimit: 0, priceMode: 'excl', note: '', prices: {}
    };
    var origMode = modeOf(c);
    var days = [5, 10, 15, 20, 25, 31];
    var used = !isNew && Store.getSlips().some(function (s) { return s.customerId === c.id; });
    POS.openModal(
      '<h3>' + (isNew ? '得意先を追加' : '得意先の編集') + '</h3>' +
      '<form class="form" id="cForm" onsubmit="return false" style="margin-top:8px">' +
      '<div style="display:grid;grid-template-columns:110px 1fr;gap:8px">' +
      '<label>得意先コード<input name="code" value="' + esc(c.code || '') + '" autocomplete="off" placeholder="例：001"></label>' +
      '<label>店名・会社名<input name="name" value="' + esc(c.name) + '" autocomplete="off" placeholder="例：居酒屋 とりまる"></label></div>' +
      '<div style="display:grid;grid-template-columns:1fr 110px;gap:8px">' +
      '<label>ふりがな（並び順に使います）<input name="kana" value="' + esc(c.kana || '') + '" autocomplete="off"></label>' +
      '<label>敬称<select name="honorific"><option' + (honor(c) === '御中' ? ' selected' : '') + '>御中</option><option' + (honor(c) === '様' ? ' selected' : '') + '>様</option></select></label></div>' +
      '<label>ご担当者<input name="person" value="' + esc(c.person) + '" autocomplete="off"></label>' +
      '<label>電話番号<input name="tel" type="tel" inputmode="tel" value="' + esc(c.tel) + '" autocomplete="off"></label>' +
      '<label>住所<input name="address" value="' + esc(c.address) + '" autocomplete="off"></label>' +
      '<label>お支払い<div class="seg"><button type="button" class="btn small" data-pay="credit">掛け（締め日に請求）</button>' +
      '<button type="button" class="btn small" data-pay="cash">現金（納品時）</button></div></label>' +
      '<label>単価の扱い<div class="seg"><button type="button" class="btn small" data-mode="excl">税抜（消費税は別）</button>' +
      '<button type="button" class="btn small" data-mode="incl">税込（消費税込み）</button></div></label>' +
      '<div id="cClose" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<label>締め日<select name="closingDay">' + days.map(function (d) {
        return '<option value="' + d + '"' + (d === c.closingDay ? ' selected' : '') + '>' + (d === 31 ? '月末' : '毎月' + d + '日') + '</option>';
      }).join('') + '</select></label>' +
      '<label>支払期限<select name="payTerm">' + PAY_TERMS.map(function (t) {
        var v = t[0] + '-' + t[1];
        return '<option value="' + v + '"' + (t[0] === payMonths(c) && t[1] === payDay(c) ? ' selected' : '') + '>' + t[2] + '</option>';
      }).join('') + '</select></label>' +
      '<label style="grid-column:1/-1">与信限度額（掛けで売ってよい上限。0なら確認しない）<input name="creditLimit" type="number" inputmode="numeric" min="0" value="' + (c.creditLimit || '') + '" placeholder="例：300000"></label></div>' +
      '<label>メモ<input name="note" value="' + esc(c.note) + '" autocomplete="off"></label>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew || used ? '<button class="btn" data-act="cancel">キャンセル</button>' : '<button class="btn danger-outline" data-act="del">削除</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.pay) { c.payment = b.dataset.pay; draw(); }
        else if (b.dataset.mode) { c.priceMode = b.dataset.mode; draw(); }
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
          c.code = f.code.value.trim();
          c.kana = f.kana.value.trim();
          c.honorific = f.honorific.value;
          var pt = f.payTerm.value.split('-').map(Number);
          c.payMonths = pt[0];
          c.payDay = pt[1];
          c.creditLimit = Math.floor(Number(f.creditLimit.value) || 0);
          if (modeOf(c) !== origMode && c.prices && Object.keys(c.prices).length &&
            confirm('単価の扱いを変えました。この得意先で覚えている単価をリセットしますか？\n（リセットすると、次の伝票から商品マスタの卸単価を' + modeLabel(modeOf(c)) + 'に換算して使います）')) {
            c.prices = {};
          }
          c.note = f.note.value.trim();
          var list = Store.getCustomers();
          if (isNew) { c.id = Store.newId('C'); list.push(c); }
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
      POS.modalBody.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.toggle('on', x.dataset.mode === modeOf(c)); });
    }
    draw();
  }

  // ================= 入金 =================
  function openReceiptModal(presetId) {
    var customers = sortedCustomers().filter(function (c) { return c.payment === 'credit' || c.id === presetId; });
    if (!customers.length) { alert('掛け売りの得意先がありません。'); return; }
    var cid = presetId || customers[0].id;
    var method = 'transfer';
    var target = 0; // 選んだ請求書の残額（差額を振込手数料にするかの判定に使う）
    POS.openModal(
      '<h3>入金を登録</h3>' +
      '<form class="form" id="rcForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>得意先<select name="customer">' + customers.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cid ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<p class="note" id="rcBal"></p><div class="btn-row" id="rcInv"></div>' +
      '<label>入金日<input type="date" name="date" value="' + today() + '"></label>' +
      '<label>金額（実際に入金された額）<input type="number" inputmode="numeric" name="amount" min="1"></label>' +
      '<label class="check" id="rcFeeBox" style="display:none"><input type="checkbox" id="rcFee" checked> <span id="rcFeeText"></span></label>' +
      '<label>方法<div class="seg"><button type="button" class="btn small" data-m="transfer">振込</button>' +
      '<button type="button" class="btn small" data-m="cash">現金</button><button type="button" class="btn small" data-m="other">その他</button></div></label>' +
      '<label>メモ<input name="note" autocomplete="off" placeholder="例：11月分"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">登録</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.m) { method = b.dataset.m; draw(); }
        else if (b.dataset.fill) {
          target = Number(b.dataset.fill);
          f.amount.value = b.dataset.fill;
          if (!f.note.value) f.note.value = b.dataset.memo;
          drawFee();
          f.amount.focus();
          f.amount.select();
        } else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') {
          var amount = Math.floor(Number(f.amount.value) || 0);
          if (!(amount > 0)) { alert('金額を入力してください'); return; }
          var list = Store.getReceipts();
          var date = f.date.value || today();
          list.push({ id: Store.newId('P'), dev: settings().deviceCode || '', customerId: f.customer.value, date: date, amount: amount, method: method, note: f.note.value.trim() });
          var fee = $('rcFee').checked ? feeDiff() : 0;
          if (fee) {
            list.push({ id: Store.newId('P'), dev: settings().deviceCode || '', customerId: f.customer.value, date: date, amount: fee, method: 'fee', note: f.note.value.trim() });
          }
          Store.saveReceipts(list);
          POS.closeModal();
          render();
          POS.toast('入金を登録しました' + (fee ? '（差額 ' + yen(fee) + ' は振込手数料として処理）' : '') + (method === 'cash' ? '（レジ内現金に含めます）' : ''));
        }
      },
      false
    );
    var f = $('rcForm').elements;
    f.customer.addEventListener('change', function () { target = 0; draw(); drawFee(); });
    POS.modalBody.oninput = function (e) { if (e.target.name === 'amount') drawFee(); };
    /** 請求額より少ない入金で、差額が上限以下なら振込手数料とみなす */
    function feeDiff() {
      var amount = Math.floor(Number(f.amount.value) || 0);
      var diff = target - amount;
      return target && amount > 0 && diff > 0 && diff <= feeMax() ? diff : 0;
    }
    function drawFee() {
      var d = feeDiff();
      $('rcFeeBox').style.display = d ? '' : 'none';
      $('rcFeeText').textContent = '差額 ' + yen(d) + ' を振込手数料（当方負担）として処理する';
    }
    function draw() {
      POS.modalBody.querySelectorAll('[data-m]').forEach(function (x) { x.classList.toggle('on', x.dataset.m === method); });
      var c = customerById(f.customer.value);
      var sm = summaryOf(c);
      $('rcBal').textContent = '現在の売掛残高：' + yen(sm.balance) + (sm.overdue ? '（うち期限切れ ' + yen(sm.overdue) + '）' : '');
      // 未入金の請求書をタップすると、その残額が入る
      $('rcInv').innerHTML = Store.getInvoices().filter(function (i) { return sm.invoices[i.id] && sm.invoices[i.id].remaining > 0; })
        .map(function (i) {
          return '<button type="button" class="btn small" data-fill="' + sm.invoices[i.id].remaining + '" data-memo="' + esc(i.periodTo.slice(0, 7).replace('-', '年') + '月締め分') + '">' +
            i.periodTo.slice(5).replace('-', '/') + '締め 残' + yen(sm.invoices[i.id].remaining) + '</button>';
        }).join('');
    }

    draw();
  }

  // ================= 請求書 =================
  function createInvoice(c, periodTo) {
    var inv0 = Calc.buildInvoice(c.id, periodTo, Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
    if (!inv0.slipIds.length && !inv0.receiptIds.length && !inv0.carry) return null;
    var n = Store.makeNo('iseq');
    var i = Object.assign({
      id: Store.newId('I'), no: n.no, noLabel: n.noLabel, createdAt: new Date().toISOString(), issueDate: today(), customerName: c.name,
      dueDate: Calc.dueDate(periodTo, payMonths(c), payDay(c))
    }, inv0);
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
    if (!customers.length) { alert('掛け売りの得意先がありません。'); return; }
    var cid = presetId || customers[0].id;
    POS.openModal(
      '<h3>請求書を作成</h3>' +
      '<form class="form" id="ivForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>得意先<select name="customer">' + customers.map(function (c) {
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
          if (!checkInvoiceNo()) return;
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

  /** ワンタップ：直近の締め日までの請求書を作って印刷（作成済みなら、その請求書を印刷） */
  function oneTapInvoice(c) {
    var to = Calc.lastClosingDate(today(), c.closingDay);
    var x = Calc.buildInvoice(c.id, to, Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
    if (!x.slipIds.length) {
      var done = Store.getInvoices().filter(function (i) { return i.customerId === c.id && i.periodTo === to; })[0];
      if (done) { printInvoice(done); return; }
      POS.toast(to + '締めで請求する納品はありません');
      return;
    }
    if (!checkInvoiceNo()) return;
    var i = createInvoice(c, to);
    render();
    POS.toast(c.name + ' の請求書（' + to + '締め）を発行しました');
    printInvoice(i);
  }

  /** ワンタップ：請求書の残額を入金済にする（振込・今日） */
  function markPaid(i) {
    var st = Calc.invoiceStatus(i.customerId, Store.getInvoices(), Store.getReceipts(), today())[i.id];
    if (!st || st.remaining <= 0) return;
    if (!confirm(i.customerName + ' の ' + i.periodTo + '締め分 ' + yen(st.remaining) + ' を、今日の振込入金として登録しますか？')) return;
    var list = Store.getReceipts();
    list.push({ id: Store.newId('P'), dev: settings().deviceCode || '', customerId: i.customerId, date: today(), amount: st.remaining, method: 'transfer', note: monthMemo(i) });
    Store.saveReceipts(list);
    render();
    POS.toast('入金を登録しました');
  }

  /** ワンタップ：一部入金の残り（振込手数料が差し引かれた分）を、当方負担の振込手数料として処理 */
  function feeOff(i) {
    var st = Calc.invoiceStatus(i.customerId, Store.getInvoices(), Store.getReceipts(), today())[i.id];
    if (!st || st.remaining <= 0) return;
    if (!confirm(i.customerName + ' の ' + i.periodTo + '締め分の残り ' + yen(st.remaining) + ' を、振込手数料（当方負担）として処理しますか？\n売掛金から差し引きます（現金・振込の入金には数えません）。')) return;
    var list = Store.getReceipts();
    list.push({ id: Store.newId('P'), dev: settings().deviceCode || '', customerId: i.customerId, date: today(), amount: st.remaining, method: 'fee', note: monthMemo(i) });
    Store.saveReceipts(list);
    render();
    POS.toast('振込手数料として処理しました');
  }

  function bulkInvoices() {
    if (!pendingClosings().length) { alert('締め日を過ぎて、まだ請求していない得意先はありません。'); return; }
    if (!checkInvoiceNo()) return;
    var made = [];
    sortedCustomers().forEach(function (c) {
      if (c.payment !== 'credit') return;
      var to = Calc.lastClosingDate(today(), c.closingDay);
      var x = Calc.buildInvoice(c.id, to, Store.getSlips(), Store.getReceipts(), Store.getInvoices(), round());
      if (!x.slipIds.length) return; // 新しい納品がない得意先は作らない
      var i = createInvoice(c, to);
      if (i) made.push(i);
    });
    tab = 'billing';
    render();
    if (!made.length) { alert('締め日を過ぎて、まだ請求していない得意先はありません。'); return; }
    POS.toast(made.length + '件の請求書を作成しました');
    printInvoices(made);
  }

  function undoInvoice(i) {
    if (!confirm('請求書No.' + noOf(i) + '（' + i.customerName + '）を取り消して作り直せるようにしますか？')) return;
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

  // ================= 得意先元帳 =================
  var KIND = { delivery: '納品', invoice: '請求', receipt: '入金' };
  function ledgerRows(c, from, to) {
    var rows = Calc.customerLedger(c.id, Store.getSlips(), Store.getReceipts(), Store.getInvoices());
    var opening = 0;
    rows.forEach(function (r) { if (r.date < from) opening = r.balance; });
    return { opening: opening, rows: rows.filter(function (r) { return r.date >= from && r.date <= to; }) };
  }
  function kindLabel(r) { return r.kind === 'receipt' && r.item.method === 'fee' ? '手数料' : KIND[r.kind]; }
  function ledgerDesc(r) {
    var x = r.item;
    if (r.kind === 'delivery') return x.lines.map(function (l) { return l.name + ' ' + qtyText(l); }).join('、');
    if (r.kind === 'invoice') {
      var m = x.periodTo.split('-').map(Number);
      var d = x.dueDate ? x.dueDate.split('-').map(Number) : null;
      return m[1] + '/' + m[2] + '締め 請求 ' + yen(x.billed) + (d ? '・期限 ' + d[1] + '/' + d[2] : '');
    }
    return METHOD[x.method] + (x.note ? '・' + x.note : '');
  }
  function ledgerRef(r) { return r.kind === 'receipt' ? '' : noOf(r.item); }

  function openLedger(c) {
    if (!c) return;
    var t = today();
    var p = t.split('-').map(Number);
    var from = POS.localDate(new Date(p[0], p[1] - 3, 1)); // 2か月前の1日から
    var to = t;
    POS.openModal('<div id="lgBody"></div>', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'close') POS.closeModal();
      else if (b.dataset.act === 'print') printLedger(c, from, to);
      else if (b.dataset.act === 'csv') ledgerCsv(c, from, to);
    });
    POS.modalBody.onchange = function (e) {
      if (e.target.name === 'from') from = e.target.value || from;
      if (e.target.name === 'to') to = e.target.value || to;
      draw();
    };
    function draw() {
      var L = ledgerRows(c, from, to);
      var sm = summaryOf(c);
      $('lgBody').innerHTML = '<h3>得意先元帳：' + esc(c.name) + '</h3>' +
        '<div class="sub">' + closingText(c) + '・売掛残 <b>' + yen(sm.balance) + '</b>' +
        (sm.overdue ? '・<b class="neg">期限切れ ' + yen(sm.overdue) + '</b>' : '') + '</div>' +
        '<div class="toolbar"><input type="date" name="from" value="' + from + '"> 〜 <input type="date" name="to" value="' + to + '"></div>' +
        '<div class="table-wrap"><table><thead><tr><th>日付</th><th>区分</th><th>No</th><th>内容</th><th class="r">売上</th><th class="r">入金</th><th class="r">残高</th></tr></thead><tbody>' +
        '<tr><td colspan="6">前期繰越</td><td class="r num">' + yen(L.opening) + '</td></tr>' +
        L.rows.map(function (r) {
          return '<tr><td>' + r.date.slice(5).replace('-', '/') + '</td><td>' + kindLabel(r) + '</td><td>' + esc(ledgerRef(r)) + '</td>' +
            '<td style="white-space:normal;min-width:160px">' + esc(ledgerDesc(r)) + '</td>' +
            '<td class="r num">' + (r.debit ? yen(r.debit) : '') + '</td><td class="r num">' + (r.credit ? yen(r.credit) : '') + '</td>' +
            '<td class="r num">' + (r.kind === 'invoice' ? '' : yen(r.balance)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="modal-foot" style="grid-template-columns:1fr 1fr 1fr"><button class="btn" data-act="csv">CSV出力</button>' +
        '<button class="btn" data-act="print">取引明細書を印刷</button><button class="btn primary" data-act="close">閉じる</button></div>';
    }
    draw();
  }

  function printLedger(c, from, to) {
    var L = ledgerRows(c, from, to);
    var sales = 0;
    var paid = 0;
    L.rows.forEach(function (r) { sales += r.debit; paid += r.credit; });
    var end = L.opening + sales - paid;
    var h = '<h1>お取引明細書</h1>' +
      '<div class="head"><div><div class="to">' + esc(c.name) + '　' + honor(c) + '</div>' +
      '<p>' + jpDate(from) + '〜' + jpDate(to) + 'のお取引の明細です。</p>' +
      '<div>期末残高<span class="big-total">' + yen(end) + '</span></div></div>' +
      '<div><div class="meta">発行日 ' + jpDate(today()) + '</div>' + fromBlock() + '</div></div>' +
      '<table class="summary"><thead><tr><th>前期繰越</th><th>お買上額（税込）</th><th>御入金額</th><th>期末残高</th></tr></thead>' +
      '<tbody><tr><td>' + yen(L.opening) + '</td><td>' + yen(sales) + '</td><td>' + yen(paid) + '</td><td><b>' + yen(end) + '</b></td></tr></tbody></table>' +
      '<table><thead><tr><th>日付</th><th>区分</th><th>No</th><th>内容</th><th>お買上</th><th>御入金</th><th>残高</th></tr></thead><tbody>' +
      L.rows.filter(function (r) { return r.kind !== 'invoice'; }).map(function (r) {
        return '<tr><td>' + r.date.slice(5).replace('-', '/') + '</td><td>' + kindLabel(r) + '</td><td>' + esc(ledgerRef(r)) + '</td><td>' + esc(ledgerDesc(r)) + '</td>' +
          '<td class="r">' + (r.debit ? yen(r.debit) : '') + '</td><td class="r">' + (r.credit ? yen(r.credit) : '') + '</td><td class="r">' + yen(r.balance) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="notes">金額は税込です。' + (settings().bankInfo ? '<br>お振込先：' + esc(settings().bankInfo).replace(/\n/g, '<br>') : '') + '</div>';
    POS.printDoc(h);
  }

  function ledgerCsv(c, from, to) {
    var L = ledgerRows(c, from, to);
    var rows = [['日付', '区分', 'No', '内容', '売上(税込)', '入金', '残高'], [from, '前期繰越', '', '', '', '', L.opening]];
    L.rows.forEach(function (r) {
      rows.push([r.date, kindLabel(r), ledgerRef(r), ledgerDesc(r), r.debit || '', r.credit || '', r.kind === 'invoice' ? '' : r.balance]);
    });
    var csv = '\ufeff' + rows.map(function (r) {
      return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    POS.saveFile('nikupos-ledger-' + (c.code || c.name) + '-' + from + '_' + to + '.csv', csv, 'text/csv');
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
  /** 税率ごとの対象額と消費税（税込の取引は税込の対象額と「うち消費税」） */
  function rateRows(byRate, mode) {
    return byRate.map(function (r) {
      var label = r.rate + '%対象' + (r.rate === 8 ? '（軽減税率）' : '');
      if (mode === 'incl') {
        return '<tr><th>' + label + '（税込）</th><td>' + yen(r.incl != null ? r.incl : r.amount + r.tax) + '</td><th>うち消費税（' + r.rate + '%）</th><td>' + yen(r.tax) + '</td></tr>';
      }
      return '<tr><th>' + label + '（税抜）</th><td>' + yen(r.amount) + '</td><th>消費税（' + r.rate + '%）</th><td>' + yen(r.tax) + '</td></tr>';
    }).join('');
  }
  /** 明細行。docMode と違う扱いの行には（税込）/（税抜）を付ける */
  function lineRows(lines, withDate, date, no, docMode) {
    return lines.map(function (l, idx) {
      var m = modeOf(l);
      var mark = docMode && m !== docMode ? '（' + modeLabel(m) + '）' : '';
      return '<tr>' + (withDate ? '<td>' + (idx === 0 ? date.slice(5).replace('-', '/') : '') + '</td><td>' + (idx === 0 ? no : '') + '</td>' : '') +
        '<td>' + esc(l.name) + (l.taxRate === 8 ? ' ※' : '') + '</td><td class="r">' + qtyText(l) + '</td>' +
        '<td class="r">' + unitPriceText(l) + mark + '</td><td class="r">' + yen(l.amount) + mark + '</td></tr>';
    }).join('');
  }

  function slipDocHtml(s) {
    var c = customerById(s.customerId);
    var isOrder = s.status === 'order';
    var h = '<h1>' + (isOrder ? '御注文控' : '納品書') + '</h1>' +
      '<div class="head"><div><div class="to">' + esc(c ? c.name : s.customerName) + '　' + honor(c) + '</div>' +
      '<p>' + (isOrder ? '下記のとおりご注文を承りました。' : '下記のとおり納品いたします。') + '</p>' +
      '<div>合計金額（税込）<span class="big-total">' + yen(s.totals.total) + '</span></div></div>' +
      '<div><div class="meta">No. ' + noOf(s) + '<br>' + (isOrder ? '納品予定日 ' : '納品日 ') + jpDate(s.date) + '</div>' + fromBlock() + '</div></div>' +
      '<table><thead><tr><th>品名</th><th>数量</th><th>単価（' + modeLabel(modeOf(s)) + '）</th><th>金額（' + modeLabel(modeOf(s)) + '）</th></tr></thead><tbody>' +
      lineRows(s.lines, false) + '</tbody></table>' +
      '<table class="summary"><tbody>' + rateRows(s.totals.byRate, modeOf(s)) +
      '<tr><th>' + (modeOf(s) === 'incl' ? '消費税合計' : '小計（税抜）') + '</th><td>' + yen(modeOf(s) === 'incl' ? s.totals.tax : s.totals.subtotal) +
      '</td><th>合計（税込）</th><td><b>' + yen(s.totals.total) + '</b></td></tr></tbody></table>' +
      '<div class="notes">※は軽減税率（8%）対象商品です。<br>お支払い：' + (s.payment === 'cash' ? '現金（納品時）' : (c ? closingText(c).replace(/・税込単価$/, '') : '掛け')) +
      (s.note ? '<br>備考：' + esc(s.note) : '') + '</div>' +
      (isOrder ? '' : '<table style="width:45mm;margin:6mm 0 0 auto"><tbody><tr><th>受領印</th></tr><tr><td style="height:22mm"></td></tr></tbody></table>');
    return h;
  }
  function printSlip(s) { POS.printDoc(slipDocHtml(s)); }

  function invoiceDocHtml(i) {
    var c = customerById(i.customerId);
    var slips = Store.getSlips().filter(function (s) { return i.slipIds.indexOf(s.id) >= 0; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.no - b.no; });
    var st = settings();
    var mode = modeOf(c);
    var h = '<h1>請求書</h1>' +
      '<div class="head"><div><div class="to">' + esc(c ? c.name : i.customerName) + '　' + honor(c) + '</div>' +
      '<p>' + jpDate(i.periodTo) + '締め分を下記のとおりご請求申し上げます。</p>' +
      '<div>今回御請求額<span class="big-total">' + yen(i.billed) + '</span></div>' +
      (i.dueDate ? '<div>お支払期限　<b>' + jpDate(i.dueDate) + '</b></div>' : '') + '</div>' +
      '<div><div class="meta">請求書No. ' + noOf(i) + '<br>発行日 ' + jpDate(i.issueDate) + '</div>' + fromBlock() + '</div></div>' +
      '<table class="summary"><thead><tr><th>前回御請求額</th><th>御入金額</th><th>繰越金額</th><th>今回お買上額（税抜）</th><th>消費税額</th><th>今回御請求額</th></tr></thead>' +
      '<tbody><tr><td>' + yen(i.prevBilled) + '</td><td>' + yen(i.received) + '</td><td>' + yen(i.carry) + '</td><td>' + yen(i.subtotal) +
      '</td><td>' + yen(i.tax) + '</td><td><b>' + yen(i.billed) + '</b></td></tr></tbody></table>' +
      '<table><thead><tr><th>日付</th><th>伝票No</th><th>品名</th><th>数量</th><th>単価（' + modeLabel(mode) + '）</th><th>金額（' + modeLabel(mode) + '）</th></tr></thead><tbody>' +
      slips.map(function (s) { return lineRows(s.lines, true, s.date, noOf(s), mode); }).join('') +
      (slips.length ? '' : '<tr><td colspan="6">今回お買上はありません</td></tr>') +
      '</tbody></table>' +
      '<table class="summary"><tbody>' + rateRows(i.byRate, mode) +
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
    var rows = [['納品日', '伝票No', '状態', '得意先', '支払', '商品', '税率', '数量', '単位', '税抜/税込', '単価', '金額', '伝票合計(税込)', '請求書']];
    Store.getSlips().filter(function (s) { return s.date.slice(0, 7) === ym; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.no - b.no; })
      .forEach(function (s) {
        var invNo = '';
        if (s.invoiceId) {
          var iv = Store.getInvoices().find(function (i) { return i.id === s.invoiceId; });
          invNo = iv ? noOf(iv) : '';
        }
        s.lines.forEach(function (l) {
          rows.push([s.date, noOf(s), STATUS[s.status], s.customerName, PAY[s.payment], l.name, l.taxRate,
            l.unit === 'g' ? l.qty / 1000 : l.qty, l.unit === 'g' ? 'kg' : '個', modeLabel(modeOf(l)), l.price, l.amount, s.totals.total, invNo]);
        });
      });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    POS.saveFile('nikupos-wholesale-' + ym + '.csv', csv, 'text/csv');
  }
});
