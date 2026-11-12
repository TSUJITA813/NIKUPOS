/*
 * 売上分析（売上タブ → 分析）
 *  期間（今日／今週／今月／先月／今年／指定）の店頭売上を、前年同期と比べて表示
 *  時間帯別・曜日別・日別（縦棒）、商品ランキング（ABC分析）、カテゴリ別、担当者別、支払方法別、卸の得意先別
 *  グラフは1系列なので凡例なし。棒をタップ／ポイントすると値を表示。各グラフに「表で見る」
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;
  var DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var preset = 'month';
  var range = null;

  function ymd(d) { return POS.localDate(d); }
  function presetRange(k) {
    var t = new Date();
    var y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    if (k === 'today') return [ymd(t), ymd(t)];
    if (k === 'week') { var mon = new Date(y, m, d - ((t.getDay() + 6) % 7)); return [ymd(mon), ymd(t)]; }
    if (k === 'month') return [ymd(new Date(y, m, 1)), ymd(t)];
    if (k === 'last') return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    if (k === 'year') return [ymd(new Date(y, 0, 1)), ymd(t)];
    return range;
  }
  function lastYear(s) { var p = s.split('-').map(Number); return ymd(new Date(p[0] - 1, p[1] - 1, p[2])); }
  function compact(n) { return Math.abs(n) >= 10000 ? (Math.round(n / 1000) / 10).toLocaleString('ja-JP') + '万' : num(n); }

  function delta(cur, prev, fmt) {
    fmt = fmt || yen;
    if (!prev) return '<div class="note">前年同期 データなし</div>';
    var r = (cur - prev) / Math.abs(prev);
    var pct = Math.round(r * 1000) / 10;
    return '<div class="note ' + (r < 0 ? 'neg' : 'up') + '">' + (r >= 0 ? '▲ +' : '▼ ') + pct + '%（前年同期 ' + fmt(prev) + '）</div>';
  }

  /** 縦棒グラフ（1系列）。items: [{ label, value, sub }] */
  function columns(id, title, items, fmtVal) {
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([0]));
    var maxIdx = items.findIndex(function (i) { return i.value === max && max > 0; });
    return '<div class="chart-card"><div class="chart-title">' + title + '</div>' +
      '<div class="chart-read" id="' + id + 'Read">棒をタップすると値を表示</div>' +
      '<div class="cols" data-chart="' + id + '">' + items.map(function (it, i) {
        var h = max > 0 ? Math.max(0, Math.round((it.value / max) * 100)) : 0;
        return '<div class="col" data-i="' + i + '" data-read="' + esc(it.label + '：' + fmtVal(it.value) + (it.sub ? '（' + it.sub + '）' : '')) + '">' +
          '<div class="col-val">' + (i === maxIdx ? compact(it.value) : '') + '</div>' +
          '<div class="col-bar-wrap"><div class="col-bar" style="height:' + h + '%"></div></div>' +
          '<div class="col-label">' + esc(it.short || it.label) + '</div></div>';
      }).join('') + '</div>' +
      '<details class="chart-table"><summary>表で見る</summary><div class="table-wrap"><table><tbody>' +
      items.map(function (it) { return '<tr><td>' + esc(it.label) + '</td><td class="r num">' + fmtVal(it.value) + '</td><td class="r note">' + esc(it.sub || '') + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></div>';
  }
  /** 横棒（カテゴリ別など）。値は棒の先に */
  function hbars(title, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([0]));
    return '<div class="chart-card"><div class="chart-title">' + title + '</div>' + (rows.length ? rows.map(function (r) {
      var w = max > 0 ? Math.max(0, (r[1] / max) * 100) : 0;
      return '<div class="hbar"><span class="hbar-label">' + esc(r[0]) + '</span><span class="hbar-track"><span class="hbar-fill" style="width:' + w + '%"></span></span>' +
        '<span class="hbar-val num">' + yen(r[1]) + '</span></div>';
    }).join('') : '<p class="note">データがありません。</p>') + '</div>';
  }

  POS.salesTabs.analysis = function (box) {
    var r0 = presetRange(preset) || presetRange('month');
    range = r0;
    var from = r0[0], to = r0[1];
    var products = POS.products();
    var sales = Store.getSales();
    var a = Calc.analyze(sales, from, to, products);
    var b = Calc.analyze(sales, lastYear(from), lastYear(to), products);
    var hours = [];
    var hMin = 24, hMax = -1;
    a.byHour.forEach(function (x, h) { if (x.count || x.total) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); } });
    if (hMax < 0) { hMin = 9; hMax = 19; }
    for (var h = hMin; h <= hMax; h++) hours.push({ label: h + '時台', short: String(h), value: a.byHour[h].total, sub: a.byHour[h].count + '件' });
    var week = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      var x = a.byWeekday[d];
      return { label: DAYS[d] + '曜（1日平均）', short: DAYS[d], value: x.dayCount ? Math.round(x.total / x.dayCount) : 0, sub: x.dayCount + '日・' + x.count + '件' };
    });
    var dayKeys = Object.keys(a.days).sort();
    var days = dayKeys.map(function (d) { var p = d.split('-'); return { label: d, short: Number(p[2]) + '', value: a.days[d] }; });
    // 卸の得意先別（納品・税込）
    var ws = {};
    Store.getSlips().forEach(function (s) {
      if (s.status !== 'delivered' || s.date < from || s.date > to) return;
      ws[s.customerName] = (ws[s.customerName] || 0) + s.totals.total;
    });
    var wsRows = Object.keys(ws).map(function (k) { return [k, ws[k]]; }).sort(function (x, y) { return y[1] - x[1]; });

    var h2 = '<div class="toolbar">' + [['today', '今日'], ['week', '今週'], ['month', '今月'], ['last', '先月'], ['year', '今年']].map(function (p) {
      return '<button class="btn small' + (preset === p[0] ? ' on' : '') + '" data-pre="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '<input type="date" id="anFrom" value="' + from + '"> 〜 <input type="date" id="anTo" value="' + to + '"></div>' +
      '<div class="cards">' +
      POS.card('店頭の売上', yen(a.total) + delta(a.total, b.total)) +
      POS.card('客数', num(a.count) + '件' + delta(a.count, b.count, function (n) { return num(n) + '件'; })) +
      POS.card('客単価', yen(a.avg) + delta(a.avg, b.avg)) +
      POS.card('値引き', yen(a.discount)) +
      POS.card('返品', yen(a.returns)) +
      (wsRows.length ? POS.card('卸の納品（税込）', yen(wsRows.reduce(function (s, r) { return s + r[1]; }, 0))) : '') + '</div>' +
      '<div class="chart-grid">' +
      columns('hour', '時間帯別の売上', hours, yen) +
      columns('week', '曜日別の売上（1日平均）', week, yen) +
      '</div>' +
      (days.length > 1 ? columns('day', '日別の売上', days, yen) : '') +
      '<h2>商品ランキング（ABC分析）</h2>' +
      (a.ranking.length ? '<div class="table-wrap"><table><thead><tr><th>順位</th><th>商品</th><th class="r">数量</th><th class="r">売上</th><th class="r">構成比</th><th class="r">累計</th><th>ランク</th></tr></thead><tbody>' +
        a.ranking.map(function (i, n) {
          return '<tr><td>' + (n + 1) + '</td><td>' + esc(i.name) + '</td><td class="r num">' + (i.unit === 'g' ? num(Math.round(i.qty / 100) / 10) + 'kg' : num(i.qty) + (i.unit === 'open' ? '回' : '個')) + '</td>' +
            '<td class="r num">' + yen(i.amount) + '</td><td class="r num">' + Math.round(i.share * 1000) / 10 + '%</td><td class="r num">' + Math.round(i.cum * 1000) / 10 + '%</td>' +
            '<td><span class="pill ' + (i.rank === 'A' ? 'ok' : i.rank === 'B' ? 'warn' : 'gray') + '">' + i.rank + '</span></td></tr>';
        }).join('') + '</tbody></table></div><p class="note">A：売上の累計70%までの主力商品、B：90%まで、C：それ以外。仕込み・発注の量や品ぞろえの見直しに使えます。</p>'
        : '<p class="note">この期間の売上はありません。</p>') +
      '<div class="chart-grid">' +
      hbars('カテゴリ別', Object.keys(a.byCategory).map(function (k) { return [k, a.byCategory[k]]; }).sort(function (x, y) { return y[1] - x[1]; })) +
      hbars('支払方法別', Object.keys(a.byPayment).map(function (k) { return [k, a.byPayment[k]]; }).sort(function (x, y) { return y[1] - x[1]; })) +
      hbars('担当者別', Object.keys(a.byStaff).map(function (k) { return [k + '（' + a.byStaff[k].count + '件）', a.byStaff[k].total]; }).sort(function (x, y) { return y[1] - x[1]; })) +
      (wsRows.length ? hbars('卸の得意先別（納品・税込）', wsRows) : '') +
      '</div>';
    box.innerHTML = h2;
    box.onclick = function (e) {
      var p = e.target.closest('[data-pre]');
      if (p) { preset = p.dataset.pre; POS.renderSalesTab(); return; }
      var c = e.target.closest('.col');
      if (c) showRead(c);
    };
    box.onpointerover = function (e) { var c = e.target.closest('.col'); if (c && e.pointerType === 'mouse') showRead(c); };
    box.onchange = function (e) {
      if (e.target.id === 'anFrom' || e.target.id === 'anTo') {
        preset = 'custom';
        range = [$('anFrom').value || from, $('anTo').value || to];
        if (range[0] > range[1]) range = [range[1], range[0]];
        POS.renderSalesTab();
      }
    };
    function showRead(c) {
      var chart = c.parentNode;
      chart.querySelectorAll('.col').forEach(function (x) { x.classList.toggle('sel', x === c); });
      $(chart.dataset.chart + 'Read').textContent = c.dataset.read;
    }
  };
});
