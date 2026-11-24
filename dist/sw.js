const prefix='hushhawk-shell-';
const version=prefix+'20';
const paths=['./','./index.html','./style.css','./app.js','./model.js','./workspace.js','./front.js','./accounts.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(version).then(cache=>cache.addAll(paths)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(prefix)&&key!==version).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||
    /^\/(admin|api|signin-with-chatgpt|signout-with-chatgpt|callback)(\/|$)/.test(url.pathname))return;
  const shell=paths.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
  if(!shell&&event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(async()=>{
    const cache=await caches.open(version);
    return (await cache.match(event.request,{ignoreSearch:true})) ||
      (event.request.mode==='navigate'&&await cache.match('./index.html')) ||
      new Response('HushHawk is offline.',{status:503});
  }));
});
