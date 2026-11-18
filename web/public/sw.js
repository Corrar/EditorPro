/* EditorPro — service worker (app instalável + shell offline). Mídia fica no IndexedDB. */
const CACHE = 'editorpro-v1';
const SHELL = ['/', '/login', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fontes/modelos de IA externos: deixa o navegador cuidar
  if (url.pathname.startsWith('/api/')) return; // nunca cachear API (IA/sessão)
  if (req.headers.has('range')) return; // vídeos/áudio parciais

  if (req.mode === 'navigate') {
    // network-first: HTML sempre fresco; offline cai no shell em cache
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/'))));
    return;
  }
  // estáticos (_next, ícones, fontes locais): cache-first com atualização em background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
