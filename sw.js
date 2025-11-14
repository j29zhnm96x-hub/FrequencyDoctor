const CACHENAME='fd-v12';
const ASSETS=[
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/data/frequencies.js',
  '/img/favicon.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHENAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHENAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET'){return}
  e.respondWith(
    caches.match(req).then(cached=>{
      const fetchP=fetch(req).then(r=>{
        const copy=r.clone();
        caches.open(CACHENAME).then(c=>c.put(req,copy));
        return r;
      }).catch(()=>cached);
      return cached||fetchP;
    })
  );
});
