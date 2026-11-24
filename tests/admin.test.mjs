import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
import {seed} from '../dist/model.js';
import {upgrade} from '../dist/workspace.js';

const origin='https://test.example';
const users=['owner-a','owner-b'];
const request=(path,user,options={})=>new Request(origin+path,{...options,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...options.headers}});

test('admin page redirects unauthenticated visitors and admin API never returns demo data',async()=>{
  const page=await worker.fetch(request('/admin/'),{});
  assert.equal(page.status,302);
  assert.equal(page.headers.get('Location'),origin+'/signin-with-chatgpt?return_to=%2Fadmin%2F');
  assert.equal((await worker.fetch(request('/api/admin/workspace'),{})).status,401);
  assert.equal((await worker.fetch(request('/admin/',users[0]),{})).headers.get('Cache-Control'),'no-store');
});

test('owner records persist independently and stale or foreign writes fail',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  const statement=(sql,args)=>{const s=db.prepare(sql);return {first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};};
  const env={DB:{prepare(sql){return {bind:(...args)=>statement(sql,args)};},async batch(list){db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
  const path='/api/admin/workspace';
  const load=user=>worker.fetch(request(path,user),env);
  const write=(user,revision,state,from=origin)=>worker.fetch(request(path,user,{method:'PUT',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify({revision,state})}),env);
  const state=upgrade(seed());
  state.contacts=[];
  state.properties=[{id:'test',name:'Private test property',address:'Test Street',units:''}];
  assert.deepEqual(await (await load(users[0])).json(),{email:'owner-a@example.test',revision:0,state:null,sms:{workspaceId:'owner-a',configured:false,number:'',webhookBase:''}});
  assert.equal((await write(users[0],0,state,'https://other.example')).status,403);
  assert.equal((await write(users[0],0,state)).status,200);
  assert.equal((await write(users[0],0,state)).status,409);
  assert.equal((await (await load(users[0])).json()).state.properties[0].name,'Private test property');
  assert.equal((await (await load(users[1])).json()).state,null);
  db.close();
});
