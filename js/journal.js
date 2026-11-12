/*
 * 会計ソフト連携：POSのデータから仕訳を作り、会計ソフトの取り込み形式で書き出す
 *
 * 対応形式（各社の公式ヘルプで確認した仕様）
 *  - 弥生会計（デスクトップ・オンライン・Next 共通の「弥生インポート形式」）
 *      25列・見出し行なし・Shift-JIS・カンマを含む項目は不可・1ファイル1000行まで・1仕訳20行まで
 *      識別フラグ 2000=1行の仕訳 / 2110・2100・2101=複数行の1行目・間・最終行
 *      税区分の記述形式：税込経理「課税売上込10%」「課税売上込軽減8%」、税抜経理「課税売上内10%」「課税売上内軽減8%」
 *      簡易課税は事業区分の漢数字を入れる（例「課税売上込二軽減8%」）。現金・預金・売掛金などは「対象外」
 *  - マネーフォワード クラウド会計「仕訳帳」インポート
 *      27列・1行目は見出し・取引日 yyyy/MM/dd・取引Noと取引日が同じ行は複合仕訳・税額は空欄（自動計算）
 *  - 汎用CSV（freee など他のソフトや税理士への受け渡し用）
 *
 * 金額はすべて税込。消費税額は POS で計算済みの値を使う。
 */
(function (root) {
  'use strict';

  var Calc = root.Calc || (typeof require === 'function' ? require('./calc.js') : null);

  var DEFAULT_CONFIG = {
    taxMethod: 'incl',     // 'incl' 税込経理 / 'excl' 税抜経理
    taxSystem: 'standard', // 'standard' 本則課税 / 'simple' 簡易課税 / 'exempt' 免税事業者
    simpleRetail: '二',    // 簡易課税の事業区分：店頭（小売）
    simpleWholesale: '一', // 簡易課税の事業区分：卸
    accounts: {
      cash: '現金',
      bank: '普通預金',
      ar: '売掛金',
      cashless: '売掛金',
      cashlessSub: 'キャッシュレス',
      sales: '売上高',
      wsSales: '売上高',
      deposit: '前受金',
      fee: '支払手数料',
      purchase: '仕入高',
      ap: '買掛金',
      miscLoss: '雑損失',
      miscGain: '雑収入'
    },
    // マネーフォワードの税区分名（「税区分」画面の名称に合わせて変更可能。合わない場合は取り込み時に変換画面が出る）
    mfTax: {
      sales10: '課税売上 10%',
      sales8: '課税売上 8%（軽）',
      purchase10: '課税仕入 10%',
      purchase8: '課税仕入 8%（軽）',
      none: '対象外'
    }
  };

  function merge(base, over) {
    var out = JSON.parse(JSON.stringify(base));
    if (!over) return out;
    Object.keys(over).forEach(function (k) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k] && typeof out[k] === 'object') {
        Object.keys(over[k]).forEach(function (j) { if (over[k][j] !== '' && over[k][j] != null) out[k][j] = over[k][j]; });
      } else if (over[k] !== '' && over[k] != null) out[k] = over[k];
    });
    return out;
  }
  function config(over) { return merge(DEFAULT_CONFIG, over); }

  // ================= 仕訳を作る =================
  // 仕訳 entry: { date, memo, debits: [side], credits: [side] }
  // side: { acct, sub, partner, amount, tax: null | { type: 'sales'|'purchase', rate, amount, biz: 'retail'|'wholesale' } }

  function side(acct, amount, o) {
    var s = { acct: acct, sub: '', partner: '', amount: amount, tax: null };
    if (o) Object.keys(o).forEach(function (k) { s[k] = o[k]; });
    return s;
  }

  /** 金額0の行を除き、マイナスの行は反対側へ移す（会計ソフトはマイナス不可）。貸借が合わなければエラー */
  function entry(date, memo, debits, credits) {
    var d = [];
    var c = [];
    function put(list, other, s) {
      if (!s.amount) return;
      if (s.amount < 0) {
        var t = JSON.parse(JSON.stringify(s));
        t.amount = -s.amount;
        if (t.tax) t.tax.amount = -t.tax.amount;
        other.push(t);
      } else list.push(s);
    }
    debits.forEach(function (s) { put(d, c, s); });
    credits.forEach(function (s) { put(c, d, s); });
    var sd = d.reduce(function (x, s) { return x + s.amount; }, 0);
    var sc = c.reduce(function (x, s) { return x + s.amount; }, 0);
    if (sd !== sc) throw new Error('貸借が一致しません（' + date + ' ' + memo + '：借方 ' + sd + ' / 貸方 ' + sc + '）');
    if (!d.length) return null;
    return { date: date, memo: memo, debits: d, credits: c };
  }

  function datesBetween(from, to) {
    var out = [];
    var p = from.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    for (var i = 0; i < 400; i++) {
      var s = d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
      if (s > to) break;
      out.push(s);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /**
   * 期間の仕訳を作る
   * @param data { sales, reservations, slips, receipts, moves, products, customers }
   * @param opts { from, to, include: { store, deposit, wholesale, receipts, purchases }, config }
   */
  function buildJournals(data, opts) {
    var cfg = config(opts.config);
    var A = cfg.accounts;
    var inc = opts.include || { store: true, deposit: true, wholesale: true, receipts: true, purchases: false };
    var out = [];
    function add(e) { if (e) out.push(e); }
    var customers = {};
    (data.customers || []).forEach(function (c) { customers[c.id] = c; });
    function custName(id, fallback) { return (customers[id] && customers[id].name) || fallback || ''; }
    function salesSides(byRate, acct, biz, inclKey) {
      return byRate.map(function (r) {
        var amt = inclKey ? (r.incl != null ? r.incl : r.amount + r.tax) : r.amount;
        return side(acct, amt, { tax: { type: 'sales', rate: Number(r.rate), amount: r.tax, biz: biz } });
      });
    }

    datesBetween(opts.from, opts.to).forEach(function (date) {
      // ---- 店頭売上（1日分をまとめて1仕訳） ----
      if (inc.store) {
        var s = Calc.summarizeDay(data.sales || [], [], date);
        if (s.count) {
          var rates = Object.keys(s.rates).map(function (r) { return { rate: r, amount: s.rates[r].amount, tax: s.rates[r].tax }; });
          add(entry(date, '店頭売上 ' + s.count + '件', [
            side(A.cash, s.cash),
            side(A.cashless, s.cashless, { sub: A.cashlessSub }),
            side(A.deposit, s.depositUsed)
          ], salesSides(rates, A.sales, 'retail', false)));
        }
      }
      // ---- 予約の前受金（受取・返金） ----
      if (inc.deposit) {
        (data.reservations || []).forEach(function (r) {
          if (!r.deposit) return;
          var payAcct = r.depositMethod === 'cashless' ? side(A.cashless, r.deposit, { sub: A.cashlessSub }) : side(A.cash, r.deposit);
          if (r.depositDate === date) add(entry(date, '予約前受金 ' + (r.noLabel || r.no) + ' ' + r.name + '様', [payAcct], [side(A.deposit, r.deposit)]));
          if (r.depositRefundDate === date) {
            add(entry(date, '予約前受金の返金 ' + (r.noLabel || r.no) + ' ' + r.name + '様', [side(A.deposit, r.deposit)], [JSON.parse(JSON.stringify(payAcct))]));
          }
        });
      }
      // ---- 卸の売上（納品ごと） ----
      if (inc.wholesale) {
        (data.slips || []).forEach(function (sl) {
          if (sl.date !== date || sl.status !== 'delivered') return;
          var name = custName(sl.customerId, sl.customerName);
          var dr = sl.payment === 'cash' ? side(A.cash, sl.totals.total, { partner: name })
            : side(A.ar, sl.totals.total, { sub: name, partner: name });
          var cr = salesSides(sl.totals.byRate, A.wsSales, 'wholesale', true);
          cr.forEach(function (x) { x.partner = name; });
          add(entry(date, '卸売上 ' + name + ' No.' + (sl.noLabel || sl.no), [dr], cr));
        });
      }
      // ---- 卸の入金・振込手数料 ----
      if (inc.receipts) {
        (data.receipts || []).forEach(function (r) {
          if (r.date !== date) return;
          var name = custName(r.customerId);
          var cr = side(A.ar, r.amount, { sub: name, partner: name });
          if (r.method === 'fee') {
            var tax = Math.floor((r.amount * 10) / 110);
            add(entry(date, '振込手数料（当方負担） ' + name, [side(A.fee, r.amount, { tax: { type: 'purchase', rate: 10, amount: tax } })], [cr]));
          } else {
            add(entry(date, '売掛金入金 ' + name + (r.note ? ' ' + r.note : ''), [side(r.method === 'cash' ? A.cash : A.bank, r.amount, { partner: name })], [cr]));
          }
        });
      }
      // ---- 入出金・レジの過不足 ----
      if (inc.cash) {
        (data.cashmoves || []).forEach(function (m) {
          if (m.date !== date || !m.amount || !m.account) return;
          var tax = m.taxRate ? { type: 'purchase', rate: m.taxRate, amount: Math.floor((m.amount * m.taxRate) / (100 + m.taxRate)) } : null;
          if (m.kind === 'out') add(entry(date, '出金 ' + (m.memo || m.account), [side(m.account, m.amount, { tax: tax })], [side(A.cash, m.amount)]));
          if (m.kind === 'in') add(entry(date, '入金 ' + (m.memo || m.account), [side(A.cash, m.amount)], [side(m.account, m.amount)]));
        });
        // 1日・1端末につき最後の精算の過不足
        var last = {};
        (data.closings || []).forEach(function (c) {
          if (c.date !== date) return;
          var k = c.dev || '';
          if (!last[k] || last[k].at < c.at) last[k] = c;
        });
        Object.keys(last).forEach(function (k) {
          var c = last[k];
          if (c.diff < 0) add(entry(date, '現金過不足（不足）' + (k ? ' 端末' + k : ''), [side(A.miscLoss, -c.diff)], [side(A.cash, -c.diff)]));
          if (c.diff > 0) add(entry(date, '現金過不足（過剰）' + (k ? ' 端末' + k : ''), [side(A.cash, c.diff)], [side(A.miscGain, c.diff)]));
        });
      }
      // ---- 仕入（入荷で仕入単価を入れたもの・仕入先ごと） ----
      if (inc.purchases) {
        var bySup = {};
        var prods = {};
        (data.products || []).forEach(function (p) { prods[p.id] = p; });
        (data.moves || []).forEach(function (m) {
          if (m.type !== 'in' || m.date !== date || !m.cost || !(m.delta > 0)) return;
          var p = prods[m.productId] || { unit: 'g', taxRate: 8 };
          var excl = p.unit === 'g' ? Math.floor((m.cost * m.delta) / 1000) : m.cost * m.delta;
          var key = (m.supplier || '仕入先未入力') + '|' + p.taxRate;
          var x = bySup[key] || (bySup[key] = { supplier: m.supplier || '', rate: p.taxRate, excl: 0 });
          x.excl += excl;
        });
        Object.keys(bySup).forEach(function (k) {
          var x = bySup[k];
          var tax = Math.floor((x.excl * x.rate) / 100);
          var incl = x.excl + tax;
          add(entry(date, '仕入 ' + (x.supplier || ''), [side(A.purchase, incl, { tax: { type: 'purchase', rate: x.rate, amount: tax }, partner: x.supplier })],
            [side(A.ap, incl, { sub: x.supplier, partner: x.supplier })]));
        });
      }
    });
    return out;
  }

  // ================= 税区分の書き方 =================
  function yayoiTax(t, cfg) {
    if (!t || cfg.taxSystem === 'exempt') return '対象外';
    var how = cfg.taxMethod === 'excl' ? '内' : '込';
    var rate = t.rate === 8 ? '軽減8%' : t.rate + '%';
    if (t.type === 'sales') {
      var biz = cfg.taxSystem === 'simple' ? (t.biz === 'wholesale' ? cfg.simpleWholesale : cfg.simpleRetail) : '';
      return '課税売上' + how + biz + rate;
    }
    return '課対仕入' + how + rate;
  }
  function mfTax(t, cfg) {
    var m = cfg.mfTax;
    if (!t || cfg.taxSystem === 'exempt') return m.none;
    if (t.type === 'sales') return t.rate === 8 ? m.sales8 : m.sales10;
    return t.rate === 8 ? m.purchase8 : m.purchase10;
  }
  function plainTax(t, cfg) {
    if (!t || cfg.taxSystem === 'exempt') return '対象外';
    return (t.type === 'sales' ? '課税売上' : '課税仕入') + (t.rate === 8 ? '8%（軽減）' : t.rate + '%');
  }

  // ================= 書き出し形式 =================
  function slashDate(d) { return d.replace(/-/g, '/'); }
  /** 弥生：カンマ不可・桁数の上限 */
  function ytext(s, max) { return String(s || '').replace(/[,\r\n"]/g, ' ').slice(0, max); }

  /** 弥生インポート形式（25列・見出しなし）。1000行ごとにファイルを分ける */
  function toYayoi(entries, cfgOver) {
    var cfg = config(cfgOver);
    var files = [[]];
    entries.forEach(function (e) {
      var n = Math.max(e.debits.length, e.credits.length);
      if (n > 20) throw new Error('1つの仕訳が20行を超えています：' + e.date + ' ' + e.memo);
      if (files[files.length - 1].length + n > 1000) files.push([]);
      for (var i = 0; i < n; i++) {
        var d = e.debits[i];
        var c = e.credits[i];
        var flag = n === 1 ? '2000' : i === 0 ? '2110' : i === n - 1 ? '2101' : '2100';
        var withTax = function (s) { return s && s.tax && cfg.taxSystem !== 'exempt' ? String(s.tax.amount) : ''; };
        files[files.length - 1].push([
          flag, '', '', slashDate(e.date),
          d ? ytext(d.acct, 12) : '', d ? ytext(d.sub, 15) : '', '', d ? yayoiTax(d.tax, cfg) : '', d ? String(d.amount) : '0', withTax(d),
          c ? ytext(c.acct, 12) : '', c ? ytext(c.sub, 15) : '', '', c ? yayoiTax(c.tax, cfg) : '', c ? String(c.amount) : '0', withTax(c),
          ytext(e.memo, 30), '', '', '0', '', '', '0', '0', 'no'
        ]);
      }
    });
    return files.filter(function (f) { return f.length; });
  }

  var MF_HEADER = ['取引No', '取引日', '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額',
    '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額',
    '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳', '作成日時', '作成者', '最終更新日時', '最終更新者'];

  /** マネーフォワード クラウド会計「仕訳帳」インポート（27列・1行目は見出し） */
  function toMoneyForward(entries, cfgOver) {
    var cfg = config(cfgOver);
    var rows = [MF_HEADER];
    entries.forEach(function (e, idx) {
      var n = Math.max(e.debits.length, e.credits.length);
      for (var i = 0; i < n; i++) {
        var d = e.debits[i];
        var c = e.credits[i];
        rows.push([
          String(idx + 1), slashDate(e.date),
          d ? d.acct : '', d ? d.sub : '', '', d ? d.partner : '', d ? mfTax(d.tax, cfg) : '', '', d ? String(d.amount) : '', '',
          c ? c.acct : '', c ? c.sub : '', '', c ? c.partner : '', c ? mfTax(c.tax, cfg) : '', '', c ? String(c.amount) : '', '',
          e.memo, i === 0 ? 'NIKUPOSから取り込み' : '', '', '', '', '', '', '', ''
        ]);
      }
    });
    return rows;
  }

  /** 汎用CSV（freee など他のソフトや税理士への受け渡し用） */
  function toGeneric(entries, cfgOver) {
    var cfg = config(cfgOver);
    var rows = [['伝票番号', '日付', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額', '借方消費税額',
      '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額', '貸方消費税額', '取引先', '摘要']];
    entries.forEach(function (e, idx) {
      var n = Math.max(e.debits.length, e.credits.length);
      for (var i = 0; i < n; i++) {
        var d = e.debits[i];
        var c = e.credits[i];
        rows.push([String(idx + 1), slashDate(e.date),
          d ? d.acct : '', d ? d.sub : '', d ? plainTax(d.tax, cfg) : '', d ? String(d.amount) : '', d && d.tax ? String(d.tax.amount) : '',
          c ? c.acct : '', c ? c.sub : '', c ? plainTax(c.tax, cfg) : '', c ? String(c.amount) : '', c && c.tax ? String(c.tax.amount) : '',
          (d && d.partner) || (c && c.partner) || '', e.memo]);
      }
    });
    return rows;
  }

  function toCsv(rows, quoteAll) {
    return rows.map(function (r) {
      return r.map(function (v) {
        v = String(v == null ? '' : v);
        return quoteAll || /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n') + '\r\n';
  }

  // ================= Shift-JIS への変換 =================
  // ブラウザ（と Node）に備わっている Shift-JIS の「読み取り」機能から、逆引きの表を作る
  var sjis = null;
  // 見た目が同じで文字コードが違う記号（ブラウザによって変換表が異なるため、どちらでも探す）
  var SJIS_SAME = [['〜', '～'], ['−', '－'], ['—', '―'], ['‖', '∥'],
    ['¢', '￠'], ['£', '￡'], ['¬', '￢']];
  var SJIS_FALLBACK = { '¥': '\\', ' ': ' ' };
  SJIS_SAME.forEach(function (p) { SJIS_FALLBACK[p[0]] = p[1]; SJIS_FALLBACK[p[1]] = p[0]; });
  function buildSjis() {
    var dec = new TextDecoder('shift_jis');
    var map = {};
    var b = new Uint8Array(2);
    var lead;
    var trail;
    for (lead = 0x81; lead <= 0xFC; lead++) {
      if (lead > 0x9F && lead < 0xE0) continue;
      for (trail = 0x40; trail <= 0xFC; trail++) {
        if (trail === 0x7F) continue;
        b[0] = lead;
        b[1] = trail;
        var ch = dec.decode(b);
        if (ch.length === 1 && ch !== '�' && map[ch] == null) map[ch] = (lead << 8) | trail;
      }
    }
    for (lead = 0xA1; lead <= 0xDF; lead++) map[dec.decode(new Uint8Array([lead]))] = lead; // 半角カナ
    return map;
  }
  /** 文字列を Shift-JIS のバイト列に。表せない文字は「?」 */
  function encodeSJIS(str) {
    if (!sjis) sjis = buildSjis();
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      var c = ch.charCodeAt(0);
      if (c >= 0xD800 && c <= 0xDBFF) { out.push(0x3F); i++; continue; } // 絵文字など
      if (c < 0x80) { out.push(c); continue; }
      var code = sjis[ch];
      if (code == null && SJIS_FALLBACK[ch]) {
        var f = SJIS_FALLBACK[ch];
        code = f.charCodeAt(0) < 0x80 ? f.charCodeAt(0) : sjis[f];
      }
      if (code == null) { out.push(0x3F); continue; }
      if (code > 0xFF) out.push(code >> 8, code & 0xFF); else out.push(code);
    }
    return new Uint8Array(out);
  }

  /** 仕訳の合計（確認用） */
  function summary(entries) {
    var debit = 0;
    var lines = 0;
    entries.forEach(function (e) {
      e.debits.forEach(function (s) { debit += s.amount; });
      lines += Math.max(e.debits.length, e.credits.length);
    });
    return { entries: entries.length, lines: lines, total: debit };
  }

  var Journal = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    config: config,
    entry: entry,
    buildJournals: buildJournals,
    yayoiTax: yayoiTax,
    mfTax: mfTax,
    toYayoi: toYayoi,
    toMoneyForward: toMoneyForward,
    toGeneric: toGeneric,
    toCsv: toCsv,
    encodeSJIS: encodeSJIS,
    summary: summary,
    MF_HEADER: MF_HEADER
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Journal;
  else root.Journal = Journal;
})(this);
