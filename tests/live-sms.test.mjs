import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{internals} from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://hushhawk.example.test';
const publicOrigin='https://sms.example.test';
const owner='test-owner';
const number='+15125550100';
const recipient='+15125550104';
const account='AC'+'1'.repeat(32);
const token='test-token';
const inbound='/api/sms/inbound';
const sid=n=>'SM'+String(n).padStart(32,'0');
function signed(path,values){
  const input=publicOrigin+path+Object.keys(values).sort().map(key=>key+values[key]).join('');
  return new Request(origin+path,{method:'POST',headers:{
    'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':createHmac('sha1',token).update(input).digest('base64')
  },body:new URLSearchParams(values)});
}
function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const statement=(sql,args)=>{const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};};
  const env={
    HUSHHAWK_SMS_OWNER_ID:owner,TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token,TWILIO_NUMBER:number,TWILIO_WEBHOOK_BASE:publicOrigin,
    DB:{prepare(sql){return {bind:(...args)=>statement(sql,args)};},async batch(list){db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}
  };
  const state=upgrade(seed());
  state.settings.liveSmsReplies=true;
  state.threads=[];state.tasks=[];state.tickets=[];
  const ready=internals.createWorkspace(env.DB,owner,state);
  const load=async()=>{await ready;return (await internals.loadState(env.DB,owner)).state;};
  // Replies now go out through the provider API from a background job; capture them.
  const sent=[];
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('api.twilio.com')){sent.push(options.body.get('Body'));return Response.json({sid:sid(900+sent.length),status:'queued'});}
    return realFetch(url,options);
  };
  const close=()=>{globalThis.fetch=realFetch;db.close();};
  const event=async(n,body,extra={})=>{await ready;return worker.fetch(signed(inbound,{AccountSid:account,MessageSid:sid(n),From:recipient,To:number,Body:body,NumMedia:'0',...extra}),env);};
  return {db:{close},env,load,event,sent};
}

test('signed maintenance SMS creates a ticket and task before replying; duplicate IDs do not reply again',async()=>{
  const {db,load,event,sent}=fixture();
  const first=await event(1,'My kitchen sink is leaking.');
  assert.equal(first.status,200);
  assert.doesNotMatch(await first.text(),/<Message /);
  assert.equal(sent.length,1);
  assert.match(sent[0],/We logged a maintenance request/);
  let state=await load();
  assert.equal(state.tickets.length,1);
  assert.equal(state.tickets[0].status,'New');
  assert.equal(state.tasks[0].status,'Open');
  assert.equal(state.threads[0].messages[1].delivery,'queued');
  await event(1,'My kitchen sink is leaking.');
  await event(2,'My kitchen sink is leaking.');
  assert.equal(sent.length,1);
  state=await load();
  assert.equal(state.tickets.length,1);
  assert.equal(state.tickets[0].reportCount,2);
  assert.equal(state.threads[0].messages.length,3);
  db.close();
});
test('urgent issues escalate and delivery failures create staff work',async()=>{
  const {db,env,load,event,sent}=fixture();
  await event(3,'I smell gas in my unit.');
  assert.match(sent[0],/call your local emergency services/);
  let state=await load();
  assert.equal(state.tickets[0].priority,'Emergency');
  assert.equal(state.tasks[0].kind,'Emergency SMS');
  const id=state.threads[0].messages[1].id;
  const path='/api/sms/status?id='+id;
  const status=await worker.fetch(signed(path,{AccountSid:account,MessageSid:sid(901),MessageStatus:'undelivered',ErrorCode:'30003'}),env);
  assert.equal(status.status,200);
  await worker.fetch(signed(path,{AccountSid:account,MessageSid:sid(901),MessageStatus:'queued'}),env);
  state=await load();
  assert.equal(state.threads[0].messages[1].delivery,'undelivered');
  assert.equal(state.tasks.at(-1).kind,'SMS delivery issue');
  db.close();
});
test('stop suppresses acknowledgments and unsigned messages cannot change records',async()=>{
  const {db,env,load,event,sent}=fixture();
  await load();
  const forged=await worker.fetch(new Request(origin+inbound,{method:'POST',body:new URLSearchParams({From:recipient})}),env);
  assert.equal(forged.status,403);
  assert.equal((await load()).threads.length,0);
  await event(4,'STOP');
  await event(5,'I have a broken window.');
  assert.equal(sent.length,0);
  assert.equal((await load()).contacts.find(item=>item.phone===recipient).optout,true);
  assert.equal((await load()).tickets.length,1);
  db.close();
});
test('company automation rules add their actions to real texts; emergencies still escalate',async()=>{
  const {db,env,load,event}=fixture();
  const state=await load();
  const rule={id:'r-custom',name:'Plumbing to follow-up',trigger:'Maintenance',action:'Create follow-up task',enabled:true,channel:'',property:'',priority:'',order:1,history:[]};
  state.rules=[rule];
  const db2=env.DB;
  await db2.prepare('INSERT INTO records (owner_id,collection,id,data,rev,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(owner_id,collection,id) DO UPDATE SET data = excluded.data').bind(owner,'rules',rule.id,JSON.stringify(rule),'').run();
  await db2.prepare("DELETE FROM records WHERE owner_id = ? AND collection = 'rules' AND id != ?").bind(owner,rule.id).run();
  await event(7,'My kitchen sink is leaking.');
  let after=await load();
  assert.equal(after.tickets.length,1);
  assert.ok(after.tasks.some(task=>task.title.startsWith('Maintenance: ')));
  assert.equal(after.runs[0].name,'Plumbing to follow-up');
  assert.equal(after.runs[0].result,'Completed');
  await event(8,'There is a fire in the hallway.');
  after=await load();
  assert.equal(after.tickets.length,2);
  assert.ok(after.tickets.some(ticket=>ticket.priority==='Emergency'));
  db.close();
});
test('staff SMS calls the provider once per request ID and records its real status',async t=>{
  const {db,env,load,event}=fixture();
  await event(6,'Please contact me about rent.');
  const thread=(await load()).threads[0].id;
  const id=crypto.randomUUID();
  const submit=()=>worker.fetch(new Request(origin+'/api/admin/sms/send',{method:'POST',headers:{
    Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':owner,'oai-authenticated-user-email':'owner@example.test'
  },body:JSON.stringify({thread,id,body:'A staff member will review your question.'})}),env);
  const mock=t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.match(url,/api\.twilio\.com/);
    assert.equal(options.body.get('To'),recipient);
    return Response.json({sid:sid(99),status:'queued'});
  });
  assert.equal((await submit()).status,200);
  assert.equal((await submit()).status,200);
  assert.equal(mock.mock.callCount(),1);
  const saved=(await load()).threads[0].messages.find(message=>message.id===id);
  assert.equal(saved.providerSid,sid(99));
  assert.equal(saved.delivery,'queued');
  db.close();
});
