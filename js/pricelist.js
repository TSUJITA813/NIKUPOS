/*
 * 価格表・価格改定（商品タブ）
 *  - 価格の一括変更：表で直接入力、または「対象 × ○% / ○円 × 端数」で一括入力。今すぐ適用か、日付を指定して予約
 *  - 改定の予約：適用日になると自動で反映（全端末で同期）
 *  - 価格表の印刷、Excel（.xlsx）・CSV への書き出し、Excel・CSV からの取り込み（変更内容を確認してから反映）
 *  - 卸単価を変えたときは、得意先ごとに覚えている卸単価をリセットできる
 * PC のブラウザで同じアプリを開けば、そのまま管理画面として使える（クラウド同期で各端末に反映）
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen;
  var editing = false;
  var draft = {};   // 商品ID → { price, wsPrice }（入力中）

  function today() { return POS.localDate(new Date()); }
  function products() { return POS.products(); }
  function sorted() {
    var cats = POS.categories();
    return products().slice().sort(function (a, b) { return (cats.indexOf(a.category) - cats.indexOf(b.category)) || ((a.order || 0) - (b.order || 0)); });
  }
  function pending() {
    return Store.getPriceChanges().filter(function (c) { return c.status === 'pending'; }).sort(function (a, b) { return a.effective < b.effective ? -1 : 1; });
  }
  function nextMonth1() { var t = new Date(); return POS.localDate(new Date(t.getFullYear(), t.getMonth() + 1, 1)); }
  function jpDate(d) { var p = d.split('-').map(Number); return p[0] + '年' + p[1] + '月' + p[2] + '日'; }
  function unitShort(p) { return p.unit === 'g' ? '100g' : p.unit === 'pc' ? '1個' : ''; }
  function wsUnitShort(p) { return p.unit === 'g' ? '1kg' : '1個'; }

  // ================= 変更の適用 =================
  /**
   * plan: { changes: [{ id, name, patch, before }], added: [product] }
   * resetWs: 卸単価が変わった商品について、得意先ごとに覚えている卸単価を消す
   */
  function applyPlan(plan, date, resetWs, label) {
    var list = products();
    var r = Pricing.applyPatches(list, plan.changes || [], date);
    (plan.added || []).forEach(function (a) {
      var p = JSON.parse(JSON.stringify(a));
      p.id = Store.newId('p');
      p.order = list.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0) + 1;
      list.push(p);
    });
    POS.saveProducts();
    if (resetWs && r.changedWs.length) {
      var cs = Store.getCustomers();
      cs.forEach(function (c) { if (c.prices) r.changedWs.forEach(function (id) { delete c.prices[id]; }); });
      Store.saveCustomers(cs);
    }
    POS.log('product', (label || '価格改定') + '：変更 ' + r.count + '件' + ((plan.added || []).length ? '・追加 ' + plan.added.length + '件' : '') +
      (resetWs && r.changedWs.length ? '（得意先の卸単価をリセット）' : ''));
    return r;
  }

  /** 予約した改定のうち、適用日になったものを反映 */
  function applyDue() {
    var t = today();
    var all = Store.getPriceChanges();
    var due = all.filter(function (c) { return c.status === 'pending' && c.effective <= t; });
    if (!due.length) return;
    due.forEach(function (c) {
      applyPlan(c, c.effective, c.resetWs, jpDate(c.effective) + 'の価格改定（予約）');
      c.status = 'applied';
      c.appliedAt = new Date().toISOString();
    });
    Store.savePriceChanges(all);
    POS.toast(due.map(function (c) { return jpDate(c.effective); }).join('・') + ' の価格改定を反映しました');
    if (POS.views.products && $('view-products').classList.contains('active')) POS.views.products();
  }
  applyDue();
  setInterval(applyDue, 5 * 60000);
  Store.onRemoteChange(function () { setTimeout(applyDue, 500); });

  function saveOrSchedule(plan, when, date, resetWs, label) {
    if (when === 'now') {
      var r = applyPlan(plan, today(), resetWs, label);
      POS.toast(r.count + '件の価格を変更しました');
    } else {
      var list = Store.getPriceChanges();
      list.push({
        id: Store.newId('Q'), effective: date, createdAt: new Date().toISOString(), staff: POS.staffName(), label: label || '',
        changes: plan.changes, added: plan.added || [], resetWs: resetWs, status: 'pending'
      });
      Store.savePriceChanges(list);
      POS.log('product', jpDate(date) + ' からの価格改定を予約：' + plan.changes.length + '件');
      POS.toast(jpDate(date) + ' から適用するよう予約しました');
      applyDue(); // 今日以前の日付なら、すぐ反映
    }
    editing = false;
    draft = {};
    POS.views.products();
  }

  // ================= 画面 =================
  function render() {
    var box = $('priceBox');
    if (!box) return;
    box.parentNode.classList.toggle('price-editing', editing);
    if (editing) { renderEditor(box); return; }
    var pend = pending();
    box.innerHTML = '<div class="btn-row">' +
      '<button class="btn primary" data-pl="edit">価格の一括変更</button>' +
      '<button class="btn" data-pl="print">価格表を印刷</button>' +
      '<button class="btn" data-pl="xlsx">Excelに書き出す</button>' +
      '<button class="btn" data-pl="csv">CSVに書き出す</button>' +
      '<label class="btn">Excel・CSVから取り込む<input type="file" id="plFile" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></label>' +
      '</div>' +
      (pend.length ? pend.map(function (c) {
        return '<div class="list-item" style="border-left:6px solid #d9a441"><div class="li-top"><span class="li-title">' + jpDate(c.effective) + ' から適用予定の価格改定</span>' +
          '<span class="pill warn">予約中</span></div><div class="li-sub">変更 ' + c.changes.length + '件' + (c.added.length ? '・追加 ' + c.added.length + '件' : '') +
          (c.staff ? '・' + esc(c.staff) : '') + '</div>' +
          '<div class="btn-row"><button class="btn small" data-pl="view" data-id="' + c.id + '">内容を見る</button>' +
          '<button class="btn small danger-outline" data-pl="cancel" data-id="' + c.id + '">予約を取り消す</button></div></div>';
      }).join('') : '') +
      '<p class="note">PCのブラウザでこのアプリを開くと、広い画面で価格を変更できます（クラウド同期でレジにも反映）。Excelで直して取り込むこともできます。</p>';
  }
  var prevProducts = POS.views.products;
  POS.views.products = function () { if (prevProducts) prevProducts(); render(); };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#priceBox [data-pl]');
    if (!b) return;
    var act = b.dataset.pl;
    if (act === 'print') { openPrint(); return; }
    if (act === 'xlsx' || act === 'csv') { openExport(act); return; }
    if (act === 'view') { viewChange(Store.getPriceChanges().find(function (c) { return c.id === b.dataset.id; })); return; }
    POS.requirePerm('products', '価格の変更').then(function (ok) {
      if (!ok) return;
      if (act === 'edit') { editing = true; draft = {}; render(); }
      if (act === 'cancel') {
        var list = Store.getPriceChanges();
        var c = list.find(function (x) { return x.id === b.dataset.id; });
        if (!c || !confirm(jpDate(c.effective) + ' からの価格改定の予約を取り消しますか？')) return;
        c.status = 'cancelled';
        Store.savePriceChanges(list);
        POS.log('product', jpDate(c.effective) + ' からの価格改定の予約を取消');
        render();
      }
    });
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'plFile') return;
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    POS.requirePerm('products', '商品・価格の取り込み').then(function (ok) { if (ok) importFile(file); });
  });

  // ---------- 一括変更の画面 ----------
  function renderEditor(box) {
    var list = sorted().filter(function (p) { return p.unit !== 'open'; });
    var cats = POS.categories();
    box.innerHTML = '<div class="toolbar"><h2>価格の一括変更</h2><span class="spacer"></span>' +
      '<button class="btn small" data-ed="close">やめる</button></div>' +
      '<div class="bulk-tools"><span class="note">一括で入れる：</span>' +
      '<select id="bkTarget"><option value="">すべての商品</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="bkField"><option value="price">店頭価格</option><option value="wsPrice">卸単価</option></select>' +
      '<input type="number" id="bkVal" inputmode="decimal" placeholder="例：5" style="width:80px">' +
      '<select id="bkKind"><option value="pct">%</option><option value="yen">円</option></select>' +
      '<select id="bkRound">' + Object.keys(Pricing.ROUND_LABEL).map(function (k) { return '<option value="' + k + '">' + Pricing.ROUND_LABEL[k] + '</option>'; }).join('') + '</select>' +
      '<button class="btn small" data-ed="bulk">新しい価格に入れる</button>' +
      '<button class="btn small" data-ed="clear">入力を消す</button></div>' +
      '<div class="table-wrap"><table class="price-table"><thead><tr><th>商品</th><th class="r">店頭価格（税込）</th><th class="r">新しい店頭価格</th><th class="r">卸単価（税抜）</th><th class="r">新しい卸単価</th></tr></thead><tbody>' +
      list.map(function (p) {
        var d = draft[p.id] || {};
        var last = (p.priceHistory || []).slice(-1)[0];
        return '<tr data-pid="' + p.id + '"><td><b>' + esc(p.name) + '</b><div class="note">' + esc(p.category) + (last ? '・前回 ' + yen(last.price) + '（' + last.date + 'まで）' : '') + '</div></td>' +
          '<td class="r num">' + yen(p.price) + '<div class="note">' + unitShort(p) + '</div></td>' +
          '<td class="r"><input type="number" inputmode="numeric" min="1" data-f="price" value="' + (d.price != null ? d.price : '') + '" placeholder="' + p.price + '"></td>' +
          '<td class="r num">' + (p.wsPrice ? yen(p.wsPrice) : '—') + '<div class="note">' + wsUnitShort(p) + '</div></td>' +
          '<td class="r"><input type="number" inputmode="numeric" min="0" data-f="wsPrice" value="' + (d.wsPrice != null ? d.wsPrice : '') + '" placeholder="' + (p.wsPrice || '') + '"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="tot-box" id="edSum"></div>' +
      '<div class="form" style="margin-top:10px"><label>いつから<div class="seg"><button type="button" class="btn small on" data-when="now">今すぐ</button>' +
      '<button type="button" class="btn small" data-when="date">日付を指定（予約）</button></div></label>' +
      '<label id="edDateL" style="display:none">適用日<input type="date" id="edDate" value="' + nextMonth1() + '"></label>' +
      '<label class="check"><input type="checkbox" id="edReset" checked> 卸単価を変えた商品は、得意先ごとに覚えている卸単価をリセットする</label></div>' +
      '<div class="btn-row"><button class="btn" data-ed="close">やめる</button><button class="btn primary" data-ed="save">変更を保存</button></div>';
    var when = 'now';
    box.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.when) {
        when = b.dataset.when;
        box.querySelectorAll('[data-when]').forEach(function (x) { x.classList.toggle('on', x.dataset.when === when); });
        $('edDateL').style.display = when === 'date' ? '' : 'none';
        return;
      }
      var a = b.dataset.ed;
      if (a === 'close') { if (Object.keys(draft).length && !confirm('入力した価格を保存せずに閉じますか？')) return; editing = false; draft = {}; render(); }
      if (a === 'clear') { draft = {}; render(); }
      if (a === 'bulk') {
        var v = Number($('bkVal').value);
        if (!v) { alert('変更する量を入れてください（例：5% なら 5、10円下げるなら -10）'); return; }
        var cat = $('bkTarget').value;
        var field = $('bkField').value;
        list.forEach(function (p) {
          if (cat && p.category !== cat) return;
          var base = p[field] || 0;
          if (!base) return;
          draft[p.id] = draft[p.id] || {};
          draft[p.id][field] = Pricing.bulkPrice(base, $('bkKind').value, v, $('bkRound').value);
        });
        render();
      }
      if (a === 'save') {
        var plan = planFromDraft();
        if (!plan.changes.length) { alert('変更された価格がありません'); return; }
        var date = when === 'date' ? $('edDate').value : today();
        if (when === 'date' && !date) { alert('適用日を入れてください'); return; }
        if (!confirm(plan.changes.length + '件の価格を' + (when === 'now' ? '今すぐ変更' : jpDate(date) + 'から変更') + 'します。よろしいですか？')) return;
        saveOrSchedule(plan, when, date, $('edReset').checked, '価格の一括変更');
      }
    };
    box.oninput = function (e) {
      var tr = e.target.closest('tr[data-pid]');
      if (!tr) return;
      var id = tr.dataset.pid;
      var f = e.target.dataset.f;
      draft[id] = draft[id] || {};
      if (e.target.value === '') delete draft[id][f]; else draft[id][f] = Math.floor(Number(e.target.value) || 0);
      if (!Object.keys(draft[id]).length) delete draft[id];
      mark(tr);
      drawSum();
    };
    // PC：Enter で下の行の同じ列へ
    box.onkeydown = function (e) {
      if (e.key !== 'Enter' || !e.target.dataset.f) return;
      e.preventDefault();
      var inputs = Array.prototype.slice.call(box.querySelectorAll('input[data-f="' + e.target.dataset.f + '"]'));
      var next = inputs[inputs.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
      if (next) { next.focus(); next.select(); }
    };
    function mark(tr) {
      var p = products().find(function (x) { return x.id === tr.dataset.pid; });
      var d = draft[p.id] || {};
      tr.classList.toggle('changed', (d.price != null && d.price !== p.price) || (d.wsPrice != null && d.wsPrice !== (p.wsPrice || 0)));
    }
    function drawSum() {
      var n = planFromDraft().changes.length;
      $('edSum').innerHTML = '<div class="sum-row total"><span>変更する商品</span><span class="num">' + n + '件</span></div>';
    }
    box.querySelectorAll('tr[data-pid]').forEach(mark);
    drawSum();
  }
  function planFromDraft() {
    var changes = [];
    Object.keys(draft).forEach(function (id) {
      var p = products().find(function (x) { return x.id === id; });
      if (!p) return;
      var d = draft[id];
      var patch = {};
      var before = {};
      if (d.price != null && d.price > 0 && d.price !== p.price) { patch.price = d.price; before.price = p.price; }
      if (d.wsPrice != null && d.wsPrice !== (p.wsPrice || 0)) { patch.wsPrice = d.wsPrice; before.wsPrice = p.wsPrice || 0; }
      if (Object.keys(patch).length) changes.push({ id: id, name: p.name, patch: patch, before: before });
    });
    return { changes: changes, added: [] };
  }

  // ---------- 予約の内容・取り込みの確認 ----------
  function changesTable(plan) {
    var fields = { price: '店頭価格', wsPrice: '卸単価', name: '商品名', category: 'カテゴリ', unit: '売り方', taxRate: '税率', trackStock: '在庫管理', minStock: '発注点', parStock: '適正在庫', supplier: '仕入先' };
    function v(k, x) {
      if (k === 'price' || k === 'wsPrice') return yen(x);
      if (k === 'trackStock') return x ? '○' : '×';
      if (k === 'taxRate') return x + '%';
      if (k === 'unit') return { g: 'グラム売り', pc: '個数売り', open: '金額入力' }[x] || x;
      return esc(x === '' || x == null ? '（なし）' : x);
    }
    return (plan.changes.length ? '<div class="table-wrap"><table><thead><tr><th>商品</th><th>項目</th><th class="r">今</th><th class="r">変更後</th></tr></thead><tbody>' +
      plan.changes.map(function (c) {
        return Object.keys(c.patch).map(function (k, i) {
          return '<tr><td>' + (i === 0 ? esc(c.name) : '') + '</td><td>' + (fields[k] || k) + '</td><td class="r num">' + v(k, c.before[k]) + '</td><td class="r num"><b>' + v(k, c.patch[k]) + '</b></td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div>' : '') +
      ((plan.added || []).length ? '<h3 style="font-size:16px;margin:10px 0 4px">新しく追加する商品</h3><div class="li-sub">' +
        plan.added.map(function (a) { return esc(a.name) + '（' + (a.unit === 'open' ? '金額入力' : yen(a.price)) + '）'; }).join('、') + '</div>' : '');
  }
  function viewChange(c) {
    if (!c) return;
    POS.openModal('<h3>' + jpDate(c.effective) + ' からの価格改定</h3><div class="sub">変更 ' + c.changes.length + '件' + (c.resetWs ? '・得意先の卸単価をリセット' : '') + '</div>' +
      changesTable(c) + '<div class="modal-foot"><span></span><button class="btn primary" data-act="close">閉じる</button></div>',
      function (e) { var b = e.target.closest('button'); if (b && b.dataset.act === 'close') POS.closeModal(); });
  }

  function importFile(file) {
    var isX = /\.xlsx$/i.test(file.name);
    file.arrayBuffer().then(function (buf) {
      return isX ? XLSX.readXlsx(buf) : XLSX.parseCsv(XLSX.decodeCsv(new Uint8Array(buf)));
    }).then(function (rows) {
      var plan = Pricing.planImport(products(), rows);
      var when = 'now';
      POS.openModal(
        '<h3>取り込みの確認</h3><div class="sub">' + esc(file.name) + '：変更 ' + plan.changes.length + '件・追加 ' + plan.added.length + '件・変更なし ' + plan.unchanged + '件' +
        (plan.errors.length ? '・<b class="neg">読み取れない行 ' + plan.errors.length + '件</b>' : '') + '</div>' +
        (plan.errors.length ? '<div class="resv-note" style="background:#fdecea">' + plan.errors.map(esc).join('<br>') + '<br>（この行は取り込みません）</div>' : '') +
        changesTable(plan) +
        '<div class="form" style="margin-top:10px"><label>いつから<div class="seg"><button type="button" class="btn small on" data-when="now">今すぐ</button>' +
        '<button type="button" class="btn small" data-when="date">日付を指定（予約）</button></div></label>' +
        '<label id="imDateL" style="display:none">適用日<input type="date" id="imDate" value="' + nextMonth1() + '"></label>' +
        '<label class="check"><input type="checkbox" id="imReset" checked> 卸単価を変えた商品は、得意先ごとに覚えている卸単価をリセットする</label></div>' +
        '<div class="modal-foot"><button class="btn" data-act="cancel">やめる</button><button class="btn primary" id="mOk" data-act="ok"' +
        (plan.changes.length || plan.added.length ? '' : ' disabled') + '>反映する</button></div>',
        function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.when) {
            when = b.dataset.when;
            POS.modalBody.querySelectorAll('[data-when]').forEach(function (x) { x.classList.toggle('on', x.dataset.when === when); });
            $('imDateL').style.display = when === 'date' ? '' : 'none';
          } else if (b.dataset.act === 'cancel') POS.closeModal();
          else if (b.dataset.act === 'ok') {
            var date = when === 'date' ? $('imDate').value : today();
            var reset = $('imReset').checked;
            POS.closeModal();
            saveOrSchedule(plan, when, date, reset, 'Excel・CSVから取り込み（' + file.name + '）');
          }
        },
        false
      );
    }).catch(function (err) { alert('読み込めませんでした：' + err.message); });
  }

  // ---------- 書き出し・印刷 ----------
  /** 予約中の改定を当てたあとの商品一覧（書き出し・印刷で「○日からの価格」を選んだとき） */
  function productsAt(changeId) {
    var list = JSON.parse(JSON.stringify(products()));
    if (!changeId) return list;
    pending().forEach(function (c) {
      if (c.effective > Store.getPriceChanges().find(function (x) { return x.id === changeId; }).effective) return;
      Pricing.applyPatches(list, c.changes, c.effective);
      (c.added || []).forEach(function (a, i) { var p = JSON.parse(JSON.stringify(a)); p.id = '（追加予定' + (i + 1) + '）'; p.order = 9999 + i; list.push(p); });
    });
    return list;
  }
  function whenOptions() {
    var pend = pending();
    if (!pend.length) return '';
    return '<label>どの価格で<select id="exWhen"><option value="">今の価格</option>' + pend.map(function (c) {
      return '<option value="' + c.id + '">' + jpDate(c.effective) + ' からの価格（予約中）</option>';
    }).join('') + '</select></label>';
  }
  function whenLabel(id) {
    var c = id ? Store.getPriceChanges().find(function (x) { return x.id === id; }) : null;
    return c ? jpDate(c.effective) + '〜' : jpDate(today()) + ' 現在';
  }

  function openExport(kind) {
    var opts = whenOptions();
    if (!opts) { doExport(kind, ''); return; }
    POS.openModal('<h3>' + (kind === 'xlsx' ? 'Excel' : 'CSV') + 'に書き出す</h3><div class="form">' + opts + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">やめる</button><button class="btn primary" data-act="ok">書き出す</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') POS.closeModal();
        if (b.dataset.act === 'ok') { var w = $('exWhen').value; POS.closeModal(); doExport(kind, w); }
      });
  }
  function doExport(kind, changeId) {
    var rows = Pricing.productsToRows(productsAt(changeId), POS.categories());
    var ymd = (changeId ? Store.getPriceChanges().find(function (x) { return x.id === changeId; }).effective : today()).replace(/-/g, '');
    var name = '商品価格表_' + ymd;
    if (kind === 'xlsx') {
      var bytes = XLSX.writeXlsx(rows, { sheetName: '価格表', widths: Pricing.COLUMNS.map(function (c) { return c.width; }), title: POS.settings().storeName + ' 価格表（' + whenLabel(changeId) + '）', landscape: true });
      POS.saveFile(name + '.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      var csv = '﻿' + rows.map(function (r) {
        return r.map(function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
      }).join('\r\n') + '\r\n';
      POS.saveFile(name + '.csv', csv, 'text/csv');
    }
    POS.toast('書き出しました。Excelで直して「Excel・CSVから取り込む」で反映できます');
  }

  function openPrint() {
    POS.openModal('<h3>価格表を印刷</h3><div class="form">' + whenOptions() +
      '<label class="check"><input type="checkbox" id="prWs"> 卸単価も載せる</label>' +
      '<label class="check"><input type="checkbox" id="prOpen"> 金額入力の商品も載せる</label></div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">やめる</button><button class="btn primary" data-act="ok">印刷</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') POS.closeModal();
        if (b.dataset.act === 'ok') {
          var w = $('exWhen') ? $('exWhen').value : '';
          var ws = $('prWs').checked;
          var op = $('prOpen').checked;
          POS.closeModal();
          printList(w, ws, op);
        }
      });
  }
  function printList(changeId, withWs, withOpen) {
    var list = productsAt(changeId).filter(function (p) { return withOpen || p.unit !== 'open'; });
    var cats = POS.categories();
    list.sort(function (a, b) { return (cats.indexOf(a.category) - cats.indexOf(b.category)) || ((a.order || 0) - (b.order || 0)); });
    var h = '<h1>価格表</h1><div class="meta" style="text-align:left">' + esc(POS.settings().storeName) + '　' + whenLabel(changeId) + '</div>';
    var groups = {};
    var order = [];
    list.forEach(function (p) { if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); } groups[p.category].push(p); });
    order.forEach(function (c) {
      h += '<h2 style="font-size:13pt;margin:5mm 0 1mm">' + esc(c) + '</h2><table><thead><tr><th>商品名</th><th>店頭価格（税込）</th>' + (withWs ? '<th>卸単価（税抜）</th>' : '') + '</tr></thead><tbody>' +
        groups[c].map(function (p) {
          return '<tr><td>' + esc(p.name) + (p.taxRate === 10 ? '（税10%）' : '') + '</td>' +
            '<td class="r">' + (p.unit === 'open' ? '時価' : yen(p.price) + ' / ' + unitShort(p)) + '</td>' +
            (withWs ? '<td class="r">' + (p.wsPrice ? yen(p.wsPrice) + ' / ' + wsUnitShort(p) : '—') + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
    });
    POS.printDoc(h);
  }
});
