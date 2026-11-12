/*
 * 在庫管理（入荷・加工・廃棄/調整・棚卸、引当、発注点）
 * 在庫数は「在庫の記録」「店頭の売上」「卸の伝票」から毎回計算する（Calc.computeStock）。
 * そのため複数の端末で同時に販売・納品しても、どの端末でも同じ在庫数になる。
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;

  var TYPE_LABEL = {
    'in': '入荷', 'process': '加工', 'waste': '廃棄', 'adjust': '調整', 'count': '棚卸',
    'wholesale': '卸', 'init': '初期在庫'
  };

  // ---------- 表示用 ----------
  function fmtQty(unit, q) {
    q = q || 0;
    if (unit === 'g') {
      if (Math.abs(q) < 1000) return num(q) + 'g';
      return (Math.round(q / 10) / 100).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + 'kg';
    }
    return num(q) + '個';
  }
  function fmtDelta(unit, d) { return (d > 0 ? '+' : d < 0 ? '−' : '') + fmtQty(unit, Math.abs(d)); }
  /** 入力欄の文字 → 数量（g は kg で入力。はかりの「0.350kg」「350 g」なども可） */
  function parseQty(text, unit) {
    if (unit === 'g') {
      var r = Scale.parseWeight(text, 'kg');
      return r ? r.grams : 0;
    }
    var n = Math.round(Number(String(text).replace(/[^\d.-]/g, '')));
    return isFinite(n) ? n : 0;
  }
  function qtyInputValue(unit, q) {
    if (!q) return '';
    return unit === 'g' ? String(Math.round(q) / 1000) : String(q);
  }
  function unitHint(unit) { return unit === 'g' ? 'kg' : '個'; }

  function tracked() {
    return POS.products().filter(function (p) { return p.trackStock && p.unit !== 'open'; }).sort(byCatOrder);
  }
  function byCatOrder(a, b) {
    var cats = POS.categories();
    return (cats.indexOf(a.category) - cats.indexOf(b.category)) || (a.order - b.order);
  }
  function productById(id) { return POS.products().find(function (p) { return p.id === id; }); }

  function lowCount() {
    var stock = Store.getStock();
    return tracked().filter(function (p) { return p.minStock > 0 && (stock[p.id] || 0) < p.minStock; }).length;
  }
  POS.addBadge(function () {
    var n = lowCount();
    var b = $('invBadge');
    b.hidden = !n;
    b.textContent = n;
  });

  // ---------- 一覧 ----------
  function render() {
    var stock = Store.getStock();
    var today = POS.localDate(new Date());
    var alloc = Calc.allocated(Store.getReservations(), Store.getSlips(), today);
    var list = tracked();
    var value = 0;
    var h = '<div class="toolbar"><h2>在庫</h2><span class="spacer"></span>' +
      '<button class="btn small" data-inv="pick">管理する商品を選ぶ</button></div>' +
      '<div class="btn-row">' +
      '<button class="btn primary" data-inv="in">＋ 入荷</button>' +
      '<button class="btn" data-inv="process">加工（さばく・仕込む）</button>' +
      '<button class="btn" data-inv="waste">廃棄・調整</button>' +
      '<button class="btn" data-inv="count">棚卸</button></div>';

    if (!list.length) {
      h += '<p class="note">在庫を管理する商品がありません。「管理する商品を選ぶ」から選んでください。</p>';
      $('invRoot').innerHTML = h;
      return;
    }
    var rows = list.map(function (p) {
      var q = stock[p.id] || 0;
      var a = alloc[p.id] || 0;
      var free = q - a;
      if (p.cost && q > 0) value += p.unit === 'g' ? Math.floor((q * p.cost) / 1000) : q * p.cost;
      var status = '';
      if (q < 0) status = '<span class="pill">マイナス</span>';
      else if (free < 0) status = '<span class="pill">引当不足</span>';
      else if (p.minStock > 0 && q < p.minStock) status = '<span class="pill warn">発注点割れ</span>';
      return '<tr data-pid="' + p.id + '" style="cursor:pointer"><td>' + esc(p.name) + ' ' + status + '</td>' +
        '<td class="r num' + (q < 0 ? ' neg' : '') + '"><b>' + fmtQty(p.unit, q) + '</b></td>' +
        '<td class="r num">' + (a ? fmtQty(p.unit, a) : '—') + '</td>' +
        '<td class="r num' + (free < 0 ? ' neg' : '') + '">' + fmtQty(p.unit, free) + '</td>' +
        '<td class="r num hide-narrow">' + (p.minStock ? fmtQty(p.unit, p.minStock) : '—') + '</td></tr>';
    }).join('');
    h += '<div class="table-wrap"><table><thead><tr><th>商品</th><th class="r">在庫</th><th class="r">引当</th><th class="r">引当後</th><th class="r hide-narrow">発注点</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">引当＝今日以降の予約（未受渡）と卸の受注（未納品）の合計。商品をタップすると履歴を表示します。' +
      (value ? '　在庫金額（仕入単価ベース）約 ' + yen(value) : '') + '</p>';

    var tr = POS.trackedMap();
    var moves = allMoves().filter(function (m) { return tr[m.productId]; }).slice(-30).reverse();
    h += ordersHtml();
    h += '<h2>最近の入出庫</h2>';
    h += moves.length ? movesTable(moves, true) : '<p class="note">まだ記録がありません。入荷や棚卸をすると、ここに表示されます。店頭販売の分は、売上データから自動で在庫を減らします（ここには表示しません）。</p>';
    $('invRoot').innerHTML = h;
  }
  POS.views.inventory = render;

  /** 在庫の記録 ＋ 卸の納品・取消（伝票から作る） */
  function allMoves() {
    var out = Store.getMoves().slice();
    Store.getSlips().forEach(function (s) {
      if (!s.deliveredAt) return;
      var ref = '卸No.' + (s.noLabel || s.no);
      s.lines.forEach(function (l) {
        out.push({ at: s.deliveredAt, type: 'wholesale', productId: l.productId, name: l.name, delta: -l.qty, ref: ref, note: s.customerName });
        if (s.status === 'cancelled' && s.cancelledAt) {
          out.push({ at: s.cancelledAt, type: 'wholesale', productId: l.productId, name: l.name, delta: l.qty, ref: ref, note: '取消' });
        }
      });
    });
    return out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  }

  function movesTable(moves, withName) {
    return '<div class="table-wrap"><table><thead><tr><th>日時</th>' + (withName ? '<th>商品</th>' : '') +
      '<th>区分</th><th class="r">増減</th><th class="r">残り</th><th>メモ</th></tr></thead><tbody>' +
      moves.map(function (m) {
        var p = productById(m.productId);
        var unit = p ? p.unit : 'g';
        var d = new Date(m.at);
        return '<tr><td>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + POS.timeStr(d) + '</td>' +
          (withName ? '<td>' + esc(m.name) + '</td>' : '') +
          '<td>' + (TYPE_LABEL[m.type] || m.type) + '</td>' +
          '<td class="r num' + (m.delta < 0 ? ' neg' : '') + '">' + fmtDelta(unit, m.delta) + '</td>' +
          '<td class="r num">' + (m.after != null ? fmtQty(unit, m.after) : '') + '</td>' +
          '<td>' + esc([m.ref, m.note].filter(Boolean).join(' ')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  $('invRoot').addEventListener('click', function (e) {
    var b = e.target.closest('[data-inv]');
    if (b) {
      var act = b.dataset.inv;
      if (act === 'pick') openPickModal();
      else if (!tracked().length) alert('先に「管理する商品を選ぶ」で、在庫を管理する商品を選んでください。');
      else if (act === 'in') openItemsModal();
      else if (act === 'order') openOrderModal();
      else if (act === 'process') openProcessModal();
      else if (act === 'waste') openWasteModal();
      else if (act === 'count') openCountModal();
      return;
    }
    var tr = e.target.closest('tr[data-pid]');
    if (tr) openHistory(productById(tr.dataset.pid));
  });

  function productOptions(list) {
    return list.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  }

  // ---------- 管理する商品を選ぶ ----------
  function openPickModal() {
    var list = POS.products().filter(function (p) { return p.unit !== 'open'; }).sort(byCatOrder);
    POS.openModal(
      '<h3>在庫を管理する商品</h3><div class="sub">チェックした商品は、販売・卸・入荷で在庫数が増減します。</div>' +
      '<div class="form">' + list.map(function (p) {
        return '<label class="check"><input type="checkbox" data-pick="' + p.id + '"' + (p.trackStock ? ' checked' : '') + '> ' +
          esc(p.name) + '<span class="note">（' + esc(p.category) + '）</span></label>';
      }).join('') + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') POS.closeModal();
        if (b.dataset.act === 'save') {
          var added = 0;
          POS.modalBody.querySelectorAll('[data-pick]').forEach(function (c) {
            var p = productById(c.dataset.pick);
            if (c.checked && !p.trackStock) added++;
            p.trackStock = c.checked;
          });
          POS.saveProducts();
          POS.closeModal();
          render();
          POS.refreshBadges();
          if (added) POS.toast('新しく管理する商品は「棚卸」で今の在庫数を入れてください');
        }
      }
    );
  }

  // ---------- 入荷 ----------
  /** prefill: { supplier, note, items, onSaved }（発注書から入荷するとき） */
  function openItemsModal(prefill) {
    prefill = prefill || {};
    var items = (prefill.items || []).slice();
    var list = tracked();
    var suppliers = {};
    Store.getMoves().forEach(function (m) { if (m.type === 'in' && m.supplier) suppliers[m.supplier] = true; });
    POS.openModal(
      '<h3>入荷</h3><div class="sub">仕入れた商品と数量を入れてください（重さは kg、例：12.5）</div>' +
      '<form class="form" id="iForm" onsubmit="return false">' +
      '<label>入荷日<input type="date" name="date" value="' + POS.localDate(new Date()) + '"></label>' +
      '<label>仕入先<input name="supplier" list="supplierList" value="' + esc(prefill.supplier || '') + '" autocomplete="off"><datalist id="supplierList">' +
      Object.keys(suppliers).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></label>' +
      '<div><div class="wsline-head"><span>商品</span><span>数量</span><span>仕入単価(税抜)</span><span></span></div><div id="iItems"></div>' +
      '<div class="radd"><select id="iSel">' + productOptions(list) + '</select><button type="button" class="btn" data-act="add">＋ 追加</button></div></div>' +
      '<label>メモ<input name="note" value="' + esc(prefill.note || '') + '" autocomplete="off"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">入荷を記録</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'add') {
          var p = productById($('iSel').value);
          items.push({ productId: p.id, name: p.name, unit: p.unit, qtyText: '', cost: p.cost || '' });
          draw();
          var ins = POS.modalBody.querySelectorAll('#iItems input[data-f="q"]');
          ins[ins.length - 1].focus();
        } else if (b.dataset.del != null) {
          items.splice(Number(b.dataset.del), 1);
          draw();
        } else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') save();
      },
      false
    );
    POS.modalBody.oninput = function (e) {
      var i = e.target.dataset.i;
      if (i == null) return;
      if (e.target.dataset.f === 'q') items[i].qtyText = e.target.value;
      else items[i].cost = e.target.value;
    };
    function draw() {
      $('iItems').innerHTML = items.length ? items.map(function (it, i) {
        return '<div class="wsline"><div class="rname">' + esc(it.name) + '<small>' + unitHint(it.unit) + '・単価は' + (it.unit === 'g' ? '1kg' : '1個') + 'あたり</small></div>' +
          '<input type="text" inputmode="decimal" data-i="' + i + '" data-f="q" value="' + esc(it.qtyText) + '" placeholder="' + unitHint(it.unit) + '">' +
          '<input type="number" inputmode="numeric" data-i="' + i + '" data-f="c" value="' + esc(it.cost) + '" placeholder="任意">' +
          '<button type="button" data-del="' + i + '" aria-label="削除">×</button></div>';
      }).join('') : '<p class="note">下で商品を選んで「追加」</p>';
    }
    function save() {
      if (!items.length) { alert('商品を追加してください'); return; }
      var f = $('iForm').elements;
      var lines = [];
      for (var i = 0; i < items.length; i++) {
        var q = parseQty(items[i].qtyText, items[i].unit);
        if (!(q > 0)) { alert('「' + items[i].name + '」の数量を入れてください'); return; }
        lines.push({ productId: items[i].productId, name: items[i].name, unit: items[i].unit, qty: q, cost: Math.floor(Number(items[i].cost) || 0) });
      }
      var supplier = f.supplier.value.trim();
      lines.forEach(function (l) {
        POS.stockChange([l], 1, {
          type: 'in', cost: l.cost || null, supplier: supplier,
          note: [supplier, f.note.value.trim()].filter(Boolean).join(' '),
          ref: f.date.value !== POS.localDate(new Date()) ? f.date.value + '入荷' : ''
        });
        if (l.cost) productById(l.productId).cost = l.cost;
      });
      POS.saveProducts();
      POS.closeModal();
      if (prefill.onSaved) prefill.onSaved();
      render();
      POS.toast(lines.length + '品目の入荷を記録しました');
    }
    draw();
  }

  // ---------- 加工（原料 → 製品） ----------
  function openProcessModal() {
    var list = tracked();
    var outs = [];
    POS.openModal(
      '<h3>加工</h3><div class="sub">例：丸鶏をさばいて、もも・むね・手羽・ガラにする／もも肉から唐揚げ用を仕込む</div>' +
      '<form class="form" id="pcForm" onsubmit="return false">' +
      '<label>使った原料<select name="src">' + productOptions(list) + '</select></label>' +
      '<label>原料の数量（<span id="pcUnit"></span>）<input name="srcQty" type="text" inputmode="decimal"></label>' +
      '<div><div class="note">できた商品</div><div id="pcOuts"></div>' +
      '<div class="radd"><select id="pcSel">' + productOptions(list) + '</select><button type="button" class="btn" data-act="add">＋ 追加</button></div>' +
      '<div class="note" id="pcYield"></div></div>' +
      '<label>メモ<input name="note" autocomplete="off"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">加工を記録</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'add') {
          var p = productById($('pcSel').value);
          outs.push({ productId: p.id, name: p.name, unit: p.unit, qtyText: '' });
          draw();
        } else if (b.dataset.del != null) { outs.splice(Number(b.dataset.del), 1); draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') save();
      },
      false
    );
    var form = $('pcForm').elements;
    function srcProduct() { return productById(form.src.value); }
    form.src.addEventListener('change', function () { $('pcUnit').textContent = unitHint(srcProduct().unit); drawYield(); });
    POS.modalBody.oninput = function (e) {
      if (e.target.dataset.i != null) outs[e.target.dataset.i].qtyText = e.target.value;
      drawYield();
    };
    function draw() {
      $('pcUnit').textContent = unitHint(srcProduct().unit);
      $('pcOuts').innerHTML = outs.map(function (o, i) {
        return '<div class="ritem"><div class="rname">' + esc(o.name) + '<small>' + unitHint(o.unit) + '</small></div>' +
          '<input type="text" inputmode="decimal" data-i="' + i + '" value="' + esc(o.qtyText) + '">' +
          '<button type="button" data-del="' + i + '">×</button></div>';
      }).join('');
      drawYield();
    }
    function drawYield() {
      var sp = srcProduct();
      var sq = parseQty(form.srcQty.value, sp.unit);
      var outG = 0;
      var allG = sp.unit === 'g';
      outs.forEach(function (o) { if (o.unit === 'g') outG += parseQty(o.qtyText, 'g'); else allG = false; });
      $('pcYield').textContent = allG && sq > 0 && outG > 0 ? '歩留まり ' + Math.round((outG / sq) * 1000) / 10 + '%（ロス ' + fmtQty('g', sq - outG) + '）' : '';
    }
    function save() {
      var sp = srcProduct();
      var sq = parseQty(form.srcQty.value, sp.unit);
      if (!(sq > 0)) { alert('原料の数量を入れてください'); return; }
      if (!outs.length) { alert('できた商品を追加してください'); return; }
      var lines = [];
      for (var i = 0; i < outs.length; i++) {
        var q = parseQty(outs[i].qtyText, outs[i].unit);
        if (!(q > 0)) { alert('「' + outs[i].name + '」の数量を入れてください'); return; }
        lines.push({ productId: outs[i].productId, name: outs[i].name, unit: outs[i].unit, qty: q });
      }
      var note = form.note.value.trim();
      POS.stockChange([{ productId: sp.id, name: sp.name, unit: sp.unit, qty: sq }], -1, { type: 'process', note: '原料 ' + note });
      POS.stockChange(lines, 1, { type: 'process', note: sp.name + 'から ' + note });
      POS.closeModal();
      render();
      POS.toast('加工を記録しました');
    }
    draw();
  }

  // ---------- 廃棄・調整 ----------
  function openWasteModal() {
    var list = tracked();
    var mode = 'waste';
    POS.openModal(
      '<h3>廃棄・調整</h3>' +
      '<form class="form" id="wForm" onsubmit="return false">' +
      '<div class="seg"><button type="button" class="btn small" data-m="waste">廃棄（減らす）</button>' +
      '<button type="button" class="btn small" data-m="minus">調整で減らす</button>' +
      '<button type="button" class="btn small" data-m="plus">調整で増やす</button></div>' +
      '<label>商品<select name="pid">' + productOptions(list) + '</select></label>' +
      '<label>数量（<span id="wUnit"></span>）<input name="qty" type="text" inputmode="decimal"></label>' +
      '<label>理由<input name="note" placeholder="例：期限切れ、計量誤差" autocomplete="off"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">記録</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.m) { mode = b.dataset.m; draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') {
          var f = $('wForm').elements;
          var p = productById(f.pid.value);
          var q = parseQty(f.qty.value, p.unit);
          if (!(q > 0)) { alert('数量を入れてください'); return; }
          POS.stockChange([{ productId: p.id, name: p.name, unit: p.unit, qty: q }], mode === 'plus' ? 1 : -1,
            { type: mode === 'waste' ? 'waste' : 'adjust', note: f.note.value.trim() });
          POS.closeModal();
          render();
          POS.toast('記録しました');
        }
      }
    );
    var f = $('wForm').elements;
    f.pid.addEventListener('change', draw);
    function draw() {
      POS.modalBody.querySelectorAll('[data-m]').forEach(function (x) { x.classList.toggle('on', x.dataset.m === mode); });
      $('wUnit').textContent = unitHint(productById(f.pid.value).unit);
    }
    draw();
  }

  // ---------- 棚卸 ----------
  function openCountModal() {
    var list = tracked();
    var stock = Store.getStock();
    POS.openModal(
      '<h3>棚卸</h3><div class="sub">実際に数えた在庫を入れてください。空欄の商品は変更しません（重さは kg）。</div>' +
      '<div id="cItems">' + list.map(function (p) {
        return '<div class="ritem"><div class="rname">' + esc(p.name) + '<small>帳簿上 ' + fmtQty(p.unit, stock[p.id] || 0) + '</small></div>' +
          '<input type="text" inputmode="decimal" data-pid="' + p.id + '" placeholder="' + unitHint(p.unit) + '"><span></span></div>';
      }).join('') + '</div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">棚卸を確定</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'cancel') POS.closeModal();
        if (b.dataset.act === 'save') {
          var n = 0;
          POS.modalBody.querySelectorAll('input[data-pid]').forEach(function (inp) {
            if (inp.value.trim() === '') return;
            var p = productById(inp.dataset.pid);
            var actual = p.unit === 'g' ? (Scale.parseWeight(inp.value, 'kg') || { grams: NaN }).grams : Math.round(Number(inp.value));
            if (!isFinite(actual) || actual < 0) return;
            var delta = actual - (Store.getStock()[p.id] || 0);
            if (!delta) return;
            POS.stockChange([{ productId: p.id, name: p.name, unit: p.unit, qty: delta }], 1, { type: 'count', actual: actual, note: '実在庫 ' + fmtQty(p.unit, actual) });
            n++;
          });
          POS.closeModal();
          render();
          POS.toast(n ? n + '品目の在庫を修正しました' : '変更はありませんでした');
        }
      },
      false
    );
  }

  // ---------- 商品ごとの履歴 ----------
  function openHistory(p) {
    if (!p) return;
    var moves = allMoves().filter(function (m) { return m.productId === p.id; }).slice(-50).reverse();
    // 店頭販売は売上データから集計（直近7日）
    var days = [];
    var d0 = new Date();
    for (var i = 0; i < 7; i++) days.push(POS.localDate(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i)));
    var perDay = {};
    Store.getSales().forEach(function (s) {
      if (s.void || days.indexOf(s.date) < 0) return;
      s.lines.forEach(function (l) { if (l.productId === p.id) perDay[s.date] = (perDay[s.date] || 0) + l.qty; });
    });
    var stock = Store.getStock()[p.id] || 0;
    POS.openModal(
      '<h3>' + esc(p.name) + '</h3><div class="sub">現在の在庫 <b>' + fmtQty(p.unit, stock) + '</b>' +
      (p.cost ? '・最終仕入単価 ' + yen(p.cost) + (p.unit === 'g' ? '/kg' : '/個') : '') + '</div>' +
      '<h2>店頭販売（直近7日）</h2><div class="table-wrap"><table><tbody>' + days.map(function (d) {
        return '<tr><td>' + POS.weekday(d) + '</td><td class="r num">' + (perDay[d] ? fmtQty(p.unit, perDay[d]) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<h2>入出庫の履歴</h2>' + (moves.length ? movesTable(moves, false) : '<p class="note">記録はありません。</p>') +
      '<div class="modal-foot"><span></span><button class="btn primary" data-act="close">閉じる</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (b && b.dataset.act === 'close') POS.closeModal();
      }
    );
  }

  // 卸の画面からも使う
  // ---------- 発注書 ----------
  function knownSuppliers() {
    var s = {};
    POS.products().forEach(function (p) { if (p.supplier) s[p.supplier] = true; });
    Store.getMoves().forEach(function (m) { if (m.type === 'in' && m.supplier) s[m.supplier] = true; });
    Store.getOrders().forEach(function (o) { if (o.supplier) s[o.supplier] = true; });
    return Object.keys(s);
  }
  function onOrder() {
    var a = {};
    Store.getOrders().forEach(function (o) {
      if (o.status !== 'open') return;
      o.lines.forEach(function (l) { a[l.productId] = (a[l.productId] || 0) + l.qty; });
    });
    return a;
  }
  function suggestions() {
    var today = POS.localDate(new Date());
    return Calc.suggestOrder(tracked(), Store.getStock(), Calc.allocated(Store.getReservations(), Store.getSlips(), today), onOrder());
  }
  function ordersHtml() {
    var open = Store.getOrders().filter(function (o) { return o.status === 'open'; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var sug = suggestions();
    var h = '<h2>発注</h2>';
    if (sug.length) {
      h += '<div class="list-item" style="border-left:6px solid #d9a441"><div class="li-top"><span class="li-title">発注点を下回っている商品が ' + sug.length + '品目あります</span></div>' +
        '<div class="li-sub">' + sug.map(function (x) { return esc(x.name) + ' ' + fmtQty(x.unit, x.qty); }).join('、') + '</div>' +
        '<div class="btn-row"><button class="btn primary" data-inv="order">発注書を作る</button></div></div>';
    } else {
      h += '<div class="btn-row"><button class="btn" data-inv="order">発注書を作る</button></div>';
    }
    h += open.length ? open.map(function (o) {
      return '<div class="list-item"><div class="li-top"><span class="li-title">' + esc(o.supplier || '仕入先未入力') + '</span>' +
        '<span class="pill warn">発注済・未入荷</span><span class="li-sub">No.' + esc(o.noLabel || o.no) + '・' + o.date + ' 発注' + (o.deliveryDate ? '・' + o.deliveryDate + ' 納品希望' : '') + '</span></div>' +
        '<div class="li-sub">' + o.lines.map(function (l) { return esc(l.name) + ' ' + fmtQty(l.unit, l.qty); }).join('、') + '</div>' +
        '<div class="btn-row"><button class="btn primary" data-ord="receive" data-id="' + o.id + '">入荷として記録</button>' +
        '<button class="btn" data-ord="print" data-id="' + o.id + '">発注書を印刷</button>' +
        '<button class="btn" data-ord="share" data-id="' + o.id + '">文章で送る</button>' +
        '<button class="btn danger-outline" data-ord="cancel" data-id="' + o.id + '">取消</button></div></div>';
    }).join('') : '<p class="note">未入荷の発注はありません。</p>';
    return h;
  }

  function openOrderModal() {
    var sug = suggestions();
    var sups = knownSuppliers();
    var supplier = sug.length && sug[0].supplier ? sug[0].supplier : (sups[0] || '');
    var items = [];
    function fillFor(sup) {
      items = sug.filter(function (x) { return !sup || !x.supplier || x.supplier === sup; }).map(function (x) {
        return { productId: x.productId, name: x.name, unit: x.unit, qtyText: qtyInputValue(x.unit, x.qty) };
      });
    }
    fillFor(supplier);
    var t = new Date();
    var tomorrow = POS.localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
    POS.openModal(
      '<h3>発注書を作る</h3><div class="sub">発注点を下回っている商品を、適正在庫まで発注する量で入れてあります（重さは kg）。</div>' +
      '<form class="form" id="oForm" onsubmit="return false">' +
      '<label>仕入先<input name="supplier" list="oSupList" value="' + esc(supplier) + '" autocomplete="off"><datalist id="oSupList">' +
      sups.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></label>' +
      '<label>納品希望日<input type="date" name="delivery" value="' + tomorrow + '"></label>' +
      '<div><div id="oItems"></div><div class="radd"><select id="oSel">' + productOptions(tracked()) + '</select><button type="button" class="btn" data-act="add">＋ 追加</button></div></div>' +
      '<label>連絡事項<input name="note" autocomplete="off" placeholder="例：午前中に納品をお願いします"></label></form>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">発注書を保存して印刷</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'add') {
          var p = productById($('oSel').value);
          items.push({ productId: p.id, name: p.name, unit: p.unit, qtyText: '' });
          draw();
        } else if (b.dataset.del != null) { items.splice(Number(b.dataset.del), 1); draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'save') save();
      },
      false
    );
    var f = $('oForm').elements;
    f.supplier.addEventListener('change', function () { fillFor(f.supplier.value.trim()); draw(); });
    POS.modalBody.oninput = function (e) { var i = e.target.dataset.i; if (i != null) items[i].qtyText = e.target.value; };
    function draw() {
      $('oItems').innerHTML = items.length ? items.map(function (it, i) {
        var stock = Store.getStock()[it.productId] || 0;
        return '<div class="ritem"><div class="rname">' + esc(it.name) + '<small>在庫 ' + fmtQty(it.unit, stock) + '・' + unitHint(it.unit) + '</small></div>' +
          '<input type="text" inputmode="decimal" data-i="' + i + '" value="' + esc(it.qtyText) + '" placeholder="' + unitHint(it.unit) + '">' +
          '<button type="button" data-del="' + i + '">×</button></div>';
      }).join('') : '<p class="note">下で商品を選んで「追加」</p>';
    }
    function save() {
      if (!items.length) { alert('商品を追加してください'); return; }
      var lines = [];
      for (var i = 0; i < items.length; i++) {
        var q = parseQty(items[i].qtyText, items[i].unit);
        if (!(q > 0)) { alert('「' + items[i].name + '」の数量を入れてください'); return; }
        lines.push({ productId: items[i].productId, name: items[i].name, unit: items[i].unit, qty: q });
      }
      var n = Store.makeNo('oseq');
      var o = {
        id: Store.newId('O'), no: n.no, noLabel: n.noLabel, createdAt: new Date().toISOString(), date: POS.localDate(new Date()),
        supplier: f.supplier.value.trim(), deliveryDate: f.delivery.value, note: f.note.value.trim(), lines: lines, status: 'open', staff: POS.staffName()
      };
      var list = Store.getOrders();
      list.push(o);
      Store.saveOrders(list);
      POS.log('order', '発注 No.' + o.noLabel + ' ' + (o.supplier || '') + ' ' + lines.length + '品目');
      POS.closeModal();
      render();
      printOrder(o);
    }
    draw();
  }

  function orderText(o) {
    var st = POS.settings();
    return (o.supplier ? o.supplier + ' 様\n' : '') + 'いつもお世話になっております。' + st.storeName + 'です。\n下記の発注をお願いいたします。\n\n' +
      o.lines.map(function (l) { return '・' + l.name + '　' + fmtQty(l.unit, l.qty); }).join('\n') +
      (o.deliveryDate ? '\n\n納品希望日：' + o.deliveryDate : '') + (o.note ? '\n' + o.note : '') +
      '\n\n' + st.storeName + (st.tel ? '　TEL ' + st.tel : '') + '\n（発注No.' + (o.noLabel || o.no) + '）';
  }
  function printOrder(o) {
    var st = POS.settings();
    POS.printDoc('<h1>発注書</h1><div class="head"><div><div class="to">' + esc(o.supplier || '') + '　御中</div>' +
      '<p>下記のとおり発注いたします。</p>' + (o.deliveryDate ? '<div>納品希望日　<b>' + o.deliveryDate.replace(/-/g, '/') + '</b></div>' : '') + '</div>' +
      '<div><div class="meta">発注No. ' + esc(o.noLabel || o.no) + '<br>発注日 ' + o.date.replace(/-/g, '/') + '</div>' +
      '<div class="from"><div class="name">' + esc(st.storeName) + '</div>' + (st.address ? esc(st.address) + '<br>' : '') + (st.tel ? 'TEL ' + esc(st.tel) : '') + '</div></div></div>' +
      '<table><thead><tr><th>品名</th><th>数量</th><th>備考</th></tr></thead><tbody>' +
      o.lines.map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="r">' + fmtQty(l.unit, l.qty) + '</td><td></td></tr>'; }).join('') +
      '</tbody></table>' + (o.note ? '<div class="notes">連絡事項：' + esc(o.note) + '</div>' : ''));
  }
  function shareOrder(o) {
    var text = orderText(o);
    if (navigator.share) {
      navigator.share({ text: text, title: '発注書' }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { POS.toast('発注の文章をコピーしました。LINEやメールに貼り付けてください'); }, function () { prompt('この文章をコピーしてください', text); });
    } else prompt('この文章をコピーしてください', text);
  }

  $('invRoot').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ord]');
    if (!b) return;
    var list = Store.getOrders();
    var o = list.find(function (x) { return x.id === b.dataset.id; });
    if (!o) return;
    var act = b.dataset.ord;
    if (act === 'print') printOrder(o);
    if (act === 'share') shareOrder(o);
    if (act === 'cancel') {
      if (!confirm('発注 No.' + (o.noLabel || o.no) + ' を取り消しますか？')) return;
      o.status = 'cancelled';
      Store.saveOrders(list);
      POS.log('order', '発注 No.' + (o.noLabel || o.no) + ' を取消');
      render();
    }
    if (act === 'receive') {
      openItemsModal({
        supplier: o.supplier,
        note: '発注No.' + (o.noLabel || o.no),
        items: o.lines.map(function (l) {
          var p = productById(l.productId);
          return { productId: l.productId, name: l.name, unit: l.unit, qtyText: qtyInputValue(l.unit, l.qty), cost: (p && p.cost) || '' };
        }),
        onSaved: function () {
          var l2 = Store.getOrders();
          var x = l2.find(function (y) { return y.id === o.id; });
          x.status = 'received';
          x.receivedAt = new Date().toISOString();
          Store.saveOrders(l2);
          render();
        }
      });
    }
  });

  POS.inv = { fmtQty: fmtQty, parseQty: parseQty, qtyInputValue: qtyInputValue, unitHint: unitHint, render: render };
});
