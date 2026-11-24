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
function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const statement=(sql,args)=>{const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};};
  const env={HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,HUSHHAWK_SECRETS_KEY:'a-long-test-secrets-key',
    DB:{prepare(sql){return {bind:(...args)=>statement(sql,args)};},async batch(list){db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const client=(ip='203.0.113.1')=>{let cookie='';const call=async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0].endsWith('=')?'':set.split(';')[0];
    const type=response.headers.get('Content-Type')||'';
    return {status:response.status,headers:response.headers,cookie:set,body:type.includes('json')&&!response.headers.get('Content-Disposition')?await response.json():await response.text()};
  };call.hasCookie=()=>Boolean(cookie);return call;};
  return {db,env,client};
}
async function company(ctx,plan='business'){
  const owner=ctx.client(),admin=ctx.client();
  await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'morgan@harbor.test',password:'harbor-view-2026'});
  await admin('/api/auth/login',superAdmin);
  const id=(await admin('/api/super/overview',{})).body.companies[0].id;
  await admin('/api/super/company',{id,action:'approve'});
  await admin('/api/super/subscription',{companyId:id,action:'activate',planId:plan,months:1});
  assert.equal((await owner('/api/workspace',{revision:0,state:upgrade(seed())},'PUT')).status,200);
  return {owner,admin,id};
}
async function join(ctx,owner,role,email){
  const invite=await owner('/api/company/invite',{email,role});
  assert.equal(invite.status,200,JSON.stringify(invite.body));
  const member=ctx.client('198.51.100.'+Math.floor(Math.random()*200));
  await member('/api/auth/accept-invite',{acceptTerms:true,token:invite.body.link.split('#invite/')[1],name:role,password:'member-password-1'});
  return member;
}
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret,offset=0){
  let bits='';for(const c of secret)bits+=B32.indexOf(c).toString(2).padStart(5,'0');
  const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offset));
  const mac=createHmac('sha1',key).update(counter).digest(),o=mac[19]&15;
  return String(((mac[o]&127)<<24|mac[o+1]<<16|mac[o+2]<<8|mac[o+3])%1e6).padStart(6,'0');
}

test('two-step sign-in: setup, sign-in with a code, single-use recovery codes, requirement and reset',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx);
  const setupRes=await owner('/api/auth/mfa-setup',{});
  assert.match(setupRes.body.otpauth,/^otpauth:\/\/totp\/HushHawk/);
  assert.equal((await owner('/api/auth/mfa-enable',{code:'000000'})).status,400);
  const enabled=await owner('/api/auth/mfa-enable',{code:totp(setupRes.body.secret)});
  assert.equal(enabled.body.recoveryCodes.length,10);
  const fresh=ctx.client('203.0.113.9');
  const step1=await fresh('/api/auth/login',{email:'morgan@harbor.test',password:'harbor-view-2026'});
  assert.equal(step1.body.mfaRequired,true);
  assert.equal(step1.cookie,null);
  assert.equal((await fresh('/api/auth/mfa',{challenge:step1.body.challenge,code:'123456'})).status,401);
  const recovery=enabled.body.recoveryCodes[0];
  const step2=await fresh('/api/auth/mfa',{challenge:step1.body.challenge,code:recovery});
  assert.equal(step2.status,200);
  assert.equal((await fresh('/api/me')).body.user.recoveryCodesLeft,9);
  const again=ctx.client('203.0.113.10');
  const retry=await again('/api/auth/login',{email:'morgan@harbor.test',password:'harbor-view-2026'});
  assert.equal((await again('/api/auth/mfa',{challenge:retry.body.challenge,code:recovery})).status,401);
  await owner('/api/company/security',{requireMfa:true});
  assert.equal((await owner('/api/me')).body.user.mfaRequired,true);
  assert.equal((await owner('/api/auth/mfa-disable',{password:'harbor-view-2026'})).status,403);
  const userId=(await owner('/api/me')).body.user.id;
  await admin('/api/super/subscription',{companyId:id,action:'user',userId,op:'reset-mfa'});
  assert.equal((await owner('/api/me')).body.user,null);
  const after=await ctx.client('203.0.113.11')('/api/auth/login',{email:'morgan@harbor.test',password:'harbor-view-2026'});
  assert.equal(after.body.user.mfaEnabled,false);
  ctx.db.close();
});

test('roles limit what each person can change, see and send',async()=>{
  const ctx=setup(),{owner}=await company(ctx);
  const viewer=await join(ctx,owner,'viewer','v@harbor.test');
  const maintenance=await join(ctx,owner,'maintenance','m@harbor.test');
  const finance=await join(ctx,owner,'finance','f@harbor.test');
  const agent=await join(ctx,owner,'agent','a@harbor.test');
  const ws=(await viewer('/api/workspace')).body;
  assert.ok(ws.state.contacts.length>0);
  const contact=ws.state.contacts[0],ticket=ws.state.tickets[0];
  assert.equal((await viewer('/api/workspace/changes',{changes:[{c:'contacts',id:contact.id,data:{...contact,name:'X'}}]})).status,403);
  assert.equal((await maintenance('/api/workspace/changes',{changes:[{c:'tickets',id:ticket.id,data:{...ticket,status:'In progress'},rev:ws.revs['tickets/'+ticket.id]}]})).status,200);
  assert.equal((await maintenance('/api/workspace/changes',{changes:[{c:'contacts',id:contact.id,data:{...contact,name:'X'}}]})).status,403);
  assert.equal((await agent('/api/workspace/changes',{changes:[{c:'_meta',id:'settings',data:{mode:'Off'}}]})).status,403);
  assert.equal((await agent('/api/ai/knowledge',{title:'x',type:'text/plain',text:'hello'})).status,403);
  assert.equal((await viewer('/api/company/email',{thread:'x',id:crypto.randomUUID(),body:'hi'})).status,403);
  assert.ok(Array.isArray((await finance('/api/company/overview')).body.invoices));
  assert.equal((await agent('/api/company/overview')).body.invoices.length,0);
  assert.equal((await finance('/api/company/plan',{planId:'essential'})).status,403);
  assert.equal((await viewer('/api/me')).body.user.roleLabel,'Viewer');
  ctx.db.close();
});

test('export, retention and scheduled deletion',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx,'professional');
  const exported=await owner('/api/company/export');
  assert.match(exported.headers.get('Content-Disposition'),/hushhawk-export-/);
  const data=JSON.parse(exported.body);
  assert.ok(data.workspace.threads.length>0);
  assert.ok(!JSON.stringify(data.users).includes('password'));
  const owner_id='company:'+id;
  ctx.db.prepare("INSERT INTO messages (owner_id,thread_id,id,data,time) VALUES (?,?,?,?,?)").run(owner_id,'t1','old-msg','{"id":"old-msg","kind":"in","body":"old"}','2020-01-01T00:00:00.000Z');
  await owner('/api/company/security',{retentionMonths:12});
  await internals.cronTick(ctx.env);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE id = 'old-msg'").get().n,0);
  assert.ok(ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE owner_id = ?').get(owner_id).n>0);
  assert.equal((await owner('/api/company/security',{action:'request-deletion',confirm:'wrong'})).status,400);
  const requested=await owner('/api/company/security',{action:'request-deletion',confirm:'Harbor View'});
  assert.ok(requested.body.company.deletionRequestedAt);
  ctx.db.prepare('UPDATE companies SET deletion_requested_at = ? WHERE id = ?').run(new Date(Date.now()-31*864e5).toISOString(),id);
  await internals.cronTick(ctx.env);
  assert.equal(ctx.db.prepare('SELECT status FROM companies WHERE id = ?').get(id).status,'deleted');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM records WHERE owner_id = ?').get(owner_id).n,0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE company_id = ?').get(id).n,0);
  assert.ok(ctx.db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE company_id = ?').get(id).n>=0);
  assert.equal((await owner('/api/me')).body.user,null);
  ctx.db.close();
});

test('public pricing and demo requests, consent at sign-up, rate limits and security headers',async()=>{
  const ctx=setup();
  const visitor=ctx.client('192.0.2.50');
  const plans=await visitor('/api/public/plans');
  assert.deepEqual(plans.body.plans.map(p=>p.name),['Essential','Professional','Business']);
  assert.equal((await visitor('/api/public/lead',{name:'Dana',email:'not-an-email'})).status,400);
  assert.equal((await visitor('/api/public/lead',{name:'Dana',email:'dana@example.test',company:'Oak Homes',units:'120',message:'Demo please'})).status,200);
  const admin=ctx.client();await admin('/api/auth/login',superAdmin);
  const leads=(await admin('/api/super/overview',{})).body.leads;
  assert.equal(leads[0].company,'Oak Homes');
  await admin('/api/super/lead',{id:leads[0].id,status:'contacted',notes:'Called'});
  assert.equal((await admin('/api/super/overview',{})).body.leads[0].status,'contacted');
  for(let i=0;i<4;i++)await visitor('/api/public/lead',{name:'Dana',email:'dana@example.test'});
  assert.equal((await visitor('/api/public/lead',{name:'Dana',email:'dana@example.test'})).status,429);
  assert.equal((await visitor('/api/auth/signup',{company:'No Terms',name:'N',email:'n@example.test',password:'no-terms-password'})).status,400);
  const brute=ctx.client('192.0.2.77');
  let last;
  for(let i=0;i<31;i++)last=await brute('/api/auth/login',{email:'x@example.test',password:'wrong-password'});
  assert.equal(last.status,429);
  const page=await worker.fetch(new Request(origin+'/'),ctx.env);
  assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.equal(page.headers.get('X-Frame-Options'),'DENY');
  assert.match(page.headers.get('Strict-Transport-Security'),/max-age=/);
  const owner=ctx.client('192.0.2.60');
  await owner('/api/auth/signup',{acceptTerms:true,company:'Signout Co',name:'S',email:'s@example.test',password:'signout-password'});
  assert.equal((await owner('/api/auth/signout-all',{})).status,200);
  assert.equal((await owner('/api/me')).body.user,null);
  ctx.db.close();
});
