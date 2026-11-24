// Vercel function: runs the same Worker code as Cloudflare, on Node, with a SQLite database
// that behaves like D1. DEMO ONLY: the database lives in /tmp, so data resets whenever Vercel
// starts a fresh instance. Connect a hosted database before real use.
import {DatabaseSync} from 'node:sqlite';
import worker,{migrations} from './_worker.mjs';

const sqlite=new DatabaseSync(process.env.HUSHHAWK_SQLITE_PATH||'/tmp/hushhawk.sqlite');
sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY)');
const applied=new Set(sqlite.prepare('SELECT tag FROM _migrations').all().map(row=>row.tag));
for(const {tag,sql} of migrations){
  if(applied.has(tag))continue;
  sqlite.exec(sql);
  sqlite.prepare('INSERT INTO _migrations (tag) VALUES (?)').run(tag);
}
const statement=(sql,args)=>{const prepared=sqlite.prepare(sql);return {
  first:async()=>prepared.get(...args)??null,
  all:async()=>({results:prepared.all(...args)}),
  run:async()=>({meta:prepared.run(...args)})
};};
const env={DB:{
  prepare(sql){return {bind:(...args)=>statement(sql,args),...statement(sql,[])};},
  async batch(list){
    sqlite.exec('BEGIN');
    try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
}};
for(const [key,value] of Object.entries(process.env))if(key.startsWith('HUSHHAWK_')||key.startsWith('TWILIO_'))env[key]=value;

// Background work is awaited before the function returns, so it isn't cut off.
let pending=[];
const ctx={waitUntil(promise){pending.push(Promise.resolve(promise).catch(error=>console.error('background task failed',error)));}};
// Stand-in for the cron trigger: runs billing, scheduled sends and queued jobs at most every 30 seconds.
let lastTick=0;

export default async function handler(req,res){
  try{
    const url=new URL(req.url,`${req.headers['x-forwarded-proto']?.split(',')[0]||'http'}://${req.headers['x-forwarded-host']||req.headers.host}`);
    // Vercel rewrites /api/* here; restore the original path if the platform passes the rewritten one.
    const rewritten=url.searchParams.get('__path');
    if(rewritten!==null){url.searchParams.delete('__path');if(url.pathname==='/api/index'||url.pathname==='/api')url.pathname='/api/'+rewritten;}
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    const request=new Request(url,{method:req.method,headers:Object.entries(req.headers).filter(([,v])=>typeof v==='string'),
      body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response=await worker.fetch(request,env,ctx);
    if(Date.now()-lastTick>30000){lastTick=Date.now();ctx.waitUntil(worker.scheduled({},env,ctx));}
    const body=Buffer.from(await response.arrayBuffer());
    await Promise.all(pending);pending=[];
    const headers={};
    response.headers.forEach((value,key)=>{headers[key]=key==='set-cookie'?response.headers.getSetCookie():value;});
    res.writeHead(response.status,headers);
    res.end(body);
  }catch(error){
    console.error(error);
    res.writeHead(500,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'Server error. Check the Vercel function logs.'}));
  }
}
