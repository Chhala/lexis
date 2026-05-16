/* ═══════════════════════════════════════════════════════════════
   LEXIS — service-worker.js  v1.2
   Cache complet hors-ligne (Cache First pour assets, Network First
   pour words.json au 1er lancement uniquement)
═══════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'lexis-v1.2';
const WORDS_CACHE   = 'lexis-words-v1';

/* Assets à précacher immédiatement à l'installation */
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './words.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  /* Google Fonts — mis en cache à la première visite */
];

/* ── Install : précacher tous les assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        /* words.json peut être volumineux, on ignore l'erreur si absent */
        console.warn('[SW] Précache partiel :', err);
        return self.skipWaiting();
      })
  );
});

/* ── Activate : supprimer les anciens caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== WORDS_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch : stratégie hybride ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Ignorer les requêtes non-GET et cross-origin (Google Fonts API) */
  if (event.request.method !== 'GET') return;

  /* words.json : Cache First (chargé une seule fois) */
  if (url.pathname.endsWith('words.json')) {
    event.respondWith(cacheFirst(event.request, WORDS_CACHE));
    return;
  }

  /* Google Fonts : Stale While Revalidate */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_NAME));
    return;
  }

  /* Tout le reste (index.html, app.js, icons…) : Cache First */
  event.respondWith(cacheFirst(event.request, CACHE_NAME));
});

/* ── Stratégies ── */

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    /* Hors-ligne et pas en cache : retourner index.html comme fallback */
    return caches.match('./index.html') || new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || await fetchPromise || new Response('', { status: 503 });
}

/* ── Message : forcer la mise à jour ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
