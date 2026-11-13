/* NIKUPOS - レシートプリンター（エプソン TM-m30 シリーズなど、ePOS-Print 対応機）への直接印刷
 *
 * 画面用のレシート HTML（.c / .title / .row / .ind / .big / hr などの決まった書き方）を
 * 文字の行に並べ直し、ePOS-Print XML にしてプリンターへ HTTP(S) で送ります。
 * お金の引き出し（キャッシュドロア）はプリンター経由でパルスを送って開けます。
 */
(function (global) {
  'use strict';

  // ---------- 文字幅（半角=1・全角=2） ----------
  function charWidth(ch) {
    var c = ch.codePointAt(0);
    if (c <= 0x7e) return 1;
    if (c === 0xa5 || c === 0x203e) return 1; // ¥ ‾ は日本語モードで半角（0x5C・0x7E）になる
    if (c >= 0xff61 && c <= 0xff9f) return 1; // 半角カナ
    return 2;
  }
  function dispWidth(s) {
    var w = 0;
    for (var ch of String(s)) w += charWidth(ch);
    return w;
  }
  /** 前後の半角空白だけ取る（全角空白の字下げは残す） */
  function trimAscii(s) { return String(s || '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); }
  function spaces(n) { return n > 0 ? new Array(n + 1).join(' ') : ''; }

  /** 表示幅で折り返す */
  function wrap(s, width) {
    s = String(s);
    if (width < 2) width = 2;
    var out = [];
    var line = '', w = 0;
    for (var ch of s) {
      var cw = charWidth(ch);
      if (w + cw > width) { out.push(line); line = ''; w = 0; if (ch === ' ') continue; }
      line += ch;
      w += cw;
    }
    out.push(line);
    return out;
  }

  /** 用紙幅（設定値）→ 1行の半角文字数（フォントA） */
  function columns(paperWidth) { return String(paperWidth) === '58' ? 35 : 48; }

  /**
   * ブロック（htmlToBlocks の結果）→ 印字する行
   * block: {kind:'text'|'row'|'hr'|'box'|'blank', text, left, right, align, size(1|2|'h'), em, ind}
   * line: {text, align, size, em}
   */
  function layout(blocks, cols) {
    var lines = [];
    blocks.forEach(function (b) {
      var size = b.size === 2 ? 2 : b.size === 'h' ? 'h' : 1; // 2=縦横倍角, h=縦だけ倍
      var avail = size === 2 ? Math.floor(cols / 2) : cols;
      var pre = b.ind ? '  ' : '';
      var st = { size: size, em: !!b.em };
      function push(text, align) { lines.push({ text: text, align: align || 'left', size: st.size, em: st.em }); }
      if (b.kind === 'hr') { lines.push({ text: spaces(0) + new Array(cols + 1).join('-'), align: 'left', size: 1, em: false }); return; }
      if (b.kind === 'blank') { lines.push({ text: '', align: 'left', size: 1, em: false }); return; }
      if (b.kind === 'box') {
        var inner = ' ' + b.text + ' ';
        var iw = Math.max(dispWidth(inner), 10);
        var bar = '+' + new Array(iw + 1).join('-') + '+';
        var empty = '|' + spaces(iw) + '|';
        var pad = iw - dispWidth(inner);
        [bar, empty, '|' + spaces(Math.floor(pad / 2)) + inner + spaces(pad - Math.floor(pad / 2)) + '|', empty, bar]
          .forEach(function (t) { lines.push({ text: t, align: 'left', size: 1, em: false }); });
        return;
      }
      if (b.kind === 'row') {
        var left = pre + trimAscii(b.left), right = trimAscii(b.right);
        var lw = dispWidth(left), rw = dispWidth(right);
        if (lw + rw + 1 <= avail) { push(left + spaces(avail - lw - rw) + right); return; }
        wrap(left, avail).forEach(function (t) { push(t); });
        if (right) push(spaces(avail - rw) + right);
        return;
      }
      // text
      String(b.text || '').split('\n').forEach(function (para) {
        var avail2 = avail - pre.length;
        wrap(trimAscii(para), avail2).forEach(function (t) { push(pre + t, b.align === 'center' ? 'center' : 'left'); });
      });
    });
    return lines;
  }

  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * 行 → ePOS-Print XML（SOAP の封筒込み）
   * opts: {drawer: true でお金の引き出しを開ける, cut: false で切らない, feed: 最後の送り行数}
   */
  function toEposXml(lines, opts) {
    opts = opts || {};
    var x = '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">';
    if (opts.drawer) x += '<pulse drawer="drawer_1" time="pulse_100"/>';
    if (lines && lines.length) {
      x += '<text lang="ja"/><text smooth="true"/>';
      var cur = { align: null, size: null, em: null };
      lines.forEach(function (l) {
        if (l.align !== cur.align) { x += '<text align="' + l.align + '"/>'; cur.align = l.align; }
        if (l.size !== cur.size) {
          x += '<text dw="' + (l.size === 2) + '" dh="' + (l.size === 2 || l.size === 'h') + '"/>';
          cur.size = l.size;
        }
        if (l.em !== cur.em) { x += '<text em="' + (l.em ? 'true' : 'false') + '"/>'; cur.em = l.em; }
        x += '<text>' + xmlEsc(l.text) + '&#10;</text>';
      });
      x += '<text dw="false" dh="false" em="false"/><text align="left"/>';
      x += '<feed line="' + (opts.feed == null ? 2 : opts.feed) + '"/>';
      if (opts.cut !== false) x += '<cut type="feed"/>';
    }
    x += '</epos-print>';
    return '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' + x + '</s:Body></s:Envelope>';
  }

  /** プリンターの返事を読む */
  function parseResponse(text) {
    var m = /<response\b([^>]*)>/i.exec(String(text || ''));
    if (!m) return { success: false, code: 'BadResponse', status: 0 };
    var attr = function (n) { var r = new RegExp('\\b' + n + '="([^"]*)"').exec(m[1]); return r ? r[1] : ''; };
    return { success: attr('success') === 'true', code: attr('code'), status: Number(attr('status')) || 0 };
  }

  var MESSAGES = {
    EPTR_COVER_OPEN: 'プリンターのカバーが開いています',
    EPTR_REC_EMPTY: 'レシート用紙がありません',
    EPTR_AUTOCUTTER: '用紙を切る部分（オートカッター）でエラーが起きました。電源を入れ直してください',
    EPTR_CUTTER: '用紙を切る部分（オートカッター）でエラーが起きました。電源を入れ直してください',
    EPTR_MECHANICAL: 'プリンターの機械的なエラーです。電源を入れ直してください',
    EPTR_UNRECOVERABLE: 'プリンターで回復できないエラーが起きました。電源を入れ直してください',
    EPTR_AUTOMATICAL: 'プリンターで自動復帰するエラーが起きました。少し待ってからやり直してください',
    DeviceNotFound: 'プリンターのデバイスIDが違います（ふつうは local_printer）',
    SchemaError: '印刷データの形式エラーです',
    PrintSystemError: 'プリンターの印刷システムでエラーが起きました',
    EX_TIMEOUT: 'プリンターの応答がありません（電源・用紙・カバーを確認してください）',
    EX_ENPC_TIMEOUT: 'プリンターの応答がありません（電源・用紙・カバーを確認してください）',
    EX_SPOOLER: 'プリンターが混み合っています。少し待ってからやり直してください',
    TooManyRequests: 'プリンターが混み合っています。少し待ってからやり直してください',
    Printing: '前の印刷が終わっていません。少し待ってからやり直してください',
    BadResponse: 'プリンター以外の機器から返事がありました。IPアドレスを確認してください'
  };
  function errorMessage(code) { return MESSAGES[code] || ('プリンターのエラー（' + (code || '不明') + '）'); }

  /** IPアドレス欄の入力をそろえる（http:// や末尾の / を外す） */
  function normalizeHost(s) {
    return String(s || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }

  // ---------- ここからブラウザ専用 ----------

  /** 画面用のレシート HTML → ブロック */
  function htmlToBlocks(html) {
    var root = document.createElement('div');
    root.innerHTML = html;
    var blocks = [];
    function textOf(el) {
      var c = el.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll('br'), function (br) { br.replaceWith('\n'); });
      return c.textContent.replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n');
    }
    function isBold(el) {
      var b = el.querySelector('b,strong');
      return !!(/700|bold/.test(el.style.fontWeight) || (b && b.textContent.trim() === el.textContent.trim()));
    }
    function walk(parent, inherit) {
      Array.prototype.forEach.call(parent.childNodes, function (n) {
        if (n.nodeType === 3) {
          if (n.textContent.trim()) blocks.push({ kind: 'text', text: n.textContent.trim(), align: inherit.align, size: 1, em: false, ind: false });
          return;
        }
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (tag === 'HR') { blocks.push({ kind: 'hr' }); return; }
        if (tag === 'BR') return;
        var cl = n.classList;
        var big = cl.contains('title') || cl.contains('voidmark') || cl.contains('big');
        var center = cl.contains('c') || cl.contains('voidmark') || n.style.textAlign === 'center' || inherit.align === 'center';
        if (/border/.test(n.getAttribute('style') || '') && n.textContent.trim() === '収入印紙') {
          blocks.push({ kind: 'box', text: '収入印紙' });
          return;
        }
        // 大きい文字：中央寄せは縦横倍角、左寄せ（宛名など）は縦だけ倍角にして1行に多く入れる
        var size = !big ? 1 : center || cl.contains('row') ? 2 : 'h';
        if (cl.contains('row')) {
          var sp = Array.prototype.slice.call(n.querySelectorAll(':scope > span'));
          blocks.push({
            kind: 'row', left: sp.length ? textOf(sp[0]) : '', right: sp.length > 1 ? textOf(sp[sp.length - 1]) : '',
            size: size, em: big || (sp.length > 0 && sp.every(isBold)), ind: cl.contains('ind')
          });
          return;
        }
        if (n.querySelector('div,hr,table')) { walk(n, { align: center ? 'center' : 'left' }); return; }
        var t = trimAscii(textOf(n));
        if (cl.contains('voidmark')) t = '＊ ' + t + ' ＊';
        if (!t) return;
        if (/margin-top/.test(n.getAttribute('style') || '')) blocks.push({ kind: 'blank' });
        blocks.push({ kind: 'text', text: t, align: center ? 'center' : 'left', size: size, em: big || isBold(n), ind: cl.contains('ind') });
      });
    }
    walk(root, { align: 'left' });
    return blocks;
  }

  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  var workingProto = null; // つながった方式を覚えておく
  /** 試す順番：auto なら、iPhone・iPad は https、Android などは http（ローカル通信の許可）→ https */
  function protoOrder(cfg) {
    if (cfg.proto === 'http' || cfg.proto === 'https') return [cfg.proto];
    if (location.protocol === 'http:') return ['http', 'https'];
    if (workingProto) return [workingProto];
    return isIOS() ? ['https'] : ['http', 'https'];
  }

  function post(proto, cfg, xml) {
    var url = proto + '://' + normalizeHost(cfg.host) + '/cgi-bin/epos/service.cgi?devid=' +
      encodeURIComponent(cfg.devid || 'local_printer') + '&timeout=10000';
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT', 'SOAPAction': '""' },
      body: xml,
      signal: ctl ? ctl.signal : undefined,
      cache: 'no-store',
      targetAddressSpace: 'local' // Chrome：店内のネットワークにある機器への通信であることを伝える
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (t) { return { http: res.status, body: t }; });
    }, function (err) {
      clearTimeout(timer);
      var e = new Error('network');
      e.network = true;
      e.timeout = err && err.name === 'AbortError';
      throw e;
    });
  }

  var queue = Promise.resolve();
  /** XML を送る。成功で resolve、失敗で Error(message) を reject */
  function send(cfg, xml) {
    var job = queue.then(function () {
      if (!normalizeHost(cfg.host)) throw new Error('プリンターのIPアドレスが設定されていません（管理 → 設定 → レシートプリンター）');
      var order = protoOrder(cfg);
      var i = 0;
      function attempt() {
        var proto = order[i];
        return post(proto, cfg, xml).then(function (r) {
          var p = parseResponse(r.body);
          if (r.http === 404 && !p.success) throw new Error('ePOS-Print が見つかりません。プリンターの設定で ePOS-Print を「有効」にしてください');
          if (!p.success) throw new Error(errorMessage(p.code));
          if (cfg.proto !== 'http' && cfg.proto !== 'https') workingProto = proto;
          return p;
        }, function (e) {
          if (!e.network) throw e;
          i++;
          if (i < order.length) return attempt();
          if (e.timeout) throw new Error('プリンターの応答がありません。電源と、同じWi-Fi・LANにつながっているかを確認してください');
          throw new Error(isIOS() && order.indexOf('https') >= 0
            ? 'プリンターにつながりません。IPアドレス・同じWi-Fiか・証明書の許可（管理 → 設定 → レシートプリンター）を確認してください'
            : 'プリンターにつながりません。IPアドレスと、同じWi-Fi・LANにつながっているかを確認してください');
        });
      }
      return attempt();
    });
    queue = job.catch(function () {});
    return job;
  }

  var Printer = {
    dispWidth: dispWidth,
    wrap: wrap,
    columns: columns,
    layout: layout,
    toEposXml: toEposXml,
    parseResponse: parseResponse,
    errorMessage: errorMessage,
    normalizeHost: normalizeHost,
    htmlToBlocks: htmlToBlocks,
    /** レシート HTML を印刷（opts.drawer で引き出しも開ける） */
    printHtml: function (cfg, html, opts) {
      var lines = layout(htmlToBlocks(html), columns(cfg.paperWidth));
      return send(cfg, toEposXml(lines, opts));
    },
    openDrawer: function (cfg) { return send(cfg, toEposXml([], { drawer: true })); },
    testPage: function (cfg, storeName) {
      var cols = columns(cfg.paperWidth);
      var lines = layout([
        { kind: 'text', text: 'テスト印刷', align: 'center', size: 2, em: true },
        { kind: 'text', text: storeName || '', align: 'center', size: 1 },
        { kind: 'hr' },
        { kind: 'row', left: '鶏もも 100g', right: '¥198' },
        { kind: 'row', left: '半角ｶﾅ・全角カナ・ABC', right: '1,234' },
        { kind: 'row', left: '1行の文字数', right: cols + '文字' },
        { kind: 'hr' },
        { kind: 'text', text: '印刷できました', align: 'center', size: 1 }
      ], cols);
      return send(cfg, toEposXml(lines, {}));
    },
    certUrl: function (cfg) { return 'https://' + normalizeHost(cfg.host) + '/'; },
    isIOS: function () { return typeof navigator !== 'undefined' && isIOS(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Printer;
  else global.Printer = Printer;
})(typeof window !== 'undefined' ? window : this);
