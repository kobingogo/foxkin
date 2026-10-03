importScripts('./offline-assets.js');
self.addEventListener('install',event=>event.waitUntil(caches.open(self.FOXKIN_CACHE).then(cache=>cache.addAll(self.FOXKIN_ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith('foxkin-') && key!==self.FOXKIN_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{ if(event.data==='ACTIVATE') self.skipWaiting(); });
self.addEventListener('fetch',event=>{
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async()=>{
    const cache=await caches.open(self.FOXKIN_CACHE);
    // The application and its dependencies always come from one complete cache version.
    if(request.mode==='navigate') return await cache.match('/') || fetch(request);
    return await cache.match(url.pathname) || fetch(request);
  })());
});
