/* EditorPro — service worker (app instalável + shell offline). Mídia fica no IndexedDB.
   v2: o cache não cresce mais a cada deploy — só /_next/static (com hash) vai para um cache
   próprio, limitado às STATIC_MAX entradas mais recentes; o resto da origem não é guardado.
   Trocar o nome do CACHE instala este SW e o activate apaga o 'editorpro-v1' antigo. */
const CACHE = 'editorpro-v2';
const STATIC = 'editorpro-static';
const STATIC_MAX = 150;
const SHELL = ['/', '/login', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k)));
    await trimStatic();
    await self.clients.claim();
  })());
});

/** apaga as entradas mais antigas (cache.keys() vem em ordem de inserção) */
async function trimStatic() {
  const c = await caches.open(STATIC);
  const keys = await c.keys();
  const extra = keys.length - STATIC_MAX;
  for (let i = 0; i < extra; i++) await c.delete(keys[i]);
}

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
  const isStatic = url.pathname.startsWith('/_next/static/');
  const isShell = SHELL.includes(url.pathname);
  if (!isStatic && !isShell) return; // resto: rede normal, sem guardar (não acumula)

  // estáticos com hash: cache-first; shell: cache-first com atualização em background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(isStatic ? STATIC : CACHE).then((c) => c.put(req, copy)).then(() => (isStatic ? trimStatic() : undefined)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
