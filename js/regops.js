/*
 * 入出金とレジ締め（点検・精算）
 *  レジの現金は端末ごとに数える（店頭のレジと卸の端末では手元の現金が別）。
 *  入出金：釣銭準備金・入金（補充・預金からの引き出しなど）・出金（小口の支払いなど）・両替（記録のみ）
 *  レジ締め：金種ごとの枚数 → 実際の現金と理論在高の過不足。キャッシュレスは決済端末の集計と照合。
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;

  var KIND = { float: '釣銭準備金', 'in': '入金', out: '出金', exchange: '両替' };
  var OUT_ACCOUNTS = ['消耗品費', '仕入高', '雑費', '通信費', '旅費交通費', '荷造運賃', '事業主貸', '普通預金'];
  var IN_ACCOUNTS = ['普通預金', '事業主借', '雑収入'];
  var cashDate = POS.localDate(new Date());
  var closeDate = POS.localDate(new Date());

  function today() { return POS.localDate(new Date()); }
  function dev() { return POS.myDev(); }
  function devLabel(d) { return d ? '端末 ' + d : 'この端末'; }
  function myMoves(date) {
    return Store.getCashMoves().filter(function (m) { return m.date === date && (m.dev || '') === dev(); })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }
  function data() {
    return { sales: Store.getSales(), reservations: Store.getReservations(), slips: Store.getSlips(), receipts: Store.getReceipts(), cashmoves: Store.getCashMoves() };
  }
  /** 準備金の初期値：その日の記録 → 前回の精算で残した額 → 設定 */
  function defaultFloat(date) {
    var f = myMoves(date).filter(function (m) { return m.kind === 'float'; }).pop();
    if (f) return { amount: f.amount, from: 'その日の記録' };
    var last = Store.getClosings().filter(function (c) { return (c.dev || '') === dev() && c.date < date && c.keep != null; })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; }).pop();
    if (last) return { amount: last.keep, from: '前回の精算で残した額' };
    return { amount: Number(POS.settings().floatDefault) || 0, from: '設定' };
  }

  // ================= 入出金 =================
  POS.salesTabs.cash = function (box) {
    var list = myMoves(cashDate);
    var sumIn = 0;
    var sumOut = 0;
    list.forEach(function (m) { if (m.kind === 'in') sumIn += m.amount; if (m.kind === 'out') sumOut += m.amount; });
    var fl = defaultFloat(cashDate);
    box.innerHTML = '<div class="toolbar"><input type="date" id="cmDate" value="' + cashDate + '"><span class="note">' + devLabel(dev()) + 'のレジ</span>' +
      '<span class="spacer"></span></div>' +
      '<div class="btn-row">' +
      '<button class="btn" data-cm="float">釣銭準備金</button>' +
      '<button class="btn primary" data-cm="out">出金（小口の支払いなど）</button>' +
      '<button class="btn" data-cm="in">入金（補充など）</button>' +
      '<button class="btn" data-cm="exchange">両替</button></div>' +
      '<div class="cards">' + POS.card('釣銭準備金', yen(fl.amount) + '<div class="note">' + fl.from + '</div>') +
      POS.card('入金', yen(sumIn)) + POS.card('出金', yen(sumOut)) + '</div>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>時刻</th><th>区分</th><th class="r">金額</th><th>科目・内容</th><th>担当</th><th></th></tr></thead><tbody>' +
        list.map(function (m) {
          return '<tr><td>' + POS.timeStr(new Date(m.at)) + '</td><td>' + KIND[m.kind] + '</td><td class="r num">' + yen(m.amount) + '</td>' +
            '<td>' + esc([m.account, m.taxRate ? m.taxRate + '%' : '', m.memo].filter(Boolean).join('・')) + '</td><td>' + esc(m.staff || '') + '</td>' +
            '<td><button class="btn small danger-outline" data-del="' + m.id + '">削除</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="note">この日の入出金はありません。</p>') +
      '<p class="note">出金・入金は、レジ締めの「あるべき現金」と会計ソフトへの書き出しに反映されます。両替は記録だけです。</p>';
    $('cmDate').onchange = function () { cashDate = this.value || today(); POS.renderSalesTab(); };
    box.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cm) openMove(b.dataset.cm);
      if (b.dataset.del) {
        var m = Store.getCashMoves().find(function (x) { return x.id === b.dataset.del; });
        POS.requirePerm('cashmove', '入出金の削除').then(function (ok) {
          if (!ok || !confirm(KIND[m.kind] + ' ' + yen(m.amount) + ' を削除しますか？')) return;
          Store.saveCashMoves(Store.getCashMoves().filter(function (x) { return x.id !== m.id; }));
          POS.log('cashmove-delete', KIND[m.kind] + ' ' + yen(m.amount) + ' を削除');
          POS.renderSalesTab();
        });
      }
    };
  };

  function openMove(kind) {
    POS.requirePerm('cashmove', KIND[kind]).then(function (ok) {
      if (!ok) return;
      var val = kind === 'float' ? String(defaultFloat(cashDate).amount || '') : '';
      var fresh = true;
      var account = kind === 'out' ? OUT_ACCOUNTS[0] : IN_ACCOUNTS[0];
      var taxRate = kind === 'out' ? 10 : 0;
      var accounts = kind === 'out' ? OUT_ACCOUNTS : kind === 'in' ? IN_ACCOUNTS : [];
      POS.openModal(
        '<h3>' + KIND[kind] + '</h3>' +
        '<div class="sub">' + (kind === 'float' ? '開店時にレジに入れた釣銭の額' : kind === 'exchange' ? '両替した額（レジの現金の合計は変わりません）' :
          kind === 'out' ? 'レジから出したお金（備品の購入、仕入の現金払いなど）' : 'レジに入れたお金（釣銭の補充など）') + '</div>' +
        '<div class="display"><span class="label">金額</span><span class="value" id="cmVal"></span></div>' +
        (accounts.length ? '<div class="seg" style="margin:6px 0">' + accounts.map(function (a) {
          return '<button type="button" class="btn small" data-acc="' + esc(a) + '">' + esc(a) + '</button>';
        }).join('') + '</div>' : '') +
        (kind === 'out' ? '<div class="seg" style="margin:6px 0"><span class="note" style="align-self:center">消費税</span>' +
          '<button type="button" class="btn small" data-tax="10">10%</button><button type="button" class="btn small" data-tax="8">8%（軽減）</button>' +
          '<button type="button" class="btn small" data-tax="0">対象外</button></div>' : '') +
        '<input id="cmMemo" placeholder="内容（例：ラップ・トレー購入）" style="width:100%;min-height:44px;padding:0 10px;border:1px solid var(--line);border-radius:8px;margin:6px 0" autocomplete="off">' +
        POS.keypadHtml() +
        '<div class="modal-foot"><button class="btn" data-act="cancel">キャンセル</button><button class="btn primary" id="mOk" data-act="ok">記録</button></div>',
        function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.key) { if (fresh && b.dataset.key !== 'BS') val = ''; fresh = false; val = POS.applyKey(val, b.dataset.key, 7); draw(); }
          else if (b.dataset.acc) { account = b.dataset.acc; draw(); }
          else if (b.dataset.tax != null) { taxRate = Number(b.dataset.tax); draw(); }
          else if (b.dataset.act === 'cancel') POS.closeModal();
          else if (b.dataset.act === 'ok') {
            var amount = Number(val || 0);
            if (!(amount > 0) && kind !== 'float') return;
            var now = new Date();
            var m = {
              id: Store.newId('K'), at: now.toISOString(), date: cashDate, dev: dev(), staff: POS.staffName(), kind: kind, amount: amount,
              account: accounts.length ? account : '', taxRate: kind === 'out' ? taxRate : 0, memo: $('cmMemo').value.trim()
            };
            Store.addCashMove(m);
            if (kind !== 'float') POS.openDrawer();
            POS.log('cashmove', KIND[kind] + ' ' + yen(amount) + (m.account ? '（' + m.account + '）' : '') + (m.memo ? ' ' + m.memo : ''));
            POS.closeModal();
            POS.renderSalesTab();
            POS.toast(KIND[kind] + ' ' + yen(amount) + ' を記録しました');
          }
        }
      );
      function draw() {
        $('cmVal').textContent = yen(Number(val || 0));
        POS.modalBody.querySelectorAll('[data-acc]').forEach(function (x) { x.classList.toggle('on', x.dataset.acc === account); });
        POS.modalBody.querySelectorAll('[data-tax]').forEach(function (x) { x.classList.toggle('on', Number(x.dataset.tax) === taxRate); });
      }
      draw();
    });
  }

  // ================= レジ締め =================
  var counts = {};       // 金種 → 枚数（入力中）
  var terminal = {};     // キャッシュレス種類 → 端末の集計額（入力中）

  POS.salesTabs.close = function (box) {
    var dr = Calc.drawerSummary(data(), closeDate, dev());
    var s = dr.sum;
    var fl = defaultFloat(closeDate);
    var float = dr.float || fl.amount;
    var expected = float + s.drawerCash;
    var counted = Calc.countCash(counts);
    var diff = counted - expected;
    var done = Store.getClosings().filter(function (c) { return c.date === closeDate && (c.dev || '') === dev(); });
    var last = done[done.length - 1];
    var w = s.wholesale;
    var h = '<div class="toolbar"><input type="date" id="clDate" value="' + closeDate + '"><span class="note">' + devLabel(dev()) + 'のレジ</span></div>' +
      (last ? '<div class="list-item" style="border-left:6px solid var(--ok)"><b>精算済み</b>（' + POS.timeStr(new Date(last.at)) + '・' + esc(last.staff || '') +
        '）実際の現金 ' + yen(last.counted) + '・過不足 ' + signed(last.diff) + '</div>' : '') +
      '<div class="cards">' +
      POS.card('売上（この端末）', yen(s.total) + '<div class="note">' + s.count + '件' + (s.returns.count ? '・返品 ' + s.returns.count + '件' : '') + '</div>') +
      POS.card('現金', yen(s.cash)) +
      POS.card('キャッシュレス', yen(s.cashless)) + '</div>' +
      '<h2>現金</h2><div class="table-wrap"><table><tbody>' +
      tr('釣銭準備金', yen(float) + (dr.float ? '' : '<div class="note">' + fl.from + '</div>')) +
      tr('現金売上（返品・返金を含む）', yen(s.cash)) +
      (s.depositIn.cash ? tr('予約の前受金（現金）', yen(s.depositIn.cash)) : '') +
      (s.depositRefund.cash ? tr('前受金の返金', '-' + yen(s.depositRefund.cash)) : '') +
      (w.cashOnDelivery + w.receiptCash ? tr('卸の現金回収', yen(w.cashOnDelivery + w.receiptCash)) : '') +
      (s.cashIn ? tr('入金', yen(s.cashIn)) : '') + (s.cashOut ? tr('出金', '-' + yen(s.cashOut)) : '') +
      '<tr><th>あるべき現金（理論在高）</th><td class="r num"><b>' + yen(expected) + '</b></td></tr></tbody></table></div>' +
      '<h2>実際の現金を数える</h2><div class="denoms">' + Calc.DENOMS.map(function (d) {
        return '<label><span>' + num(d) + '円</span><input type="number" inputmode="numeric" min="0" data-den="' + d + '" value="' + (counts[d] || '') + '" placeholder="0">' +
          '<span class="num note" id="denSum' + d + '">' + (counts[d] ? yen(d * counts[d]) : '') + '</span></label>';
      }).join('') + '</div>' +
      '<div class="tot-box"><div class="sum-row"><span>実際の現金</span><span class="num" id="clCounted">' + yen(counted) + '</span></div>' +
      '<div class="sum-row total"><span>過不足</span><span class="num" id="clDiff">' + signed(diff) + '</span></div></div>' +
      '<h2>キャッシュレス（決済端末の集計と照合）</h2>' +
      (Object.keys(s.cashlessBy).length ? '<div class="table-wrap"><table><thead><tr><th>種類</th><th class="r">レジの記録</th><th class="r">端末の集計</th><th class="r">差</th></tr></thead><tbody>' +
        Object.keys(s.cashlessBy).map(function (k) {
          var t = terminal[k];
          return '<tr><td>' + esc(k) + '</td><td class="r num">' + yen(s.cashlessBy[k]) + '</td>' +
            '<td class="r"><input type="number" inputmode="numeric" data-term="' + esc(k) + '" value="' + (t != null ? t : '') + '" style="width:110px;text-align:right;min-height:38px;border:1px solid var(--line);border-radius:6px"></td>' +
            '<td class="r num" data-tdiff="' + esc(k) + '">' + (t != null && t !== '' ? signed(Number(t) - s.cashlessBy[k]) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="note">キャッシュレスの売上はありません。</p>') +
      '<label class="form" style="margin-top:10px">明日の釣銭準備金として残す額<input type="number" inputmode="numeric" id="clKeep" value="' + float + '" style="max-width:200px"></label>' +
      '<div class="btn-row" style="margin-top:10px"><button class="btn" data-cl="check">点検レポート（途中確認・記録しない）</button>' +
      '<button class="btn primary" data-cl="close">精算する（記録して印刷）</button></div>' +
      history();
    box.innerHTML = h;
    $('clDate').onchange = function () { closeDate = this.value || today(); counts = {}; terminal = {}; POS.renderSalesTab(); };
    box.oninput = function (e) {
      var d = e.target.dataset.den;
      if (d) {
        counts[d] = Math.max(0, Math.floor(Number(e.target.value) || 0));
        $('denSum' + d).textContent = counts[d] ? yen(d * counts[d]) : '';
        var c = Calc.countCash(counts);
        $('clCounted').textContent = yen(c);
        $('clDiff').textContent = signed(c - expected);
        $('clDiff').className = 'num ' + (c - expected ? 'neg' : '');
      }
      var k = e.target.dataset.term;
      if (k) {
        terminal[k] = e.target.value;
        var cell = box.querySelector('[data-tdiff="' + CSS.escape(k) + '"]');
        if (cell) cell.textContent = e.target.value === '' ? '—' : signed(Number(e.target.value) - s.cashlessBy[k]);
      }
    };
    box.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cl === 'check') printReport(build(), false);
      if (b.dataset.cl === 'close') doClose();
      if (b.dataset.reprint) {
        var c = Store.getClosings().find(function (x) { return x.id === b.dataset.reprint; });
        if (c) printReport(c, true);
      }
    };
    function build() {
      var c = Calc.countCash(counts);
      return {
        date: closeDate, dev: dev(), at: new Date().toISOString(), staff: POS.staffName(), float: float, expected: expected,
        counted: c, diff: c - expected, denoms: JSON.parse(JSON.stringify(counts)),
        sales: { total: s.total, count: s.count, cash: s.cash, cashless: s.cashless, returns: s.returns, discount: s.discount, voids: s.voids },
        cashlessBy: s.cashlessBy, terminal: JSON.parse(JSON.stringify(terminal)),
        depositIn: s.depositIn.cash, depositRefund: s.depositRefund.cash, wholesaleCash: w.cashOnDelivery + w.receiptCash,
        cashIn: s.cashIn, cashOut: s.cashOut, keep: Math.floor(Number($('clKeep').value) || 0)
      };
    }
    function doClose() {
      var c = build();
      if (!c.counted && !confirm('実際の現金が0円です（枚数が入っていません）。このまま精算しますか？')) return;
      if (done.length && !confirm('この日はすでに精算済みです。もう一度精算しますか？')) return;
      POS.requirePerm('closing', 'レジの精算').then(function (ok) {
        if (!ok) return;
        if (c.diff && !confirm('過不足が ' + signed(c.diff) + ' あります。このまま精算しますか？')) return;
        c.id = Store.newId('Z');
        Store.addClosing(c);
        POS.log('closing', closeDate + ' 精算・実際の現金 ' + yen(c.counted) + '・過不足 ' + signed(c.diff));
        counts = {};
        terminal = {};
        printReport(c, false);
        POS.renderSalesTab();
        POS.toast('精算しました');
      });
    }
  };

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '-' : '±') + yen(Math.abs(n)).replace('-', ''); }
  function tr(k, v) { return '<tr><td>' + k + '</td><td class="r num">' + v + '</td></tr>'; }
  function history() {
    var list = Store.getClosings().filter(function (c) { return (c.dev || '') === dev(); })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 14);
    if (!list.length) return '';
    return '<h2>精算の履歴</h2><div class="table-wrap"><table><thead><tr><th>日付</th><th>時刻</th><th class="r">売上</th><th class="r">実際の現金</th><th class="r">過不足</th><th>担当</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr><td>' + c.date + '</td><td>' + POS.timeStr(new Date(c.at)) + '</td><td class="r num">' + yen(c.sales.total) + '</td>' +
          '<td class="r num">' + yen(c.counted) + '</td><td class="r num' + (c.diff ? ' neg' : '') + '">' + signed(c.diff) + '</td><td>' + esc(c.staff || '') + '</td>' +
          '<td><button class="btn small" data-reprint="' + c.id + '">再印刷</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** 点検（X）・精算（Z）レポート */
  function printReport(c, reprint) {
    var row = POS.row;
    var st = POS.settings();
    var h = '<div class="c title">' + (c.id ? '精算レポート' : '点検レポート') + '</div><div class="c">' + esc(st.storeName) + '</div>' +
      (reprint ? '<div class="c">＊＊ 再印刷 ＊＊</div>' : '') +
      '<div class="c">' + c.date + '　' + devLabel(c.dev) + '</div><div class="c">' + POS.dateTimeStr(new Date(c.at)) + (c.staff ? '　担当 ' + esc(c.staff) : '') + '</div><hr>' +
      row('売上合計', yen(c.sales.total)) + row('客数', c.sales.count + '件') +
      row('返品', yen(c.sales.returns.amount) + '（' + c.sales.returns.count + '件）') + row('取消', c.sales.voids + '件') + row('値引き', yen(c.sales.discount)) +
      '<hr>' + row('現金売上', yen(c.sales.cash)) + row('キャッシュレス', yen(c.sales.cashless)) +
      Object.keys(c.cashlessBy).map(function (k) {
        var t = c.terminal && c.terminal[k];
        return row('　' + esc(k), yen(c.cashlessBy[k])) + (t != null && t !== '' ? row('　　端末の集計', yen(Number(t)) + '（差 ' + signed(Number(t) - c.cashlessBy[k]) + '）') : '');
      }).join('') +
      '<hr>' + row('釣銭準備金', yen(c.float)) + row('現金売上', yen(c.sales.cash)) +
      (c.depositIn ? row('前受金（現金）', yen(c.depositIn)) : '') + (c.depositRefund ? row('前受金の返金', '-' + yen(c.depositRefund)) : '') +
      (c.wholesaleCash ? row('卸の現金回収', yen(c.wholesaleCash)) : '') +
      (c.cashIn ? row('入金', yen(c.cashIn)) : '') + (c.cashOut ? row('出金', '-' + yen(c.cashOut)) : '') +
      row('<b>あるべき現金</b>', '<b>' + yen(c.expected) + '</b>') + '<hr>' +
      Calc.DENOMS.filter(function (d) { return c.denoms[d]; }).map(function (d) { return row(num(d) + '円 × ' + c.denoms[d], yen(d * c.denoms[d])); }).join('') +
      row('<b>実際の現金</b>', '<b>' + yen(c.counted) + '</b>') + row('<b>過不足</b>', '<b>' + signed(c.diff) + '</b>') +
      (c.keep != null ? row('翌日の準備金', yen(c.keep)) : '');
    POS.printHtml(h);
  }
});
