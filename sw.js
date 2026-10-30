const CACHE='cj2027-v19';
const ASSETS=['/campos-jordao-2027/','/campos-jordao-2027/index.html','/campos-jordao-2027/voz.js','/campos-jordao-2027/manifest.json','/campos-jordao-2027/icon-192.png','/campos-jordao-2027/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{if(resp&&resp.status===200&&resp.type==='basic'){const cl=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,cl))}return resp}).catch(()=>caches.match('/campos-jordao-2027/'))))});
