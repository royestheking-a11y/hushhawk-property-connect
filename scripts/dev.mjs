// Local preview: runs the real Worker code (worker/*.js) on Node with a SQLite
// database that behaves like D1, and serves dist/ for the browser app.
//   node scripts/dev.mjs            # http://127.0.0.1:8766
import {createServer} from 'node:http';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {extname,join,normalize} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {workerSource,workerFiles} from './worker-source.mjs';

const root=new URL('..',import.meta.url).pathname;
const dataDir=join(root,'dev-data');
mkdirSync(dataDir,{recursive:true});
const port=Number(process.env.PORT||8766);

// Environment: scripts/dev.env, then the process environment.
const env={};
const envFile=join(root,'scripts','dev.env');
if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').split('\n')){
  const match=line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if(match)env[match[1]]=match[2].trim();
}
for(const [key,value] of Object.entries(process.env))if(key.startsWith('HUSHHAWK_')||key.startsWith('TWILIO_'))env[key]=value;

// D1-compatible database over node:sqlite, with migrations from drizzle/.
const sqlite=new DatabaseSync(join(dataDir,'hushhawk-dev.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY)');
const applied=new Set(sqlite.prepare('SELECT tag FROM _migrations').all().map(row=>row.tag));
for(const file of readdirSync(join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort()){
  if(applied.has(file))continue;
  sqlite.exec(readFileSync(join(root,'drizzle',file),'utf8').replaceAll('--> statement-breakpoint',''));
  sqlite.prepare('INSERT INTO _migrations (tag) VALUES (?)').run(file);
  console.log('Applied migration',file);
}
const statement=(sql,args)=>{const prepared=sqlite.prepare(sql);return {
  first:async()=>prepared.get(...args)??null,
  all:async()=>({results:prepared.all(...args)}),
  run:async()=>({meta:prepared.run(...args)})
};};
env.DB={
  prepare(sql){return {bind:(...args)=>statement(sql,args),...statement(sql,[])};},
  async batch(list){
    sqlite.exec('BEGIN');
    try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
};
const ctx={waitUntil(promise){Promise.resolve(promise).catch(error=>console.error('background task failed',error));}};

// Load the Worker from source, rebuilding when a worker file changes.
let loaded={stamp:'',worker:null};
async function worker(){
  const stamp=workerFiles.map(name=>statSync(join(root,name)).mtimeMs).join(':');
  if(stamp!==loaded.stamp){
    const file=join(dataDir,'worker.mjs');
    writeFileSync(file,'const assets={};\n'+await workerSource(root));
    loaded={stamp,worker:(await import(pathToFileURL(file).href+'?v='+Date.now())).default};
  }
  return loaded.worker;
}
// Stand-in for the cron trigger: billing, scheduled sends and queued jobs every 30 seconds.
setInterval(async()=>{try{const w=await worker();await w.scheduled({},env,ctx);}catch(error){console.error('cron tick failed',error);}},30000);

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json'};
function staticFile(pathname){
  let path=pathname==='/'?'/index.html':pathname==='/admin'||pathname==='/admin/'?'/admin/index.html':pathname;
  path=normalize(path).replace(/^(\.\.[/\\])+/,'');
  const file=join(root,'dist',path);
  if(!file.startsWith(join(root,'dist'))||file.startsWith(join(root,'dist','server'))||!existsSync(file)||statSync(file).isDirectory())return null;
  return new Response(readFileSync(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"}});
}

createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'127.0.0.1:'+port}`);
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    let response=url.pathname.startsWith('/api/')?null:staticFile(url.pathname);
    if(!response){
      const request=new Request(url,{method:req.method,headers:Object.entries(req.headers).filter(([,v])=>typeof v==='string'),body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      response=await (await worker()).fetch(request,env,ctx);
    }
    const headers={};
    response.headers.forEach((value,key)=>{headers[key]=value;});
    res.writeHead(response.status,headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    if(url.pathname.startsWith('/api/'))console.log(req.method,url.pathname,response.status);
  }catch(error){
    console.error(error);
    res.writeHead(500,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'Local preview error. See the terminal.'}));
  }
}).listen(port,'127.0.0.1',()=>console.log(`HushHawk local preview (real Worker code) on http://127.0.0.1:${port}`));
