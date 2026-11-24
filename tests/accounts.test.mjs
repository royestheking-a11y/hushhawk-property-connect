import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://test.example';
const superAdmin={email:'root@hushhawk.test',password:'super-secret-password'};

function database(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  return {db,env:{HUSHHAWK_SUPER_ADMIN_EMAIL:superAdmin.email,HUSHHAWK_SUPER_ADMIN_PASSWORD:superAdmin.password,DB:{prepare(sql){return {bind(...args){
    const statement=db.prepare(sql);
    return {first:async()=>statement.get(...args)??null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:statement.run(...args)})};
  }};}}}};
}
function client(env){
  let cookie='';
  const call=async(path,body,method=body===undefined?'GET':'POST',headers={})=>{
    const response=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const set=response.headers.get('Set-Cookie');
    if(set)cookie=set.split(';')[0].endsWith('=')?'':set.split(';')[0];
    return {status:response.status,body:await response.json(),cookie:set};
  };
  return call;
}

test('sign-up creates a pending company that cannot open a workspace or pick a plan',async()=>{
  const {db,env}=database(),owner=client(env);
  const signup=await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'Morgan@Harbor.test',password:'harbor-view-2026'});
  assert.equal(signup.status,201);
  assert.match(signup.cookie,/hh_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Secure/);
  assert.equal(signup.body.company.status,'pending');
  assert.equal(signup.body.user.email,'morgan@harbor.test');
  assert.equal((await owner('/api/workspace')).status,403);
  assert.equal((await owner('/api/company/plan',{planId:'essential'})).status,403);
  assert.equal((await owner('/api/super/overview',{})).status,403);
  assert.equal((await client(env)('/api/auth/signup',{acceptTerms:true,company:'Again',name:'M',email:'morgan@harbor.test',password:'harbor-view-2026'})).status,409);
  const row=db.prepare('SELECT password_hash FROM users WHERE email = ?').get('morgan@harbor.test');
  assert.notEqual(row.password_hash,'harbor-view-2026');
  db.close();
});

test('super admin approves, the owner picks a plan, and limits and overrides apply',async()=>{
  const {db,env}=database(),owner=client(env),admin=client(env);
  await owner('/api/auth/signup',{acceptTerms:true,company:'Harbor View',name:'Morgan',email:'morgan@harbor.test',password:'harbor-view-2026'});
  assert.equal((await admin('/api/auth/login',{email:superAdmin.email,password:'wrong'})).status,401);
  const login=await admin('/api/auth/login',superAdmin);
  assert.equal(login.body.user.role,'super_admin');
  const overview=await admin('/api/super/overview',{});
  const id=overview.body.companies[0].id;
  assert.equal((await admin('/api/super/company',{id,action:'approve'})).body.companies[0].status,'active');
  const chosen=await owner('/api/company/plan',{planId:'essential'});
  assert.equal(chosen.body.plan.name,'Essential');
  assert.equal(chosen.body.entitlements.features.ai,false);
  await admin('/api/super/company',{id,action:'update',planId:'essential',overrides:{ai:'on',bogus:'on'},notes:'VIP'});
  assert.equal((await owner('/api/me')).body.entitlements.features.ai,true);
  await admin('/api/super/settings',{aiAvailable:false});
  assert.equal((await owner('/api/me')).body.entitlements.features.ai,false);
  assert.equal(chosen.body.subscription.status,'trialing');
  const state=upgrade(seed());
  state.properties=Array.from({length:11},(_,n)=>({id:'p'+n,name:'P'+n,address:'',units:''}));
  assert.equal((await owner('/api/workspace',{revision:0,state},'PUT')).status,403);
  state.properties=state.properties.slice(0,1);
  assert.equal((await owner('/api/workspace',{revision:0,state},'PUT')).status,200);
  assert.equal((await owner('/api/workspace')).body.revision,1);
  await admin('/api/super/company',{id,action:'suspend'});
  assert.equal((await owner('/api/me')).body.user,null);
  db.close();
});

test('plans can be created and edited, and mutating requests need a same-origin JSON body',async()=>{
  const {db,env}=database(),admin=client(env);
  await admin('/api/auth/login',superAdmin);
  const created=await admin('/api/super/plan',{name:'Starter Plus',priceCents:7900,features:['inbox','ai','nope'],seats:3,properties:20,support:'Email',active:true});
  const plan=created.body.plans.find(p=>p.name==='Starter Plus');
  assert.deepEqual(plan.features,['inbox','ai']);
  const edited=await admin('/api/super/plan',{id:plan.id,name:'Starter Plus',priceCents:8900,features:['inbox'],seats:3,properties:20,active:false});
  assert.equal(edited.body.plans.find(p=>p.id===plan.id).priceCents,8900);
  assert.equal((await client(env)('/api/auth/login',superAdmin,'POST',{Origin:'https://evil.example'})).status,403);
  db.close();
});
