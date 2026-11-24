import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://test.example';
const superAdmin={email:'root@hushhawk.test',password:'super-secret-password'};

function setup(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const env={HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,HUSHHAWK_SECRETS_KEY:'a-long-test-secrets-key',
    DB:{prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};}};}}};
  const client=()=>{let cookie='';return async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,body:await response.json()};
  };};
  return {db,env,client};
}
async function approvedCompany(ctx,planId='essential'){
  const owner=ctx.client(),admin=ctx.client();
  await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'morgan@harbor.test',password:'harbor-view-2026'});
  await admin('/api/auth/login',superAdmin);
  const id=(await admin('/api/super/overview',{})).body.companies[0].id;
  await admin('/api/super/company',{id,action:'approve'});
  await owner('/api/company/plan',{planId});
  const state=upgrade(seed());state.team=state.team.slice(0,1);state.properties=state.properties.slice(0,1);
  await owner('/api/workspace',{revision:0,state},'PUT');
  return {owner,admin,id,state};
}

test('provider keys are stored encrypted and only a hint is returned',async()=>{
  const ctx=setup(),{admin}=await approvedCompany(ctx);
  const saved=await admin('/api/super/providers',{anthropicKey:'sk-ant-api-test-key-9876',aiEffort:'low'});
  assert.equal(saved.body.providers.anthropicKey.hint,'••••9876');
  assert.equal(saved.body.providers.aiEffort,'low');
  const row=ctx.db.prepare('SELECT value FROM secrets WHERE key = ?').get('anthropic_api_key');
  assert.ok(row.value.startsWith('v1.')&&!row.value.includes('sk-ant'));
  assert.equal((await admin('/api/super/providers',{anthropicKey:'not-a-key'})).status,400);
  ctx.db.close();
});

test('AI drafts call the Messages API, meter usage and respect plan quotas',async()=>{
  const ctx=setup(),{owner,admin,id,state}=await approvedCompany(ctx);
  await admin('/api/super/company',{id,action:'update',planId:'essential',overrides:{ai:'on'}});
  await admin('/api/super/providers',{anthropicKey:'sk-ant-api-test-key-9876'});
  const realFetch=globalThis.fetch;let sent;
  globalThis.fetch=async(url,init)=>{sent={url,headers:init.headers,body:JSON.parse(init.body)};
    return Response.json({model:'claude-opus-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({can_answer:true,reply:'Thanks, we have logged the leak.',confidence:0.9,sources:[],reason:'Maintenance intake note'})}],usage:{input_tokens:1000,output_tokens:50}});};
  try{
    const draft=await owner('/api/ai/draft',{threadId:state.threads.find(t=>t.channel==='SMS').id});
    assert.equal(draft.status,200);
    assert.equal(draft.body.text,'Thanks, we have logged the leak.');
    assert.equal(sent.url,'https://api.anthropic.com/v1/messages');
    assert.equal(sent.headers['anthropic-version'],'2026-10-21');
    assert.equal(sent.body.model,'claude-opus-5-5');
    assert.equal(sent.body.output_config.format.type,'json_schema');
    assert.deepEqual(sent.body.output_config.format.schema.required,['can_answer','reply','confidence','sources','reason']);
    assert.equal(draft.body.canAnswer,true);
    assert.equal(draft.body.usage.ai,1);
    ctx.db.prepare("UPDATE plans SET quotas = '{\"sms\":500,\"ai\":1}' WHERE id = 'essential'").run();
    const blocked=await owner('/api/ai/draft',{threadId:state.threads[0].id});
    assert.equal(blocked.status,402);
  }finally{globalThis.fetch=realFetch;}
  ctx.db.close();
});

test('numbers, support requests and the read-only workspace view flow between company and super admin',async()=>{
  const ctx=setup(),{owner,admin,id}=await approvedCompany(ctx,'professional');
  await owner('/api/company/number-request',{areaCode:'512',note:'Austin'});
  assert.equal((await owner('/api/company/number-request',{})).status,400);
  await admin('/api/super/number',{action:'add',number:'+15125550100'});
  const assigned=await admin('/api/super/number',{action:'assign',number:'+15125550100',companyId:id});
  assert.equal(assigned.body.numbers[0].companyId,id);
  assert.equal(assigned.body.numberRequests[0].status,'done');
  const support=await owner('/api/company/support',{subject:'Help',body:'Texts are slow'});
  assert.equal(support.body.support[0].priority,'Priority');
  const sid=support.body.support[0].id;
  assert.equal((await admin('/api/super/support',{id:sid,action:'reply',body:'On it'})).body.support[0].status,'answered');
  const snapshot=await admin('/api/super/workspace',{id});
  assert.equal(snapshot.body.counts.properties,1);
  assert.equal((await owner('/api/super/workspace',{id})).status,403);
  ctx.db.close();
});
