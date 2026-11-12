/*
 * 開発・テスト用：Firebase（認証 + Cloud Firestore）の REST API のうち、NIKUPOS が使う部分だけを真似るサーバー。
 * 本番では使いません。
 *
 *   node tools/mock-firebase.js [ポート番号=9199]
 *
 * ブラウザのコンソールで次を実行すると、このサーバーにつながります（その後、設定画面から接続）：
 *   localStorage.setItem('nikupos.sync', JSON.stringify({ enabled: false,
 *     authBase: 'http://localhost:9199', tokenBase: 'http://localhost:9199', fsBase: 'http://localhost:9199' }))
 * テスト用アカウント：APIキー test-key ／ メール shop@example.com ／ パスワード pass1234
 */
'use strict';
const http = require('http');

const PORT = Number(process.argv[2] || 9199);
const API_KEY = 'test-key';
const USERS = {
  'shop@example.com': { password: 'pass1234', uid: 'shopUid001' },
  'other@example.com': { password: 'pass1234', uid: 'otherUid002' }
};
const docs = new Map(); // name → { fields }
const tokens = new Map(); // idToken → uid
let lastMicros = 0;
const stats = { reads: 0, writes: 0, queries: 0 };

function now() {
  // Firestore と同じくマイクロ秒まで。1回の書き込み(commit)の中は同じ時刻になる
  let us = Date.now() * 1000;
  if (us <= lastMicros) us = lastMicros + 1;
  lastMicros = us;
  const d = new Date(Math.floor(us / 1000));
  return d.toISOString().replace(/\.(\d{3})Z$/, (m, ms) => '.' + ms + String(us % 1000).padStart(3, '0') + 'Z');
}
function issue(uid) {
  const t = 'id.' + uid + '.' + Math.random().toString(36).slice(2);
  tokens.set(t, uid);
  return t;
}
function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  });
  res.end(JSON.stringify(body));
}
function err(res, code, message, status) { send(res, code, { error: { code, message, status } }); }
function authUid(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return m ? tokens.get(m[1]) : null;
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/__stats') return send(res, 200, Object.assign({ docs: docs.size }, stats));
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const p = url.pathname;
    // ---- 認証 ----
    if (p === '/v1/accounts:signInWithPassword') {
      if (url.searchParams.get('key') !== API_KEY) return err(res, 400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT');
      const b = JSON.parse(raw || '{}');
      const u = USERS[b.email];
      if (!u || u.password !== b.password) return err(res, 400, 'INVALID_LOGIN_CREDENTIALS');
      return send(res, 200, { idToken: issue(u.uid), refreshToken: 'rt.' + u.uid, expiresIn: '3600', localId: u.uid, email: b.email });
    }
    if (p === '/v1/token') {
      if (url.searchParams.get('key') !== API_KEY) return err(res, 400, 'API key not valid.');
      const rt = new URLSearchParams(raw).get('refresh_token') || '';
      const uid = rt.replace(/^rt\./, '');
      if (!Object.values(USERS).some((u) => u.uid === uid)) return err(res, 400, 'INVALID_REFRESH_TOKEN');
      return send(res, 200, { id_token: issue(uid), refresh_token: rt, expires_in: '3600', user_id: uid });
    }
    // ---- Firestore ----
    const uid = authUid(req);
    let m = /^\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents:commit$/.exec(p);
    if (m) {
      if (!uid) return err(res, 401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
      const b = JSON.parse(raw || '{}');
      const writes = b.writes || [];
      if (writes.length > 500) return err(res, 400, 'maximum 500 writes allowed per request', 'INVALID_ARGUMENT');
      for (const w of writes) {
        const mm = /\/documents\/shops\/([^/]+)\/records\/[^/]+$/.exec(w.update.name);
        if (!mm || mm[1] !== uid) return err(res, 403, 'Missing or insufficient permissions.', 'PERMISSION_DENIED');
      }
      const t = now();
      for (const w of writes) {
        const fields = Object.assign({}, w.update.fields);
        (w.updateTransforms || []).forEach((tr) => { if (tr.setToServerValue === 'REQUEST_TIME') fields[tr.fieldPath] = { timestampValue: t }; });
        docs.set(w.update.name, { fields });
      }
      stats.writes += writes.length;
      return send(res, 200, { writeResults: writes.map(() => ({ updateTime: t })), commitTime: t });
    }
    m = /^\/v1\/(projects\/[^/]+\/databases\/\(default\)\/documents\/shops\/([^/]+)):runQuery$/.exec(p);
    if (m) {
      if (!uid) return err(res, 401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
      if (m[2] !== uid) return err(res, 403, 'Missing or insufficient permissions.', 'PERMISSION_DENIED');
      const q = (JSON.parse(raw || '{}').structuredQuery) || {};
      const prefix = m[1] + '/records/';
      let list = [];
      for (const [name, d] of docs) if (name.startsWith(prefix)) list.push({ name, fields: d.fields });
      const ff = q.where && q.where.fieldFilter;
      if (ff) {
        const v = ff.value.timestampValue;
        list = list.filter((d) => {
          const u = d.fields._u.timestampValue;
          return ff.op === 'GREATER_THAN' ? u > v : ff.op === 'GREATER_THAN_OR_EQUAL' ? u >= v : true;
        });
      }
      list.sort((a, b) => (a.fields._u.timestampValue < b.fields._u.timestampValue ? -1 : a.fields._u.timestampValue > b.fields._u.timestampValue ? 1 : 0));
      if (q.limit) list = list.slice(0, q.limit);
      stats.queries++;
      stats.reads += Math.max(1, list.length);
      const readTime = now();
      if (!list.length) return send(res, 200, [{ readTime }]);
      return send(res, 200, list.map((d) => ({ document: { name: d.name, fields: d.fields }, readTime })));
    }
    err(res, 404, 'Not found: ' + p, 'NOT_FOUND');
  });
}).listen(PORT, () => console.log('mock firebase on http://localhost:' + PORT));
