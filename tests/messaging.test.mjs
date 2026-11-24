import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{internals} from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://test.example';
const superAdmin={email:'root@hushhawk.test',password:'super-secret-password'};
const TOKEN='00000000-1111-2222-3333-444444444444';
function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const statement=(sql,args)=>{const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};};
  const env={HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,HUSHHAWK_SECRETS_KEY:'a-long-test-secrets-key',
    DB:{prepare(sql){return {bind:(...args)=>statement(sql,args)};},async batch(list){db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const client=()=>{let cookie='';return async(path,body,method=body===undefined?'GET':'POST',raw=false)=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)}),env);
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0];
    if(raw)return response;
    const type=response.headers.get('Content-Type')||'';
    return {status:response.status,body:type.includes('json')?await response.json():await response.text()};
  };};
  // Provider calls are captured instead of leaving the machine.
  const outbox={email:[],sms:[]},realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    url=String(url);
    if(url.startsWith('https://api.postmarkapp.com/email')){const body=JSON.parse(options.body);outbox.email.push(body);return Response.json({ErrorCode:0,Message:'OK',MessageID:'pm-'+outbox.email.length});}
    if(url.includes('api.twilio.com')&&url.includes('/Media/'))return new Response(new Uint8Array([137,80,78,71,1,2,3]),{headers:{'Content-Type':'image/png'}});
    if(url.includes('api.twilio.com')){outbox.sms.push(Object.fromEntries(options.body));return Response.json({sid:'SM'+String(outbox.sms.length).padStart(32,'0'),status:'queued'});}
    return realFetch(url,options);
  };
  const close=()=>{globalThis.fetch=realFetch;db.close();};
  return {db,env,client,outbox,close};
}
async function company(ctx,{name='Harbor View',email='morgan@harbor.test'}={}){
  const owner=ctx.client(),admin=ctx.client();
  await owner('/api/auth/signup',{acceptTerms:true,company:name,name:'Morgan',email,password:'harbor-view-2026'});
  await admin('/api/auth/login',superAdmin);
  const id=(await admin('/api/super/overview',{})).body.companies.find(c=>c.name===name).id;
  await admin('/api/super/company',{id,action:'approve'});
  await admin('/api/super/subscription',{companyId:id,action:'activate',planId:'business',months:1});
  const state=upgrade(seed());
  state.settings.liveEmailReplies=true;state.settings.liveSmsReplies=true;
  assert.equal((await owner('/api/workspace',{revision:0,state},'PUT')).status,200);
  return {owner,admin,id};
}
async function connectEmail(admin){
  const r=await admin('/api/super/providers',{postmarkToken:TOKEN,emailSender:'notifications@hushhawk.test',emailInbound:'inbox@mail.hushhawk.test'});
  return r.body.providers.emailWebhookToken;
}
const key=id=>'c'+id.replace(/-/g,'').slice(0,10);
const inboundMail=(id,extra={})=>({MessageID:'mail-1',From:'tenant@example.test',FromFull:{Email:'tenant@example.test',Name:'Riley Tenant'},
  ToFull:[{Email:`inbox+${key(id)}@mail.hushhawk.test`,MailboxHash:key(id)}],MailboxHash:key(id),Subject:'Kitchen sink is leaking',TextBody:'My kitchen sink is leaking badly.',
  Attachments:[{Name:'leak.png',ContentType:'image/png',Content:Buffer.from([137,80,78,71]).toString('base64')}],...extra});

test('incoming email becomes a conversation with intake, an emailed acknowledgment and a stored attachment',async()=>{
  const ctx=setup();
  try{
    const {owner,admin,id}=await company(ctx),secret=await connectEmail(admin);
    assert.match(secret,/^[a-f0-9]{48}$/);
    const hook=ctx.client();
    assert.equal((await hook('/api/email/inbound?token=wrong',inboundMail(id))).status,403);
    assert.equal((await hook('/api/email/inbound?token='+secret,inboundMail(id))).status,200);
    assert.equal((await hook('/api/email/inbound?token='+secret,inboundMail(id))).body.duplicate,true);
    const state=(await owner('/api/workspace')).body.state;
    const thread=state.threads.find(t=>t.channel==='Email'&&t.subject==='Kitchen sink is leaking');
    const incoming=thread.messages[0];
    assert.equal(incoming.attachments[0].name,'leak.png');
    assert.ok(state.tickets.some(t=>t.thread===thread.id&&t.title==='Maintenance request by email'));
    assert.equal(state.contacts.find(c=>c.email==='tenant@example.test').name,'Riley Tenant');
    const ack=ctx.outbox.email.find(m=>m.To==='tenant@example.test');
    assert.match(ack.TextBody,/logged your message for maintenance review/);
    assert.equal(ack.ReplyTo,`inbox+${key(id)}.t${thread.id.replace(/-/g,'').slice(0,12)}@mail.hushhawk.test`);
    const file=await owner('/api/files/'+incoming.attachments[0].id,undefined,'GET',true);
    assert.equal(file.status,200);
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[137,80,78,71]);
    const other=await company(ctx,{name:'Other Co',email:'x@other.test'});
    assert.equal((await other.owner('/api/files/'+incoming.attachments[0].id,undefined,'GET',true)).status,404);
    assert.equal((await ctx.client()('/api/files/'+incoming.attachments[0].id,undefined,'GET',true)).status,404);
    const reply=inboundMail(id,{MessageID:'mail-2',Subject:'Re: totally different subject',TextBody:'Still leaking.',Attachments:[],MailboxHash:`${key(id)}.t${thread.id.replace(/-/g,'').slice(0,12)}`});
    await hook('/api/email/inbound?token='+secret,reply);
    const after=(await owner('/api/workspace')).body.state.threads.find(t=>t.id===thread.id);
    assert.equal(after.messages.filter(m=>m.kind==='in').length,2);
  }finally{ctx.close();}
});

test('staff email replies go out with reply routing, and delivery and bounce events update the record',async()=>{
  const ctx=setup();
  try{
    const {owner,admin,id}=await company(ctx),secret=await connectEmail(admin);
    await ctx.client()('/api/email/inbound?token='+secret,inboundMail(id,{Attachments:[]}));
    let state=(await owner('/api/workspace')).body.state;
    const thread=state.threads.find(t=>t.channel==='Email'&&t.subject==='Kitchen sink is leaking');
    const messageId=crypto.randomUUID();
    const sent=await owner('/api/company/email',{thread:thread.id,id:messageId,body:'A plumber will come tomorrow morning.'});
    assert.equal(sent.body.status,'sent');
    const mail=ctx.outbox.email.at(-1);
    assert.equal(mail.Subject,'Re: Kitchen sink is leaking');
    assert.equal(mail.From,'"Harbor View" <notifications@hushhawk.test>');
    assert.equal(mail.Metadata.message,messageId);
    const hook=ctx.client();
    const providerId=(await owner('/api/workspace')).body.state.threads.find(t=>t.id===thread.id).messages.find(m=>m.id===messageId).providerSid;
    await hook('/api/email/events?token='+secret,{RecordType:'Delivery',MessageID:providerId,Metadata:{owner:'company:'+id,message:messageId}});
    state=(await owner('/api/workspace')).body.state;
    assert.equal(state.threads.find(t=>t.id===thread.id).messages.find(m=>m.id===messageId).delivery,'delivered');
    const second=crypto.randomUUID();
    await owner('/api/company/email',{thread:thread.id,id:second,body:'Following up.'});
    const secondId=(await owner('/api/workspace')).body.state.threads.find(t=>t.id===thread.id).messages.find(m=>m.id===second).providerSid;
    await hook('/api/email/events?token='+secret,{RecordType:'Bounce',Type:'HardBounce',Email:'tenant@example.test',MessageID:secondId,Metadata:{owner:'company:'+id,message:second}});
    state=(await owner('/api/workspace')).body.state;
    assert.equal(state.contacts.find(c=>c.email==='tenant@example.test').emailBounced,true);
    assert.equal((await owner('/api/company/email',{thread:thread.id,id:crypto.randomUUID(),body:'Again'})).status,400);
    assert.equal((await owner('/api/workspace')).body.emailInbox.address,`inbox+${key(id)}@mail.hushhawk.test`);
  }finally{ctx.close();}
});

test('invites, approvals, invoices and support replies are emailed once email is connected',async()=>{
  const ctx=setup();
  try{
    const admin=ctx.client();
    await admin('/api/auth/login',superAdmin);
    await connectEmail(admin);
    const owner=ctx.client();
    await owner('/api/auth/signup',{acceptTerms:true,company:'Lakeside',name:'Priya',email:'priya@lakeside.test',password:'lakeside-living-2026'});
    const id=(await admin('/api/super/overview',{})).body.companies[0].id;
    await admin('/api/super/company',{id,action:'approve'});
    ctx.db.prepare('UPDATE plans SET trial_days = 0').run();
    await owner('/api/company/plan',{planId:'essential'});
    const invite=await owner('/api/company/invite',{email:'jo@lakeside.test',role:'agent'});
    assert.equal(invite.body.emailed,true);
    await internals.runJobs(ctx.env);
    const subjects=ctx.outbox.email.map(m=>`${m.To} | ${m.Subject}`);
    assert.ok(subjects.includes(`${superAdmin.email} | New company waiting for approval: Lakeside`));
    assert.ok(subjects.includes('priya@lakeside.test | Your company has been approved'));
    assert.ok(subjects.some(s=>s.startsWith('priya@lakeside.test | Invoice HH-')));
    assert.ok(subjects.includes('jo@lakeside.test | Priya invited you to Lakeside on HushHawk'));
    assert.match(ctx.outbox.email.find(m=>m.To==='jo@lakeside.test').TextBody,/#invite\/[a-f0-9]{64}/);
  }finally{ctx.close();}
});

test('MMS photos are saved with the message, segments are counted, and replies use the number the tenant texted',async()=>{
  const ctx=setup();
  try{
    const {owner,admin,id}=await company(ctx);
    await admin('/api/super/providers',{twilioSid:'AC'+'1'.repeat(32),twilioToken:'a'.repeat(32),twilioWebhookBase:'https://hooks.example'});
    for(const number of ['+15125550100','+15125550199']){await admin('/api/super/number',{action:'add',number});await admin('/api/super/number',{action:'assign',number,companyId:id});}
    const values={AccountSid:'AC'+'1'.repeat(32),MessageSid:'SM'+'7'.repeat(32),From:'+15125550104',To:'+15125550199',Body:'Water is leaking from the ceiling',NumMedia:'1',NumSegments:'1',
      MediaUrl0:'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1',MediaContentType0:'image/png'};
    const path='/api/sms/inbound';
    const input='https://hooks.example'+path+Object.keys(values).sort().map(k=>k+values[k]).join('');
    const signature=createHmac('sha1','a'.repeat(32)).update(input).digest('base64');
    const response=await worker.fetch(new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body:new URLSearchParams(values)}),ctx.env);
    assert.equal(response.status,200);
    const state=(await owner('/api/workspace')).body.state;
    const thread=state.threads.find(t=>t.via==='+15125550199');
    const incoming=thread.messages.filter(m=>m.kind==='in').at(-1);
    assert.equal(incoming.attachments[0].type,'image/png');
    assert.equal(ctx.outbox.sms[0].From,'+15125550199');
    await owner('/api/company/sms',{thread:thread.id,id:crypto.randomUUID(),body:'x'.repeat(200)});
    assert.equal(ctx.outbox.sms.at(-1).From,'+15125550199');
    const usage=(await owner('/api/company/overview')).body.usage;
    assert.equal(usage.smsIn,1);
    assert.equal(usage.smsOut,3);
    assert.equal(internals.smsSegments('é'.repeat(71)),1);
    assert.equal(internals.smsSegments('😀'.repeat(40)),2);
    assert.equal(internals.smsSegments('a'.repeat(161)),2);
  }finally{ctx.close();}
});
