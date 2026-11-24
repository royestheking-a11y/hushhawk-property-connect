// Workspace storage: one row per record (records), one row per message (messages),
// a revision counter per workspace (workspace_meta). Every row carries its owner.
const LIST_KEYS=['properties','contacts','threads','tickets','tasks','events','calls','approvals','rules','runs','templates','knowledge','team','audit','leads','providerEvents','scheduled'];
const META_KEYS=['settings','draft','billing','integrations'];
const NEWEST_FIRST=['audit','runs','approvals'];
const RECORD_LIMIT=200000;

async function loadState(db,owner){
  const meta=await one(db,'SELECT revision, updated_at FROM workspace_meta WHERE owner_id = ?',owner);
  if(!meta)return null;
  const rows=await all(db,'SELECT collection, id, data, rev FROM records WHERE owner_id = ? ORDER BY rowid',owner);
  const messages=await all(db,'SELECT thread_id, data FROM messages WHERE owner_id = ? ORDER BY time, rowid',owner);
  const state=Object.fromEntries([...LIST_KEYS.map(key=>[key,[]]),...META_KEYS.map(key=>[key,{}])]);
  const revs={};
  for(const row of rows){
    revs[row.collection+'/'+row.id]=row.rev;
    const data=JSON.parse(row.data);
    if(row.collection==='_meta'){if(META_KEYS.includes(row.id))state[row.id]=data;}
    else if(row.collection==='providerEvents')state.providerEvents.push(data.id);
    else if(state[row.collection])state[row.collection].push(data);
  }
  for(const key of NEWEST_FIRST)state[key].reverse();
  const byThread={};
  for(const m of messages)(byThread[m.thread_id]??=[]).push(JSON.parse(m.data));
  for(const thread of state.threads)thread.messages=byThread[thread.id]||[];
  return {state,revision:meta.revision,updatedAt:meta.updated_at,revs};
}
// Flattens a workspace into keyed records ("collection/id") for diffing.
function recordsOf(state,{skipDraft=false}={}){
  const map=new Map();
  for(const c of LIST_KEYS){
    (Array.isArray(state[c])?state[c]:[]).forEach((item,i)=>{
      if(c==='providerEvents'){map.set(c+'/'+item,{c,id:String(item),json:JSON.stringify({id:item})});return;}
      const id=String(item?.id??`${c}-${i}`);
      map.set(c+'/'+id,{c,id,json:JSON.stringify(item)});
    });
  }
  for(const key of META_KEYS)if(!(skipDraft&&key==='draft'))map.set('_meta/'+key,{c:'_meta',id:key,json:JSON.stringify(state[key]||{})});
  return map;
}
function diffRecords(before,after,revs={}){
  const changes=[],removes=[];
  for(const [key,v] of after)if(before.get(key)?.json!==v.json)changes.push({c:v.c,id:v.id,data:JSON.parse(v.json),rev:revs[key]});
  for(const [key,v] of before)if(!after.has(key))removes.push({c:v.c,id:v.id,rev:revs[key]});
  return {changes,removes};
}
const validCollection=c=>c==='_meta'||LIST_KEYS.includes(c);
async function currentRecord(db,owner,c,id){
  const row=await one(db,'SELECT rev, data FROM records WHERE owner_id = ? AND collection = ? AND id = ?',owner,c,id);
  if(!row)return null;
  const data=JSON.parse(row.data);
  if(c==='threads')data.messages=(await all(db,'SELECT data FROM messages WHERE owner_id = ? AND thread_id = ? ORDER BY time, rowid',owner,id)).map(m=>JSON.parse(m.data));
  return {rev:row.rev,data};
}
// Applies record changes. A change whose rev doesn't match the stored rev is returned as a conflict
// with the stored version, and nothing is written when any conflict is found.
async function applyChanges(db,owner,changes,removes,actor='',{checkRevs=true}={}){
  const now=acctNow(),conflicts=[],statements=[],revs={};
  for(const ch of [...changes,...removes]){
    if(!validCollection(ch.c)||typeof ch.id!=='string'||!ch.id||ch.id.length>200)acctFail('Invalid workspace change.');
  }
  const existing={};
  for(const ch of [...changes,...removes]){
    const key=ch.c+'/'+ch.id;
    const row=await one(db,'SELECT rev FROM records WHERE owner_id = ? AND collection = ? AND id = ?',owner,ch.c,ch.id);
    existing[key]=row?.rev||0;
    if(checkRevs&&ch.rev!==undefined&&ch.rev!==null&&existing[key]!==ch.rev){
      conflicts.push({c:ch.c,id:ch.id,...(await currentRecord(db,owner,ch.c,ch.id)||{rev:0,data:null})});
    }
  }
  if(conflicts.length)return {conflicts,revs:{},revision:(await one(db,'SELECT revision FROM workspace_meta WHERE owner_id = ?',owner))?.revision||0};
  for(const ch of changes){
    const key=ch.c+'/'+ch.id;
    let data=ch.data,messages=null;
    if(ch.c==='threads'&&data&&typeof data==='object'){messages=Array.isArray(data.messages)?data.messages:[];const {messages:_ignored,...rest}=data;data=rest;}
    const json=ch.c==='providerEvents'?JSON.stringify({id:ch.id}):JSON.stringify(data??{});
    if(json.length>RECORD_LIMIT)acctFail('One of the records is too large to save.',413);
    if(existing[key]){
      statements.push(env_prepare(db,'UPDATE records SET data = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE owner_id = ? AND collection = ? AND id = ?',json,now,actor,owner,ch.c,ch.id));
      revs[key]=existing[key]+1;
    }else{
      statements.push(env_prepare(db,'INSERT INTO records (owner_id,collection,id,data,rev,updated_at,updated_by) VALUES (?,?,?,?,1,?,?) ON CONFLICT(owner_id,collection,id) DO UPDATE SET data = excluded.data, rev = records.rev + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by',owner,ch.c,ch.id,json,now,actor));
      revs[key]=1;
    }
    if(messages){
      const stored=Object.fromEntries((await all(db,'SELECT id, data FROM messages WHERE owner_id = ? AND thread_id = ?',owner,ch.id)).map(m=>[m.id,m.data]));
      messages.forEach((m,i)=>{
        const id=String(m?.id??`${ch.id}-${i}`),mjson=JSON.stringify(m);
        if(mjson.length>RECORD_LIMIT)acctFail('A message is too large to save.',413);
        if(stored[id]!==mjson)statements.push(env_prepare(db,'INSERT INTO messages (owner_id,thread_id,id,data,time) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET data = excluded.data, time = excluded.time, thread_id = excluded.thread_id',owner,ch.id,id,mjson,String(m?.time||'')));
      });
    }
  }
  for(const rm of removes){
    statements.push(env_prepare(db,'DELETE FROM records WHERE owner_id = ? AND collection = ? AND id = ?',owner,rm.c,rm.id));
    if(rm.c==='threads')statements.push(env_prepare(db,'DELETE FROM messages WHERE owner_id = ? AND thread_id = ?',owner,rm.id));
    revs[rm.c+'/'+rm.id]=0;
  }
  if(statements.length){
    statements.push(env_prepare(db,'INSERT INTO workspace_meta (owner_id,revision,updated_at) VALUES (?,1,?) ON CONFLICT(owner_id) DO UPDATE SET revision = workspace_meta.revision + 1, updated_at = excluded.updated_at',owner,now));
    await runBatch(db,statements);
  }
  const revision=(await one(db,'SELECT revision FROM workspace_meta WHERE owner_id = ?',owner))?.revision||0;
  return {conflicts:[],revs,revision};
}
const env_prepare=(db,sql,...args)=>db.prepare(sql).bind(...args);
// D1 batches run in one transaction; fall back to sequential runs where batch isn't available.
async function runBatch(db,statements){
  if(typeof db.batch==='function'){
    for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
  }else for(const s of statements)await s.run();
}
async function createWorkspace(db,owner,state,actor=''){
  if(await one(db,'SELECT owner_id FROM workspace_meta WHERE owner_id = ?',owner))return false;
  const {changes}=diffRecords(new Map(),recordsOf(state));
  await applyChanges(db,owner,changes,[],actor,{checkRevs:false});
  return true;
}
// Loads the workspace, runs an operation on it, and writes back only what changed.
// Retries on conflicting concurrent writes.
async function withState(env,owner,operation,actor='Automation'){
  for(let attempt=0;attempt<5;attempt++){
    const loaded=await loadState(env.DB,owner);
    if(!loaded)throw new Error('Save your workspace settings before enabling live SMS.');
    const before=recordsOf(loaded.state);
    const outcome=operation(loaded.state);
    if(!outcome?.changed)return outcome?.value;
    const {changes,removes}=diffRecords(before,recordsOf(loaded.state),loaded.revs);
    const result=await applyChanges(env.DB,owner,changes,removes,actor);
    if(!result.conflicts.length)return outcome.value;
  }
  throw new Error('Workspace is busy. Retry shortly.');
}
const updateSmsWorkspace=(env,owner,operation)=>withState(env,owner,operation);
// Replaces a whole workspace (older clients send full snapshots); keeps the revision check.
async function replaceState(db,owner,state,revision,actor){
  const loaded=await loadState(db,owner);
  if(revision===0?Boolean(loaded):(!loaded||loaded.revision!==revision))return null;
  const before=loaded?recordsOf(loaded.state):new Map();
  const {changes,removes}=diffRecords(before,recordsOf(state),loaded?.revs||{});
  const result=await applyChanges(db,owner,changes,removes,actor,{checkRevs:false});
  return result.revision||(loaded?.revision??0);
}
async function countRecords(db,owner,collection){
  return (await one(db,'SELECT COUNT(*) AS n FROM records WHERE owner_id = ? AND collection = ?',owner,collection)).n;
}
// HTTP: GET workspace, POST changes, PUT full snapshot (compatibility).
async function workspaceRoute(request,env,url,owner,{actor,email,limits=null,extra={},canWrite:allowed=null}={}){
  const db=env.DB;
  if(request.method==='GET'){
    const loaded=await loadState(db,owner);
    return json({email,revision:loaded?.revision??0,state:loaded?.state??null,...(loaded?{revs:loaded.revs}:{}),...extra});
  }
  if(request.method==='POST'&&url.pathname.endsWith('/changes')){
    const input=await readJson(request,url,2500000);
    const changes=Array.isArray(input.changes)?input.changes:[],removes=Array.isArray(input.removes)?input.removes:[];
    if(changes.length+removes.length>2000)acctFail('Too many changes at once.',413);
    const blocked=allowed&&[...changes,...removes].find(ch=>!allowed(ch.c));
    if(blocked)acctFail(`Your role can’t change ${blocked.c==='_meta'?'workspace settings':blocked.c}. Ask an admin.`,403);
    if(limits?.properties){
      const added=[];
      for(const ch of changes.filter(ch=>ch.c==='properties'))if(!await one(db,'SELECT id FROM records WHERE owner_id = ? AND collection = ? AND id = ?',owner,'properties',ch.id))added.push(ch.id);
      const removed=removes.filter(r=>r.c==='properties').length;
      if((await countRecords(db,owner,'properties'))+added.length-removed>limits.properties)
        acctFail(`Your ${limits.planName} plan includes ${limits.properties} properties. Upgrade to add more.`,403);
    }
    return json(await applyChanges(db,owner,changes,removes,actor));
  }
  if(request.method!=='PUT')acctFail('Method unavailable.',405);
  if(allowed&&!allowed('_meta'))acctFail('Your role can’t replace the workspace.',403);
  const input=await readJson(request,url,2500000);
  if(!validState(input.state)||!Number.isSafeInteger(input.revision)||input.revision<0)acctFail('Invalid workspace state.');
  if(limits?.properties&&input.state.properties.length>limits.properties)acctFail(`Your ${limits.planName} plan includes ${limits.properties} properties. Upgrade to add more.`,403);
  const revision=await replaceState(db,owner,input.state,input.revision,actor);
  if(revision===null)acctFail('The workspace changed in another session. Reload before continuing.',409);
  return json({revision});
}
