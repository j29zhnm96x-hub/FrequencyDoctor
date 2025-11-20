const CACHENAME='fd-v20';
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
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');

  // Network-first for HTML/navigation
  if (isHTML) {
    e.respondWith(
      fetch(new Request(req.url, { cache: 'no-store', credentials: 'same-origin' }))
        .then(r => {
          const copy = r.clone();
          caches.open(CACHENAME).then(c => c.put('/index.html', copy)).catch(()=>{});
          return r;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For cross-origin, just try network, fall back to cache
  if (url.origin !== location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  const pathname = url.pathname;
  const ext = pathname.includes('.') ? pathname.split('.').pop().toLowerCase() : '';
  const cacheFirstExts = new Set(['png','jpg','jpeg','gif','svg','ico','mp3','wav','ogg','webp']);

  if (cacheFirstExts.has(ext)) {
    // Cache-first for media and icons
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(r => {
          const copy = r.clone();
          caches.open(CACHENAME).then(c => c.put(req, copy)).catch(()=>{});
          return r;
        });
      })
    );
    return;
  }

  // Network-first for JS/CSS/etc.
  e.respondWith(
    fetch(new Request(req, { cache: 'no-store' }))
      .then(r => {
        const copy = r.clone();
        caches.open(CACHENAME).then(c => c.put(req, copy)).catch(()=>{});
        return r;
      })
      .catch(() => caches.match(req))
  );
});
