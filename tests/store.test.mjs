import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{internals} from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://test.example';
const superAdmin={email:'root@hushhawk.test',password:'super-secret-password'};
function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const statement=(sql,args)=>{const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};};
  const env={HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,HUSHHAWK_SECRETS_KEY:'a-long-test-secrets-key',
    DB:{prepare(sql){return {bind:(...args)=>statement(sql,args)};},async batch(list){db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const client=()=>{let cookie='';return async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(){}});
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,body:await response.json()};
  };};
  return {db,env,client};
}
async function activeCompany(ctx){
  const owner=ctx.client(),admin=ctx.client();
  await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'morgan@harbor.test',password:'harbor-view-2026'});
  await admin('/api/auth/login',superAdmin);
  const id=(await admin('/api/super/overview',{})).body.companies[0].id;
  await admin('/api/super/company',{id,action:'approve'});
  await admin('/api/super/subscription',{companyId:id,action:'activate',planId:'business',months:1});
  await owner('/api/company/plan',{planId:'business'});
  const invite=await owner('/api/company/invite',{email:'jo@harbor.test',role:'agent'});
  const teammate=ctx.client();
  await teammate('/api/auth/accept-invite',{acceptTerms:true,token:invite.body.link.split('#invite/')[1],name:'Jo',password:'jo-password-123'});
  const state=upgrade(seed());
  assert.equal((await owner('/api/workspace',{revision:0,state},'PUT')).status,200);
  return {owner,teammate,id,state};
}

test('teammates edit different records at once; edits to the same record conflict and return the latest',async()=>{
  const ctx=setup(),{owner,teammate}=await activeCompany(ctx);
  const a=(await owner('/api/workspace')).body,b=(await teammate('/api/workspace')).body;
  const contact=a.state.contacts[0],property=a.state.properties[0],other=b.state.contacts[1];
  const one=await owner('/api/workspace/changes',{changes:[{c:'contacts',id:contact.id,data:{...contact,name:'Sarah J.'},rev:a.revs['contacts/'+contact.id]},{c:'properties',id:property.id,data:{...property,name:'Riverside Lofts'},rev:a.revs['properties/'+property.id]}]});
  const two=await teammate('/api/workspace/changes',{changes:[{c:'contacts',id:other.id,data:{...other,unit:'105'},rev:b.revs['contacts/'+other.id]}]});
  assert.deepEqual([one.body.conflicts.length,two.body.conflicts.length],[0,0]);
  const forbidden=await teammate('/api/workspace/changes',{changes:[{c:'properties',id:property.id,data:{...property,name:'Nope'}}]});
  assert.equal(forbidden.status,403);
  assert.match(forbidden.body.error,/role can’t change properties/);
  const stale=await teammate('/api/workspace/changes',{changes:[{c:'contacts',id:contact.id,data:{...contact,name:'Sarah Johnson-Lee'},rev:b.revs['contacts/'+contact.id]}]});
  assert.equal(stale.body.conflicts.length,1);
  assert.equal(stale.body.conflicts[0].data.name,'Sarah J.');
  const latest=(await owner('/api/workspace')).body.state;
  assert.equal(latest.contacts[0].name,'Sarah J.');
  assert.equal(latest.properties[0].name,'Riverside Lofts');
  ctx.db.close();
});

test('messages are stored per message, removals work, and workspaces can grow past the old 1 MB limit',async()=>{
  const ctx=setup(),{owner}=await activeCompany(ctx);
  const loaded=(await owner('/api/workspace')).body;
  const thread=loaded.state.threads[0];
  const added={...thread,messages:[...thread.messages,{id:'m-new',kind:'note',body:'Called the tenant.',time:new Date().toISOString()}]};
  await owner('/api/workspace/changes',{changes:[{c:'threads',id:thread.id,data:added,rev:loaded.revs['threads/'+thread.id]}]});
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get(thread.id).n,thread.messages.length+1);
  const ticket=loaded.state.tickets[0];
  await owner('/api/workspace/changes',{removes:[{c:'tickets',id:ticket.id,rev:loaded.revs['tickets/'+ticket.id]}]});
  assert.equal((await owner('/api/workspace')).body.state.tickets.some(t=>t.id===ticket.id),false);
  const big=Array.from({length:30},(_,i)=>({c:'knowledge',id:'k-big-'+i,data:{id:'k-big-'+i,title:'Policy '+i,topic:'General',body:'x'.repeat(60000)}}));
  for(let i=0;i<big.length;i+=10)assert.equal((await owner('/api/workspace/changes',{changes:big.slice(i,i+10)})).status,200);
  const total=ctx.db.prepare("SELECT SUM(LENGTH(data)) AS n FROM records").get().n;
  assert.ok(total>1500000);
  assert.equal((await owner('/api/workspace')).body.state.knowledge.length,loaded.state.knowledge.length+30);
  ctx.db.close();
});

test('scheduled texts are sent by the server job queue, not the browser',async()=>{
  const ctx=setup(),{owner,id}=await activeCompany(ctx);
  const realFetch=globalThis.fetch,sent=[];
  globalThis.fetch=async(url,options)=>{if(String(url).includes('api.twilio.com')){sent.push(options.body.get('Body'));return Response.json({sid:'SM'+'5'.repeat(32),status:'queued'});}return realFetch(url,options);};
  try{
    const admin=ctx.client();await admin('/api/auth/login',superAdmin);
    await admin('/api/super/providers',{twilioSid:'AC'+'1'.repeat(32),twilioToken:'a'.repeat(32),twilioWebhookBase:'https://hooks.example'});
    await admin('/api/super/number',{action:'add',number:'+15125550100'});
    await admin('/api/super/number',{action:'assign',number:'+15125550100',companyId:id});
    const loaded=(await owner('/api/workspace')).body;
    const thread=loaded.state.threads.find(t=>t.channel==='SMS');
    const job={id:'job-1',thread:thread.id,kind:'Reply',value:'Your technician arrives tomorrow at 9.',date:new Date(Date.now()-1000).toISOString(),status:'Scheduled'};
    await owner('/api/workspace/changes',{changes:[{c:'scheduled',id:job.id,data:job}]});
    await internals.cronTick(ctx.env);
    assert.deepEqual(sent,['Your technician arrives tomorrow at 9.']);
    const after=(await owner('/api/workspace')).body.state;
    assert.equal(after.scheduled.find(j=>j.id==='job-1').status,'Completed');
    assert.equal(after.threads.find(t=>t.id===thread.id).messages.at(-1).body,'Your technician arrives tomorrow at 9.');
    await internals.cronTick(ctx.env);
    assert.equal(sent.length,1);
  }finally{globalThis.fetch=realFetch;}
  ctx.db.close();
});
