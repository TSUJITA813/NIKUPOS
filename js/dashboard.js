/*
 * ダッシュボード（売上タブ → ダッシュボード）
 *  今日（リアルタイム）・今週・今月・今年の売上と利益（粗利・利益の目安）
 *  前の期間の「同じところまで」と比べる（今日は先週の同じ曜日の同じ時刻まで）
 *  パソコンのブラウザで開けば、そのまま管理画面として使える（…/#dashboard で直接開く）
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;
  var kind = 'day';
  var offset = 0;
  var unlocked = false;   // 店主の承認で利益を表示中
  var timer = null;

  function data() {
    return {
      sales: Store.getSales(), slips: Store.getSlips(), cashmoves: Store.getCashMoves(),
      products: POS.products(), fixedCosts: POS.settings().fixedCosts || []
    };
  }
  function compact(n) {
    var a = Math.abs(n);
    if (a >= 100000000) return (Math.round(n / 1000000) / 100).toLocaleString('ja-JP') + '億';
    if (a >= 10000) return (Math.round(n / 1000) / 10).toLocaleString('ja-JP') + '万';
    return num(n);
  }
  function pct(r) { return r == null ? '—' : (Math.round(r * 1000) / 10).toLocaleString('ja-JP') + '%'; }
  function signedYen(n) { return (n < 0 ? '-' : '') + yen(Math.abs(n)); }
  function delta(cur, prev, label, fmt) {
    fmt = fmt || yen;
    if (!prev) return '<div class="note">' + esc(label) + '：' + fmt(prev || 0) + '</div>';
    var r = (cur - prev) / Math.abs(prev);
    return '<div class="note ' + (r < 0 ? 'neg' : 'up') + '">' + (r >= 0 ? '▲ +' : '▼ ') + (Math.round(r * 1000) / 10) + '%' +
      '<span class="dash-cmp">（' + esc(label) + ' ' + fmt(prev) + '）</span></div>';
  }
  /** 比べる相手の短い名前 */
  function shortCmp(p) {
    return { day: '先週同曜日', week: '先週', month: '先月', year: '昨年' }[p.kind];
  }

  POS.salesTabs.dash = function (box) {
    var now = new Date();
    var today = POS.localDate(now);
    var p = Profit.period(kind, today, offset);
    var current = today >= p.from && today <= p.to;
    var d = data();
    var r = Profit.compute(d, p, { fixedUntil: current ? today : null });
    var prev = Profit.previous(p, now);
    var b = Profit.compute(d, prev.period, { until: prev.until, fixedUntil: prev.fixedUntil });
    var gated = POS.needsApproval('profit') && !unlocked;
    var cmpLabel = shortCmp(p);

    var h = '<div class="toolbar dash-bar"><div class="seg compact">' + [['day', '今日'], ['week', '今週'], ['month', '今月'], ['year', '今年']].map(function (x) {
      return '<button class="btn small' + (kind === x[0] && offset === 0 ? ' on' : '') + '" data-k="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>' +
      '<span class="dash-nav"><button class="btn small" data-off="-1" aria-label="前の期間">◀</button><b class="dash-label">' + esc(p.label) + '</b>' +
      '<button class="btn small" data-off="1" aria-label="次の期間"' + (current ? ' disabled' : '') + '>▶</button></span>' +
      (current ? '<span class="live"><span class="live-dot"></span>リアルタイム・' + POS.timeStr(now) + ' 更新</span>' : '') +
      '<span class="spacer"></span>' +
      (gated ? '' : '<button class="btn small" data-act="fixed">固定費の設定</button>') + '</div>';

    // ---- 大きな数字 ----
    var avg = r.count ? Math.round(r.store.sales / r.count) : 0;
    var bavg = b.count ? Math.round(b.store.sales / b.count) : 0;
    h += '<div class="cards dash-cards">' +
      POS.card('売上（税込）', yen(r.sales) + delta(r.sales, b.sales, cmpLabel)) +
      POS.card('客数', num(r.count) + '件<span class="dash-rate">客単価 ' + yen(avg) + '</span>' + delta(r.count, b.count, cmpLabel, function (n) { return num(n) + '件'; })) +
      (gated
        ? POS.card('粗利・利益', '<button class="btn small" data-act="unlock">店主の承認で表示</button>')
        : POS.card('粗利（率）', signedYen(r.gross) + '<span class="dash-rate">' + pct(r.grossRate) + '</span>' + delta(r.gross, b.gross, cmpLabel)) +
          POS.card('利益の目安', '<span class="' + (r.profit < 0 ? 'neg' : '') + '">' + signedYen(r.profit) + '</span>' + delta(r.profit, b.profit, cmpLabel))) +
      '</div><p class="note dash-cmpnote">比べている期間：' + esc(prev.label) + '（' + esc(prev.period.label) + '）</p>';

    // ---- グラフ ----
    h += chartHtml(r, p, gated);

    if (!gated) {
      // ---- 損益（期間のまとめ） ----
      var rows = [
        ['売上（税込）', yen(r.sales), ''],
        ['　消費税', '-' + yen(r.tax), ''],
        ['売上（税抜）', yen(r.excl), 'b'],
        ['　店頭', yen(r.store.excl), 'sub'],
        ['　卸', yen(r.wholesale.excl), 'sub', r.wholesale.count ? r.wholesale.count + '件' : ''],
        ['原価', '-' + yen(r.cost), '', r.uncovered ? '原価が登録された商品の分' : ''],
        ['粗利', signedYen(r.gross), 'b', '粗利率 ' + pct(r.grossRate)]
      ];
      if (r.uncovered) rows.push(['　原価が未登録の売上の粗利（見込み）', signedYen(r.grossEst - r.gross), 'sub', '同じ粗利率で計算']);
      rows.push(['経費（レジの出金）', '-' + yen(r.expenses), '']);
      Object.keys(r.expenseBy).forEach(function (k) { rows.push(['　' + k, yen(r.expenseBy[k]), 'sub']); });
      rows.push(['固定費（月額の日割り' + (current ? '・今日まで' : '') + '）', '-' + yen(r.fixed), '']);
      Object.keys(r.fixedBy).forEach(function (k) { rows.push(['　' + k, yen(r.fixedBy[k]), 'sub']); });
      rows.push(['利益の目安', signedYen(r.profit), 'total']);
      h += '<div class="dash-grid"><div><h2>損益のまとめ（' + esc(p.label) + '）</h2><div class="table-wrap"><table class="pl"><tbody>' +
        rows.map(function (x) {
          return '<tr class="' + x[2] + '"><td>' + esc(x[0]) + (x[3] ? '<span class="pl-note">' + esc(x[3]) + '</span>' : '') + '</td><td class="r num">' + x[1] + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' + notes(r) + '</div>';

      // ---- 商品別の粗利 ----
      var items = r.itemList.filter(function (it) { return it.excl || it.cost; }).slice(0, 20);
      h += '<div><h2>商品別の粗利</h2>' + (items.length ? '<div class="table-wrap"><table><thead><tr><th>商品</th><th class="r">売上（税抜）</th><th class="r">原価</th><th class="r">粗利</th><th class="r">粗利率</th></tr></thead><tbody>' +
        items.map(function (it) {
          return '<tr><td>' + esc(it.name) + '</td><td class="r num">' + yen(it.excl) + '</td>' +
            (it.hasCost
              ? '<td class="r num">' + yen(it.cost) + '</td><td class="r num' + (it.gross < 0 ? ' neg' : '') + '">' + signedYen(it.gross) + '</td><td class="r num">' + pct(it.rate) + '</td>'
              : '<td class="r note" colspan="3">原価が未登録</td>') + '</tr>';
        }).join('') + '</tbody></table></div>' : '<p class="note">この期間の売上はありません。</p>') + '</div></div>';
    } else {
      h += '<p class="note">粗利・原価・経費などは、店主の承認で表示できます（設定 → 担当者と権限 で変えられます）。</p>';
    }

    box.innerHTML = h;
    box.onclick = onClick;
    box.onpointerover = function (e) { var c = e.target.closest('.scol'); if (c && e.pointerType === 'mouse') read(c); };

    // 今の期間を表示している間は、30秒ごとに新しくする（ほかの端末の売上もクラウド同期で届く）
    clearInterval(timer);
    if (current) {
      timer = setInterval(function () {
        var pane = $('salesPane');
        if (!$('view-sales').classList.contains('active') || pane.hidden || !pane.querySelector('.dash-bar') || !$('modal').hidden) {
          if (!pane.querySelector('.dash-bar')) clearInterval(timer);
          return;
        }
        POS.salesTabs.dash(pane);
      }, 30000);
    }
  };

  function notes(r) {
    var h = '';
    if (r.noCostList.length) {
      h += '<p class="note">原価が登録されている売上は ' + pct(r.coverage) + ' です。原価が未登録の商品：' +
        esc(r.noCostList.slice(0, 8).join('、')) + (r.noCostList.length > 8 ? ' ほか' : '') +
        '。「商品」タブで原価を入れる（入荷で仕入単価を入れると自動で入ります）と、利益が正確になります。</p>';
    }
    h += '<p class="note">利益の目安は、粗利から経費（レジの出金。仕入高・事業主貸・預金への入金は除く）と固定費を引いたものです。' +
      'レジを通さない支払い（口座引き落としの光熱費など）は「固定費の設定」に月額で入れてください。正式な決算は会計ソフトで行ってください。</p>';
    return h;
  }

  /** 積み上げ縦棒：原価（下）＋粗利（上）、原価未登録の売上は斜線 */
  function chartHtml(r, p, gated) {
    var keys = Object.keys(r.buckets);
    if (p.bucket === 'hour') {
      var lo = 24, hi = -1;
      keys.forEach(function (k) { var x = r.buckets[k]; if (x.excl || x.count) { lo = Math.min(lo, +k); hi = Math.max(hi, +k); } });
      if (hi < 0) { lo = 9; hi = 19; }
      lo = Math.min(lo, 9); hi = Math.max(hi, Math.min(19, 23));
      keys = keys.filter(function (k) { return +k >= lo && +k <= hi; });
    }
    var items = keys.map(function (k) {
      var x = r.buckets[k];
      var label, short;
      if (p.bucket === 'hour') { label = k + '時台'; short = String(k); }
      else if (p.bucket === 'month') { label = k + '月'; short = String(k); }
      else { var dd = k.split('-'); label = Number(dd[1]) + '/' + Number(dd[2]); short = String(Number(dd[2])); if (p.kind === 'week') short = label; }
      return { label: label, short: short, x: x };
    });
    var max = Math.max.apply(null, items.map(function (i) { return Math.max(0, i.x.excl, i.x.cost + Math.max(0, i.x.gross) + Math.max(0, i.x.uncovered)); }).concat([0]));
    var maxIdx = items.findIndex(function (i) { return max > 0 && Math.max(i.x.excl, i.x.cost + Math.max(0, i.x.gross) + Math.max(0, i.x.uncovered)) === max; });
    var title = gated ? '売上（税抜）' : '売上（税抜）の内訳：原価と粗利';
    var unit = { hour: '時間帯別', day: '日別', month: '月別' }[p.bucket];
    var h = '<div class="chart-card"><div class="chart-title">' + title + '（' + unit + '）</div>' +
      (gated ? '' : '<div class="legend"><span><i class="sw sw-gross"></i>粗利</span><span><i class="sw sw-cost"></i>原価</span>' +
        (r.uncovered ? '<span><i class="sw sw-unk"></i>原価が未登録の売上</span>' : '') + '</div>') +
      '<div class="chart-read" id="dashRead">棒をタップすると値を表示</div>' +
      '<div class="scols' + (items.length > 16 ? ' dense' : '') + '">' + items.map(function (it, i) {
        var x = it.x;
        var segs;
        if (gated) segs = [['sales', Math.max(0, x.excl)]];
        else segs = [['unk', Math.max(0, x.uncovered)], ['gross', Math.max(0, x.gross)], ['cost', Math.max(0, x.cost)]];
        var read = it.label + '：売上（税抜）' + yen(x.excl) + (gated ? '' :
          '・原価 ' + yen(x.cost) + '・粗利 ' + signedYen(x.gross) + (x.uncovered ? '・原価未登録 ' + yen(x.uncovered) : '')) + '・' + x.count + '件';
        return '<div class="scol" data-read="' + esc(read) + '"><div class="col-val">' + (i === maxIdx ? compact(x.excl) : '') + '</div>' +
          '<div class="sbar-wrap"><div class="sbar">' + segs.map(function (s) {
            var hgt = max > 0 ? (s[1] / max) * 100 : 0;
            return hgt > 0 ? '<i class="seg-' + s[0] + '" style="height:' + hgt + '%"></i>' : '';
          }).join('') + '</div></div><div class="col-label">' + esc(it.short) + '</div></div>';
      }).join('') + '</div>' +
      '<details class="chart-table"><summary>表で見る</summary><div class="table-wrap"><table><thead><tr><th></th><th class="r">売上（税込）</th><th class="r">売上（税抜）</th>' +
      (gated ? '' : '<th class="r">原価</th><th class="r">粗利</th><th class="r">原価未登録</th>') + '<th class="r">客数</th></tr></thead><tbody>' +
      items.map(function (it) {
        var x = it.x;
        return '<tr><td>' + esc(it.label) + '</td><td class="r num">' + yen(x.sales) + '</td><td class="r num">' + yen(x.excl) + '</td>' +
          (gated ? '' : '<td class="r num">' + yen(x.cost) + '</td><td class="r num">' + signedYen(x.gross) + '</td><td class="r num">' + yen(x.uncovered) + '</td>') +
          '<td class="r num">' + x.count + '</td></tr>';
      }).join('') + '</tbody></table></div></details></div>';
    return h;
  }

  function read(c) {
    document.querySelectorAll('.scol.sel').forEach(function (x) { x.classList.remove('sel'); });
    c.classList.add('sel');
    var out = $('dashRead');
    if (out) out.textContent = c.dataset.read;
  }

  function onClick(e) {
    var t = e.target.closest('[data-k],[data-off],[data-act],.scol');
    if (!t) return;
    if (t.classList.contains('scol')) { read(t); return; }
    if (t.dataset.k) { kind = t.dataset.k; offset = 0; }
    else if (t.dataset.off) offset = Math.min(0, offset + Number(t.dataset.off));
    else if (t.dataset.act === 'unlock') {
      POS.requirePerm('profit', '利益を見る').then(function (ok) { if (ok) { unlocked = true; POS.renderSalesTab(); } });
      return;
    } else if (t.dataset.act === 'fixed') { openFixedCosts(); return; }
    POS.renderSalesTab();
  }

  /** 固定費（月額）の設定 */
  function openFixedCosts() {
    var list = (POS.settings().fixedCosts || []).map(function (f) { return { name: f.name, amount: f.amount }; });
    if (!list.length) list = [{ name: '家賃', amount: '' }, { name: '人件費', amount: '' }, { name: '水道光熱費', amount: '' }];
    function rowsHtml() {
      return list.map(function (f, i) {
        return '<div class="fc-row"><input data-fi="' + i + '" data-ff="name" value="' + esc(f.name || '') + '" placeholder="名前（例：家賃）" autocomplete="off">' +
          '<input data-fi="' + i + '" data-ff="amount" type="number" inputmode="numeric" min="0" step="1" value="' + esc(f.amount === 0 ? '0' : f.amount || '') + '" placeholder="月額（円）">' +
          '<button type="button" class="btn small" data-fdel="' + i + '" aria-label="削除">×</button></div>';
      }).join('');
    }
    POS.openModal('<h3>固定費の設定（月額）</h3><div class="sub">家賃・人件費・水道光熱費・リース代など、毎月かかるお金を月額で入れてください。' +
      '日割りにして「利益の目安」から差し引きます。レジの出金で払ったものは、ここに入れないでください（二重になります）。</div>' +
      '<div id="fcRows">' + rowsHtml() + '</div>' +
      '<div class="btn-row"><button type="button" class="btn small" data-fadd="1">＋ 行を追加</button></div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" data-act="save">保存</button></div>',
    function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.fadd) { list.push({ name: '', amount: '' }); $('fcRows').innerHTML = rowsHtml(); return; }
      if (b.dataset.fdel != null) { list.splice(Number(b.dataset.fdel), 1); $('fcRows').innerHTML = rowsHtml(); return; }
      if (b.dataset.act === 'cancel') { POS.closeModal(); return; }
      if (b.dataset.act === 'save') {
        POS.requirePerm('settings', '固定費の設定').then(function (ok) {
          if (!ok) return;
          POS.settings().fixedCosts = list.map(function (f) { return { name: String(f.name || '').trim(), amount: Math.max(0, Math.floor(Number(f.amount) || 0)) }; })
            .filter(function (f) { return f.name || f.amount; });
          POS.saveSettings();
          POS.log('settings', '固定費を保存（月額 合計 ' + yen(POS.settings().fixedCosts.reduce(function (a, f) { return a + f.amount; }, 0)) + '）');
          POS.closeModal();
          POS.renderSalesTab();
          POS.toast('固定費を保存しました');
        });
      }
    });
    POS.modalBody.oninput = function (e) {
      var i = e.target.dataset.fi;
      if (i == null) return;
      list[i][e.target.dataset.ff] = e.target.value;
    };
  }

  // 担当者が変わったら、承認での表示を取り消す
  document.addEventListener('nikupos:staff', function () { unlocked = false; });
});
