// オフライン用キャッシュ。ファイルを更新したら VERSION を上げる
var VERSION = 'nikupos-v19';
var FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/calc.js',
  'js/store.js',
  'js/scale.js',
  'js/printer.js',
  'js/sync.js',
  'js/journal.js',
  'js/accounting.js',
  'js/regops.js',
  'js/staff.js',
  'js/promos.js',
  'js/analysis.js',
  'js/pricing.js',
  'js/xlsx.js',
  'js/report.js',
  'js/profit.js',
  'js/dashboard.js',
  'js/admin.js',
  'admin.html',
  'js/pricelist.js',
  'js/inventory.js',
  'js/wholesale.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

// ネットワーク優先・失敗時はキャッシュ（更新がすぐ反映され、圏外でも動く）
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // 管理画面（kanri/：Flutter で作った別のアプリ）と、ほかのサイトのファイルはこのアプリの保存対象にしない
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/kanri/') >= 0) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
