const CACHE='cj2027-v76';
const BASE='/campos-jordao-2027/';
const ASSETS_CORE=[BASE,BASE+'index.html',BASE+'voz.js',BASE+'manifest.json',BASE+'icon-192.png',BASE+'icon-512.png'];
/* CDN externas usadas pelo app — cacheadas para funcionar offline (#9, #15) */
const ASSETS_CDN=[
'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-app-compat.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-database-compat.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-auth-compat.min.js',
'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js',
'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
/* Hosts cujas respostas podem ser servidas do cache quando offline (#22) */
const CDN_HOSTS=['cdnjs.cloudflare.com','cdn.jsdelivr.net','unpkg.com'];

self.addEventListener('install',e=>{
e.waitUntil(
caches.open(CACHE)
.then(c=>c.addAll(ASSETS_CORE).then(()=>Promise.allSettled(ASSETS_CDN.map(u=>c.add(u)))))
.then(()=>self.skipWaiting())
);
});

self.addEventListener('activate',e=>{
e.waitUntil(
caches.keys()
.then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!=='campos-map-tiles').map(k=>caches.delete(k))))
.then(()=>self.clients.claim())
);
});

/* Permite à página pedir a ativação imediata do SW novo (#10) */
self.addEventListener('message',e=>{
if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();
});

function cachePut(req,resp){
if(!resp||!resp.ok)return;
const cl=resp.clone();
caches.open(CACHE).then(c=>c.put(req,cl)).catch(()=>{});
}

self.addEventListener('fetch',e=>{
const req=e.request;
if(req.method!=='GET')return;
const u=new URL(req.url);

/* Mesma origem: cache-first com fallback para o shell do app */
if(u.origin===location.origin){
e.respondWith(
caches.match(req).then(r=>r||fetch(req).then(resp=>{
if(resp&&resp.status===200&&(resp.type==='basic'||resp.type==='cors'))cachePut(req,resp);
return resp;
}).catch(()=>caches.match(BASE)))
);
return;
}

/* CDN externas: cache-first; se a rede falhar, serve a cópia cacheada (#22) */
if(CDN_HOSTS.includes(u.hostname)){
e.respondWith(
caches.match(req).then(r=>r||fetch(req).then(resp=>{
cachePut(req,resp);
return resp;
}).catch(()=>caches.match(req).then(c=>c||Response.error())))
);
return;
}

/* Map tiles (OpenStreetMap): normalize a/b/c subdomain → a.tile for cache lookup */
if(u.hostname.endsWith('.tile.openstreetmap.org')){
const normUrl=req.url.replace(/[abc]\.tile\.openstreetmap\.org/,'a.tile.openstreetmap.org');
const normReq=new Request(normUrl);
e.respondWith(
caches.open('campos-map-tiles').then(c=>c.match(normReq)).then(r=>{
if(r)return r;
return fetch(req).then(resp=>{
if(resp&&resp.ok){const cl=resp.clone();caches.open('campos-map-tiles').then(c=>c.put(normReq,cl)).catch(()=>{});}
return resp;
}).catch(()=>Response.error());
})
);
return;
}

/* Qualquer outra origem (APIs, Firebase): rede, sem interceptar */
});
