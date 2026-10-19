'use strict';
// Service worker do Batalha Naval: rede primeiro, cache como reserva (jogável offline na campanha).
const CACHE = 'batalha-naval-v1.5.1';
const FILES = ['./', 'index.html', 'style.css', 'parts.js', 'gameserver.js', 'builder.js', 'touch.js', 'battle.js', 'net.js', 'main.js', 'config.js', 'vendor/peerjs.min.js',
  'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
