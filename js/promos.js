/*
 * タイムセール・まとめ売りの設定（商品タブ）
 *  タイムセール：対象（すべて／カテゴリ／商品）を、曜日・時間帯・期間で自動値引き（○%引き、または100gあたり・1個あたり○円引き）
 *  まとめ売り：対象の個数売り商品をどれでも N個で X円（例：焼き鳥どれでも5本で500円）
 *  計算は Calc.applyPromos。設定は全端末で共有（settings.promos）
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen;
  var DAYS = ['日', '月', '火', '水', '木', '金', '土'];

  function promos() { return POS.settings().promos || []; }
  function save(list) { POS.settings().promos = list; POS.saveSettings(); }

  function condText(p) {
    var t = [];
    if (p.days && p.days.length && p.days.length < 7) t.push(p.days.map(function (d) { return DAYS[d]; }).join('・') + '曜');
    if (p.timeFrom || p.timeTo) t.push((p.timeFrom || '') + '〜' + (p.timeTo || ''));
    if (p.dateFrom || p.dateTo) t.push((p.dateFrom || '') + '〜' + (p.dateTo || ''));
    return t.join('　') || 'いつでも';
  }
  function targetText(p) {
    if (p.target === 'all') return 'すべての商品';
    if (p.target === 'category') return 'カテゴリ：' + (p.ids || []).join('・');
    var names = POS.products().filter(function (x) { return (p.ids || []).indexOf(x.id) >= 0; }).map(function (x) { return x.name; });
    return '商品：' + (names.join('・') || '（なし）');
  }
  function valueText(p) {
    if (p.type === 'bundle') return 'どれでも ' + p.bundleQty + '個で ' + yen(p.bundlePrice);
    return p.discountType === 'pct' ? p.value + '%引き' : '100gあたり・1個あたり ' + yen(p.value) + '引き';
  }

  function render() {
    var box = $('promoBox');
    if (!box) return;
    var now = new Date();
    var list = promos();
    box.innerHTML = '<div class="btn-row"><button class="btn small primary" data-pr="new-timesale">＋ タイムセール</button>' +
      '<button class="btn small primary" data-pr="new-bundle">＋ まとめ売り</button></div>' +
      (list.length ? list.map(function (p) {
        var on = Calc.promoActive(p, now);
        return '<div class="list-item' + (p.active ? '' : ' dim') + '"><div class="li-top"><span class="li-title">' + esc(p.name) + '</span>' +
          '<span class="pill ' + (on ? 'ok' : 'gray') + '">' + (on ? '実施中' : p.active ? '時間外' : '停止中') + '</span>' +
          '<span class="pill gray">' + (p.type === 'bundle' ? 'まとめ売り' : 'タイムセール') + '</span>' +
          '<span class="li-amt">' + esc(valueText(p)) + '</span></div>' +
          '<div class="li-sub">' + esc(targetText(p)) + '　' + esc(condText(p)) + '</div>' +
          '<div class="btn-row"><button class="btn small" data-pr="edit" data-id="' + p.id + '">編集</button>' +
          '<button class="btn small" data-pr="toggle" data-id="' + p.id + '">' + (p.active ? '停止する' : '再開する') + '</button></div></div>';
      }).join('') : '<p class="note">「閉店前の惣菜2割引」「焼き鳥どれでも5本で500円」などを登録すると、レジで自動的に値引きします。手動で値引きした商品には重ねません。</p>');
  }
  var prev = POS.views.products;
  POS.views.products = function () { if (prev) prev(); render(); };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#promoBox [data-pr]');
    if (!b) return;
    var act = b.dataset.pr;
    POS.requirePerm('settings', 'タイムセール・まとめ売りの変更').then(function (ok) {
      if (!ok) return;
      if (act === 'new-timesale') openEdit({ type: 'timesale', name: '', active: true, target: 'category', ids: [], discountType: 'pct', value: 20, days: [], timeFrom: '18:00', timeTo: '' });
      else if (act === 'new-bundle') openEdit({ type: 'bundle', name: '', active: true, target: 'product', ids: [], bundleQty: 5, bundlePrice: 500, days: [] });
      else {
        var list = promos();
        var p = list.find(function (x) { return x.id === b.dataset.id; });
        if (!p) return;
        if (act === 'edit') openEdit(JSON.parse(JSON.stringify(p)));
        if (act === 'toggle') {
          p.active = !p.active;
          save(list);
          POS.log('settings', (p.active ? '再開：' : '停止：') + p.name);
          render();
        }
      }
    });
  });

  function openEdit(p) {
    var isNew = !p.id;
    var cats = POS.categories();
    var prods = POS.products().filter(function (x) { return x.unit !== 'open' && (p.type !== 'bundle' || x.unit === 'pc'); });
    POS.openModal(
      '<h3>' + (p.type === 'bundle' ? 'まとめ売り' : 'タイムセール') + (isNew ? 'を追加' : 'の編集') + '</h3>' +
      '<form class="form" id="prForm" onsubmit="return false" style="margin-top:8px">' +
      '<label>名前（レシートに印刷されます）<input name="name" value="' + esc(p.name) + '" placeholder="' + (p.type === 'bundle' ? '例：焼き鳥5本500円' : '例：閉店前 惣菜2割引') + '" autocomplete="off"></label>' +
      (p.type === 'bundle'
        ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label>何個で<input name="bundleQty" type="number" inputmode="numeric" min="2" value="' + p.bundleQty + '"></label>' +
          '<label>いくら（税込・円）<input name="bundlePrice" type="number" inputmode="numeric" min="1" value="' + p.bundlePrice + '"></label></div>' +
          '<p class="note">対象の商品を組み合わせて数えます。対象にできるのは個数売りの商品です。</p>'
        : '<label>値引き<div class="seg"><button type="button" class="btn small" data-dt="pct">○%引き</button><button type="button" class="btn small" data-dt="yen">○円引き（100gあたり・1個あたり）</button></div></label>' +
          '<label><span id="prValLabel"></span><input name="value" type="number" inputmode="numeric" min="1" value="' + p.value + '"></label>') +
      '<label>対象<div class="seg">' + (p.type === 'bundle' ? '' : '<button type="button" class="btn small" data-tg="all">すべて</button><button type="button" class="btn small" data-tg="category">カテゴリ</button>') +
      '<button type="button" class="btn small" data-tg="product">商品を選ぶ</button></div></label>' +
      '<div id="prTargets"></div>' +
      '<label>曜日（選ばなければ毎日）<div class="seg">' + DAYS.map(function (d, i) { return '<button type="button" class="btn small" data-day="' + i + '">' + d + '</button>'; }).join('') + '</div></label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label>開始時刻<input name="timeFrom" type="time" value="' + esc(p.timeFrom || '') + '"></label>' +
      '<label>終了時刻（空欄なら閉店まで）<input name="timeTo" type="time" value="' + esc(p.timeTo || '') + '"></label>' +
      '<label>開始日（空欄なら今日から）<input name="dateFrom" type="date" value="' + esc(p.dateFrom || '') + '"></label>' +
      '<label>終了日（空欄ならずっと）<input name="dateTo" type="date" value="' + esc(p.dateTo || '') + '"></label></div>' +
      '</form>' +
      '<div class="modal-foot">' + (isNew ? '<button class="btn" data-act="cancel">キャンセル</button>' : '<button class="btn danger-outline" data-act="del">削除</button>') +
      '<button class="btn primary" data-act="save">保存</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.dt) { p.discountType = b.dataset.dt; draw(); }
        else if (b.dataset.tg) { if (p.target !== b.dataset.tg) p.ids = []; p.target = b.dataset.tg; draw(); }
        else if (b.dataset.day != null) {
          var d = Number(b.dataset.day);
          p.days = p.days || [];
          var i = p.days.indexOf(d);
          if (i >= 0) p.days.splice(i, 1); else p.days.push(d);
          draw();
        } else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'del') {
          if (!confirm('「' + p.name + '」を削除しますか？')) return;
          save(promos().filter(function (x) { return x.id !== p.id; }));
          POS.log('settings', '削除：' + p.name);
          POS.closeModal();
          render();
        } else if (b.dataset.act === 'save') doSave();
      },
      false
    );
    POS.modalBody.onchange = function (e) {
      if (e.target.dataset.pick == null) return;
      var v = e.target.dataset.pick;
      p.ids = p.ids || [];
      var i = p.ids.indexOf(v);
      if (e.target.checked && i < 0) p.ids.push(v);
      if (!e.target.checked && i >= 0) p.ids.splice(i, 1);
    };
    function draw() {
      POS.modalBody.querySelectorAll('[data-dt]').forEach(function (x) { x.classList.toggle('on', x.dataset.dt === p.discountType); });
      POS.modalBody.querySelectorAll('[data-tg]').forEach(function (x) { x.classList.toggle('on', x.dataset.tg === p.target); });
      POS.modalBody.querySelectorAll('[data-day]').forEach(function (x) { x.classList.toggle('on', (p.days || []).indexOf(Number(x.dataset.day)) >= 0); });
      if ($('prValLabel')) $('prValLabel').textContent = p.discountType === 'pct' ? '割引率（%）' : '値引き額（円・100gあたり／1個あたり）';
      var opts = p.target === 'category' ? cats.map(function (c) { return [c, c]; }) : p.target === 'product' ? prods.map(function (x) { return [x.id, x.name]; }) : [];
      $('prTargets').innerHTML = opts.length ? '<div class="pick-grid">' + opts.map(function (o) {
        return '<label class="check"><input type="checkbox" data-pick="' + esc(o[0]) + '"' + ((p.ids || []).indexOf(o[0]) >= 0 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
      }).join('') + '</div>' : '';
    }
    function doSave() {
      var f = $('prForm').elements;
      p.name = f.name.value.trim();
      if (!p.name) { alert('名前を入れてください'); return; }
      if (p.target !== 'all' && !(p.ids || []).length) { alert('対象を選んでください'); return; }
      if (p.type === 'bundle') {
        p.bundleQty = Math.floor(Number(f.bundleQty.value) || 0);
        p.bundlePrice = Math.floor(Number(f.bundlePrice.value) || 0);
        if (p.bundleQty < 2 || p.bundlePrice < 1) { alert('個数（2以上）と金額を入れてください'); return; }
      } else {
        p.value = Math.floor(Number(f.value.value) || 0);
        if (!(p.value > 0) || (p.discountType === 'pct' && p.value > 100)) { alert('値引きを正しく入れてください'); return; }
      }
      p.timeFrom = f.timeFrom.value;
      p.timeTo = f.timeTo.value;
      p.dateFrom = f.dateFrom.value;
      p.dateTo = f.dateTo.value;
      var list = promos();
      if (isNew) { p.id = Store.newId('X'); list.push(p); } else list[list.findIndex(function (x) { return x.id === p.id; })] = p;
      save(list);
      POS.log('settings', (isNew ? '追加：' : '変更：') + p.name + '（' + valueText(p) + '・' + condText(p) + '）');
      POS.closeModal();
      render();
      POS.toast('保存しました');
    }
    draw();
  }

  // レジの商品ボタンに、実施中のタイムセールを表示
  POS.promoLabel = function (product) {
    var now = new Date();
    var hit = promos().filter(function (p) {
      if (!Calc.promoActive(p, now)) return false;
      if (p.target === 'all') return true;
      if (p.target === 'category') return (p.ids || []).indexOf(product.category) >= 0;
      return (p.ids || []).indexOf(product.id) >= 0;
    })[0];
    return hit ? hit.name : '';
  };
});
