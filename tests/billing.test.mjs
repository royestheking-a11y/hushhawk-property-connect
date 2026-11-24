import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';

const origin='https://test.example';
const superAdmin={email:'root@hushhawk.test',password:'super-secret-password'};

function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const env={HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,HUSHHAWK_SECRETS_KEY:'a-long-test-secrets-key',
    DB:{prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};}};}}};
  const client=()=>{let cookie='';const call=async(path,body,method=body===undefined?'GET':'POST',headers={})=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)}),env);
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0].endsWith('=')?'':set.split(';')[0];
    const type=response.headers.get('Content-Type')||'';
    return {status:response.status,body:type.includes('json')?await response.json():await response.text()};
  };return call;};
  const sql=(query,...args)=>db.prepare(query).run(...args);
  return {db,env,client,sql};
}
async function company(ctx,{trial=true}={}){
  if(!trial)ctx.sql('UPDATE plans SET trial_days = 0');
  const owner=ctx.client(),admin=ctx.client();
  await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'morgan@harbor.test',password:'harbor-view-2026'});
  await admin('/api/auth/login',superAdmin);
  const id=(await admin('/api/super/overview',{})).body.companies[0].id;
  await admin('/api/super/company',{id,action:'approve'});
  return {owner,admin,id};
}
const daysAgo=n=>new Date(Date.now()-n*864e5).toISOString();
const daysAhead=n=>new Date(Date.now()+n*864e5).toISOString();

test('a trial opens the workspace and ends with an invoice, past-due grace and then paused access',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx);
  const trial=await owner('/api/company/plan',{planId:'professional'});
  assert.equal(trial.body.result,'trial');
  assert.equal(trial.body.access,true);
  assert.equal((await owner('/api/workspace')).status,200);
  ctx.sql('UPDATE companies SET period_end = ? WHERE id = ?',daysAgo(1),id);
  const ended=(await owner('/api/me')).body;
  assert.equal(ended.subscription.status,'past_due');
  assert.equal(ended.access,true);
  assert.equal(ended.openInvoices.length,1);
  assert.equal(ended.openInvoices[0].kind,'renewal');
  assert.equal(ended.openInvoices[0].totalCents,12900);
  ctx.sql('UPDATE companies SET period_end = ? WHERE id = ?',daysAgo(8),id);
  ctx.sql('UPDATE invoices SET period = ? WHERE company_id = ?',daysAgo(8),id);
  const paused=(await owner('/api/me')).body;
  assert.equal(paused.subscription.status,'unpaid');
  assert.equal(paused.access,false);
  assert.equal((await owner('/api/workspace')).status,402);
  const invoiceId=paused.openInvoices[0].id;
  await admin('/api/super/subscription',{companyId:id,action:'mark-paid',invoiceId,method:'bank_transfer',reference:'TRX-1'});
  const paid=(await owner('/api/me')).body;
  assert.equal(paid.subscription.status,'active');
  assert.equal(paid.access,true);
  assert.equal((await admin('/api/super/overview',{})).body.payments[0].reference,'TRX-1');
  ctx.db.close();
});

test('without a trial the plan needs payment first, then upgrades bill the difference and downgrades wait',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx,{trial:false});
  const chosen=await owner('/api/company/plan',{planId:'essential'});
  assert.equal(chosen.body.result,'payment');
  assert.equal(chosen.body.access,false);
  assert.equal((await owner('/api/workspace')).status,402);
  assert.equal(chosen.body.openInvoices[0].totalCents,4900);
  assert.match(chosen.body.openInvoices[0].number,/^HH-\d{4}-0001$/);
  await admin('/api/super/subscription',{companyId:id,action:'mark-paid',invoiceId:chosen.body.invoiceId,method:'bank_transfer'});
  assert.equal((await owner('/api/me')).body.subscription.status,'active');
  const upgraded=await owner('/api/company/plan',{planId:'professional'});
  assert.equal(upgraded.body.result,'upgraded');
  assert.equal(upgraded.body.plan.id,'professional');
  const upgradeInvoice=upgraded.body.openInvoices.find(i=>i.kind==='upgrade');
  assert.ok(upgradeInvoice.totalCents>7900&&upgradeInvoice.totalCents<=8000);
  const down=await owner('/api/company/plan',{planId:'essential'});
  assert.equal(down.body.result,'scheduled');
  assert.equal(down.body.plan.id,'professional');
  assert.equal(down.body.pendingPlan.id,'essential');
  ctx.sql('UPDATE companies SET period_end = ? WHERE id = ?',daysAhead(3),id);
  const renewal=(await owner('/api/me')).body.openInvoices.find(i=>i.kind==='renewal');
  assert.equal(renewal.planName,'Essential');
  await admin('/api/super/subscription',{companyId:id,action:'mark-paid',invoiceId:renewal.id,method:'card'});
  const renewed=(await owner('/api/me')).body;
  assert.equal(renewed.plan.id,'essential');
  assert.equal(renewed.pendingPlan,null);
  ctx.db.close();
});

test('canceling keeps access to the end of the period, then the subscription ends',async()=>{
  const ctx=setup(),{owner,id}=await company(ctx);
  await owner('/api/company/plan',{planId:'essential'});
  assert.equal((await owner('/api/company/subscription',{action:'cancel'})).body.subscription.cancelAtPeriodEnd,true);
  assert.equal((await owner('/api/me')).body.access,true);
  ctx.sql('UPDATE companies SET period_end = ? WHERE id = ?',daysAgo(1),id);
  const ended=(await owner('/api/me')).body;
  assert.equal(ended.subscription.status,'canceled');
  assert.equal(ended.access,false);
  assert.equal(ended.openInvoices.length,0);
  const again=await owner('/api/company/plan',{planId:'essential'});
  assert.equal(again.body.result,'payment');
  ctx.db.close();
});

test('team invites respect seats, members sign in with their own role, and resets work once',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx);
  await owner('/api/company/plan',{planId:'essential'});
  const invite=await owner('/api/company/invite',{email:'jo@harbor.test',role:'agent'});
  assert.equal(invite.status,200);
  assert.equal((await owner('/api/company/invite',{email:'sam@harbor.test',role:'agent'})).status,402);
  const token=invite.body.link.split('#invite/')[1];
  const member=ctx.client();
  assert.equal((await member('/api/auth/invite?token='+token)).body.company,'Harbor View');
  const joined=await member('/api/auth/accept-invite',{acceptTerms:true,token,name:'Jo Rivera',password:'jo-password-123'});
  assert.equal(joined.status,201);
  assert.equal(joined.body.user.role,'agent');
  assert.equal((await member('/api/auth/accept-invite',{acceptTerms:true,token,name:'Again',password:'jo-password-123'})).status,410);
  assert.equal((await member('/api/workspace')).status,200);
  assert.equal((await member('/api/company/plan',{planId:'business'})).status,403);
  assert.equal((await member('/api/company/invite',{email:'x@harbor.test'})).status,403);
  const memberId=joined.body.user.id;
  const reset=await owner('/api/company/member',{id:memberId,action:'reset-link'});
  const resetToken=reset.body.link.split('#reset/')[1];
  const stranger=ctx.client();
  assert.equal((await stranger('/api/auth/reset?token='+resetToken)).body.email,'jo@harbor.test');
  assert.equal((await stranger('/api/auth/reset',{token:resetToken,password:'brand-new-password'})).status,200);
  assert.equal((await stranger('/api/auth/reset',{token:resetToken,password:'brand-new-password'})).status,410);
  assert.equal((await member('/api/me')).body.user,null);
  assert.equal((await ctx.client()('/api/auth/login',{email:'jo@harbor.test',password:'brand-new-password'})).status,200);
  await admin('/api/super/subscription',{companyId:id,action:'user',userId:memberId,op:'disable'});
  assert.equal((await ctx.client()('/api/auth/login',{email:'jo@harbor.test',password:'brand-new-password'})).status,403);
  assert.equal((await owner('/api/auth/change-password',{current:'wrong',next:'another-password-1'})).status,400);
  assert.equal((await owner('/api/auth/change-password',{current:'harbor-view-2026',next:'another-password-1'})).status,200);
  ctx.db.close();
});

test('profile edits are saved and super admin sees them; manual activation and extension work',async()=>{
  const ctx=setup(),{owner,admin,id}=await company(ctx,{trial:false});
  const saved=await owner('/api/company/profile',{name:'Harbor View Rentals',phone:'+1 512 555 0100',city:'Austin',units:'120',billingEmail:'ap@harbor.test'});
  assert.equal(saved.body.company.name,'Harbor View Rentals');
  assert.equal((await owner('/api/company/profile',{name:'Harbor',units:'lots'})).status,400);
  const overview=(await admin('/api/super/overview',{})).body;
  assert.equal(overview.companies[0].profile.city,'Austin');
  await admin('/api/super/subscription',{companyId:id,action:'activate',planId:'business',months:3,reason:'Pilot'});
  const me=(await owner('/api/me')).body;
  assert.equal(me.plan.id,'business');
  assert.equal(me.access,true);
  const before=me.subscription.periodEnd;
  await admin('/api/super/subscription',{companyId:id,action:'extend',days:10});
  assert.ok((await owner('/api/me')).body.subscription.periodEnd>before);
  ctx.db.close();
});

test('Stripe webhooks mark invoices paid only with a valid signature',async()=>{
  const ctx=setup(),{owner,admin}=await company(ctx,{trial:false});
  const invoiceId=(await owner('/api/company/plan',{planId:'essential'})).body.invoiceId;
  await admin('/api/super/billing-settings',{stripeKey:'sk_test_abc123',stripeWebhookSecret:'whsec_test123'});
  const payload=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_test_1',payment_status:'paid',payment_intent:'pi_1',metadata:{invoice_id:invoiceId}}}});
  const t=Math.floor(Date.now()/1000);
  const sig=createHmac('sha256','whsec_test123').update(`${t}.${payload}`).digest('hex');
  const hook=ctx.client();
  assert.equal((await hook('/api/stripe/webhook',payload,'POST',{'Stripe-Signature':`t=${t},v1=${'0'.repeat(64)}`})).status,400);
  assert.equal((await owner('/api/me')).body.access,false);
  assert.equal((await hook('/api/stripe/webhook',payload,'POST',{'Stripe-Signature':`t=${t},v1=${sig}`})).status,200);
  const me=(await owner('/api/me')).body;
  assert.equal(me.access,true);
  assert.equal(me.subscription.status,'active');
  ctx.db.close();
});
