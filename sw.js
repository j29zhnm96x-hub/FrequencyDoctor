const CACHENAME='fd-v22';
const ASSETS=[
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/data/frequencies.js',
  '/img/favicon.png'
];

// Background audio loops to pre-cache for offline playback
const AUDIO_LOOPS=[
  '/audio/ambientalsynth.mp3',
  '/audio/birds.mp3',
  '/audio/rain_forest.mp3',
  '/audio/galactic_waves.mp3',
  '/audio/white_noise.mp3'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHENAME)
      .then(c => c.addAll(ASSETS.concat(AUDIO_LOOPS)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHENAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Allow page to request immediate activation
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  
  const url = new URL(req.url);
  
  // 1. HTML: Network First, fall back to cache
  if (req.mode === 'navigate' || req.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(networkRes => {
          const clone = networkRes.clone();
          caches.open(CACHENAME).then(c => c.put('/index.html', clone));
          return networkRes;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Same-origin assets
  if (url.origin === location.origin) {
    const pathname = url.pathname;
    const ext = pathname.includes('.') ? pathname.split('.').pop().toLowerCase() : '';
    const immutableExts = new Set(['mp3','wav','ogg','png','jpg','jpeg','gif','svg','ico','webp']);

    // Immutable assets (images, audio): Cache First, fall back to network
    if (immutableExts.has(ext)) {
      e.respondWith(
        caches.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(networkRes => {
            const clone = networkRes.clone();
            caches.open(CACHENAME).then(c => c.put(req, clone));
            return networkRes;
          });
        })
      );
      return;
    }

    // Mutable assets (JS, CSS, JSON): Stale-While-Revalidate
    // Return cached version immediately if available, but update cache in background
    e.respondWith(
      caches.match(req).then(cached => {
        const networkFetch = fetch(req).then(networkRes => {
          const clone = networkRes.clone();
          caches.open(CACHENAME).then(c => c.put(req, clone));
          return networkRes;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // 3. Cross-origin: Network only (or simple cache fallback)
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
