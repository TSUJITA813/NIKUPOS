/*
 * 会計ソフト連携の画面
 *  - 売上画面の「会計ソフトへ書き出す」：期間・形式を選んで仕訳ファイルを書き出す
 *  - 設定画面の「会計ソフト連携」：経理方式・課税方式・勘定科目などの設定（全端末で共有）
 */
(window.NIKUPOS_MODULES = window.NIKUPOS_MODULES || []).push(function (POS) {
  'use strict';
  var $ = POS.$, esc = POS.esc, yen = POS.yen, num = POS.num;

  var FORMATS = {
    yayoi: { label: '弥生会計', note: '弥生会計（デスクトップ）・弥生会計 オンライン・弥生会計 Next・やよいの青色申告 の「弥生インポート形式」' },
    mf: { label: 'マネーフォワード', note: 'マネーフォワード クラウド会計・確定申告 の「仕訳帳」インポート' },
    generic: { label: '汎用CSV', note: 'freee など他のソフトへの入力や、税理士さんへの受け渡し用（見出し付きの一覧）' }
  };
  var HIST_KEY = 'nikupos.acctExports';

  function cfg() { return Journal.config(POS.settings().acct); }
  function readHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function writeHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-50))); } catch (e) { /* noop */ } }
  function lastMonth() {
    var d = new Date();
    var first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    var last = new Date(d.getFullYear(), d.getMonth(), 0);
    return [POS.localDate(first), POS.localDate(last)];
  }
  function data() {
    return {
      sales: Store.getSales(), reservations: Store.getReservations(), slips: Store.getSlips(), receipts: Store.getReceipts(),
      moves: Store.getMoves(), products: POS.products(), customers: Store.getCustomers(),
      cashmoves: Store.getCashMoves(), closings: Store.getClosings()
    };
  }

  // ================= 書き出し =================
  $('btnAccounting').addEventListener('click', openExport);

  function openExport() {
    var range = lastMonth();
    var st = { fmt: localStorage.getItem('nikupos.acctFormat') || 'yayoi', enc: 'sjis', from: range[0], to: range[1],
      include: { store: true, deposit: true, wholesale: true, receipts: true, cash: true, purchases: false } };
    POS.openModal(
      '<h3>会計ソフトへ書き出す</h3><div class="sub">期間の仕訳を、会計ソフトに取り込めるファイルにします。</div>' +
      '<div class="seg" id="axFmt" style="margin:8px 0">' + Object.keys(FORMATS).map(function (k) {
        return '<button type="button" class="btn small" data-fmt="' + k + '">' + FORMATS[k].label + '</button>';
      }).join('') + '</div><p class="note" id="axFmtNote"></p>' +
      '<div class="toolbar"><input type="date" name="from" value="' + st.from + '"> 〜 <input type="date" name="to" value="' + st.to + '"></div>' +
      '<div class="form" style="gap:6px">' +
      [['store', '店頭の売上（1日ごとにまとめる）'], ['deposit', '予約の前受金（受取・返金）'], ['wholesale', '卸の売上（納品ごと）'],
        ['receipts', '卸の入金・振込手数料'], ['cash', 'レジの入出金・現金過不足'], ['purchases', '仕入（在庫の入荷で仕入単価を入れたもの）']].map(function (x) {
        return '<label class="check"><input type="checkbox" data-inc="' + x[0] + '"' + (st.include[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>';
      }).join('') + '</div>' +
      '<div id="axEnc" style="margin-top:8px"><span class="note">文字コード：</span><div class="seg compact" style="display:inline-flex">' +
      '<button type="button" class="btn small" data-enc="sjis">Shift-JIS</button><button type="button" class="btn small" data-enc="utf8">UTF-8</button></div>' +
      '<span class="note">（取り込みで文字化けしたら切り替え）</span></div>' +
      '<div class="tot-box" id="axPrev"></div>' +
      '<div class="modal-foot"><button class="btn" data-act="cancel">閉じる</button><button class="btn primary" id="axOk" data-act="export">書き出す</button></div>',
      function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.fmt) { st.fmt = b.dataset.fmt; draw(); }
        else if (b.dataset.enc) { st.enc = b.dataset.enc; draw(); }
        else if (b.dataset.act === 'cancel') POS.closeModal();
        else if (b.dataset.act === 'export') doExport(st);
      }
    );
    POS.modalBody.onchange = function (e) {
      if (e.target.name === 'from') st.from = e.target.value || st.from;
      if (e.target.name === 'to') st.to = e.target.value || st.to;
      if (e.target.dataset.inc) st.include[e.target.dataset.inc] = e.target.checked;
      draw();
    };
    function draw() {
      POS.modalBody.querySelectorAll('[data-fmt]').forEach(function (x) { x.classList.toggle('on', x.dataset.fmt === st.fmt); });
      POS.modalBody.querySelectorAll('[data-enc]').forEach(function (x) { x.classList.toggle('on', x.dataset.enc === st.enc); });
      $('axFmtNote').textContent = FORMATS[st.fmt].note;
      $('axEnc').style.display = st.fmt === 'yayoi' ? 'none' : ''; // 弥生は Shift-JIS のみ
      var h = '';
      try {
        var es = Journal.buildJournals(data(), { from: st.from, to: st.to, include: st.include, config: POS.settings().acct });
        var sm = Journal.summary(es);
        var kinds = {};
        es.forEach(function (x) { var k = x.memo.split(' ')[0]; kinds[k] = (kinds[k] || 0) + 1; });
        h += '<div class="sum-row"><span>仕訳</span><span class="num">' + num(sm.entries) + '件（' + num(sm.lines) + '行）</span></div>' +
          Object.keys(kinds).map(function (k) { return '<div class="sum-row"><span>　' + esc(k) + '</span><span class="num">' + kinds[k] + '件</span></div>'; }).join('') +
          '<div class="sum-row total"><span>借方・貸方の合計</span><span class="num">' + yen(sm.total) + '</span></div>';
        var c = cfg();
        h += '<p class="note">経理方式：' + (c.taxMethod === 'excl' ? '税抜' : '税込') + '・' +
          ({ standard: '本則課税', simple: '簡易課税', exempt: '免税事業者' })[c.taxSystem] + '（設定で変更できます）</p>';
        var dup = readHist().filter(function (x) { return x.fmt === st.fmt && x.from <= st.to && x.to >= st.from; });
        if (dup.length) {
          h += '<p class="note" style="color:var(--danger)">この期間と重なる書き出しが ' + dup.length + '回あります（最後：' +
            esc(dup[dup.length - 1].from + '〜' + dup[dup.length - 1].to) + '）。会計ソフトに二重に取り込まないよう注意してください。</p>';
        }
        $('axOk').disabled = !es.length;
      } catch (err) {
        h += '<p class="note" style="color:var(--danger)">' + esc(err.message) + '</p>';
        $('axOk').disabled = true;
      }
      $('axPrev').innerHTML = h;
    }
    draw();
  }

  function doExport(st) {
    var es;
    try {
      es = Journal.buildJournals(data(), { from: st.from, to: st.to, include: st.include, config: POS.settings().acct });
    } catch (err) { alert(err.message); return; }
    if (!es.length) return;
    var base = 'nikupos-' + st.fmt + '-' + st.from.replace(/-/g, '') + '-' + st.to.replace(/-/g, '');
    var acct = POS.settings().acct;
    var files = [];
    if (st.fmt === 'yayoi') {
      // 弥生：見出しなし・Shift-JIS・1000行ごとに分割
      Journal.toYayoi(es, acct).forEach(function (rows, i, all) {
        files.push({ name: base + (all.length > 1 ? '-' + (i + 1) : '') + '.csv', bytes: Journal.encodeSJIS(Journal.toCsv(rows)) });
      });
    } else {
      var rows = st.fmt === 'mf' ? Journal.toMoneyForward(es, acct) : Journal.toGeneric(es, acct);
      var text = Journal.toCsv(rows);
      files.push({ name: base + '.csv', bytes: st.enc === 'sjis' ? Journal.encodeSJIS(text) : new TextEncoder().encode('﻿' + text) });
    }
    files.forEach(function (f) { POS.saveFile(f.name, f.bytes, 'text/csv'); });
    localStorage.setItem('nikupos.acctFormat', st.fmt);
    var h = readHist();
    h.push({ fmt: st.fmt, from: st.from, to: st.to, at: new Date().toISOString(), entries: es.length });
    writeHist(h);
    POS.closeModal();
    POS.toast(FORMATS[st.fmt].label + '用に ' + es.length + '件の仕訳を書き出しました' + (files.length > 1 ? '（' + files.length + 'ファイル）' : ''));
  }

  // ================= 設定 =================
  var ACCT_LABELS = [
    ['cash', '現金'], ['bank', '振込入金の口座'], ['ar', '売掛金（卸）'], ['cashless', 'キャッシュレス売上の受取'], ['cashlessSub', '　その補助科目'],
    ['sales', '店頭の売上'], ['wsSales', '卸の売上'], ['deposit', '予約の前受金'], ['fee', '振込手数料'], ['purchase', '仕入'], ['ap', '仕入の未払い（買掛金）'],
    ['miscLoss', 'レジの現金不足'], ['miscGain', 'レジの現金過剰']
  ];
  var KANJI = ['一', '二', '三', '四', '五', '六'];

  function renderAcctSettings() {
    var c = cfg();
    var h = '<form class="form" id="acctForm" onsubmit="return false">' +
      '<p class="note">「売上」画面の「会計ソフトへ書き出す」で、弥生会計・マネーフォワード用の仕訳ファイルを作れます。' +
      '経理方式・課税方式が分からないときは、税理士さんに確認してください。</p>' +
      '<label>消費税の経理方式<select name="taxMethod"><option value="incl">税込経理</option><option value="excl">税抜経理</option></select></label>' +
      '<label>消費税の計算<select name="taxSystem"><option value="standard">本則課税</option><option value="simple">簡易課税</option><option value="exempt">免税事業者（消費税の申告なし）</option></select></label>' +
      '<div id="acctSimple" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<label>簡易課税の事業区分：店頭<select name="simpleRetail">' + KANJI.map(function (k) { return '<option value="' + k + '">第' + k + '種</option>'; }).join('') + '</select></label>' +
      '<label>簡易課税の事業区分：卸<select name="simpleWholesale">' + KANJI.map(function (k) { return '<option value="' + k + '">第' + k + '種</option>'; }).join('') + '</select></label></div>' +
      '<details><summary class="note" style="cursor:pointer">勘定科目の名前（会計ソフトの科目名に合わせる）</summary><div class="form" style="margin-top:8px">' +
      ACCT_LABELS.map(function (a) {
        return '<label>' + a[1] + '<input name="acct_' + a[0] + '" value="' + esc(c.accounts[a[0]]) + '" autocomplete="off"></label>';
      }).join('') + '</div></details>' +
      '<details><summary class="note" style="cursor:pointer">マネーフォワードの税区分名</summary><div class="form" style="margin-top:8px">' +
      '<p class="note">マネーフォワードの「各種設定」→「税区分」画面の名前に合わせます。合っていなくても、取り込み時に変換する画面が出ます。</p>' +
      [['sales10', '売上 10%'], ['sales8', '売上 8%（軽減）'], ['purchase10', '仕入 10%'], ['purchase8', '仕入 8%（軽減）'], ['none', '対象外']].map(function (a) {
        return '<label>' + a[1] + '<input name="mf_' + a[0] + '" value="' + esc(c.mfTax[a[0]]) + '" autocomplete="off"></label>';
      }).join('') + '</div></details>' +
      '<button type="button" class="btn primary" id="acctSave">会計ソフト連携の設定を保存</button></form>';
    $('acctSettings').innerHTML = h;
    var f = $('acctForm').elements;
    f.taxMethod.value = c.taxMethod;
    f.taxSystem.value = c.taxSystem;
    f.simpleRetail.value = c.simpleRetail;
    f.simpleWholesale.value = c.simpleWholesale;
    function showSimple() { $('acctSimple').style.display = f.taxSystem.value === 'simple' ? 'grid' : 'none'; }
    f.taxSystem.addEventListener('change', showSimple);
    showSimple();
    $('acctSave').addEventListener('click', function () {
      var s = POS.settings();
      var acct = { taxMethod: f.taxMethod.value, taxSystem: f.taxSystem.value, simpleRetail: f.simpleRetail.value, simpleWholesale: f.simpleWholesale.value, accounts: {}, mfTax: {} };
      ACCT_LABELS.forEach(function (a) { acct.accounts[a[0]] = f['acct_' + a[0]].value.trim(); });
      ['sales10', 'sales8', 'purchase10', 'purchase8', 'none'].forEach(function (k) { acct.mfTax[k] = f['mf_' + k].value.trim(); });
      s.acct = acct;
      Store.saveSettings(s);
      POS.toast('会計ソフト連携の設定を保存しました');
    });
  }
  POS.views.settings = renderAcctSettings;
});
