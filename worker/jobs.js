// Background jobs: inbound texts and scheduled sends run here, with retries and backoff.
// Webhooks only verify and enqueue; work runs via ctx.waitUntil and the cron trigger.
const MAX_ATTEMPTS=5;
async function enqueue(db,{owner,kind,payload,dedupe=null,runAt=acctNow()}){
  const result=await exec(db,'INSERT OR IGNORE INTO jobs (id,owner_id,kind,dedupe,payload,status,run_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
    acctId(),owner,kind,dedupe,JSON.stringify(payload),'queued',runAt,acctNow());
  return result.meta.changes===1;
}
async function runJobs(env,{limit=25}={}){
  const db=env.DB;
  await exec(db,"UPDATE jobs SET status = 'queued' WHERE status = 'running' AND run_at < ?",new Date(Date.now()-10*60e3).toISOString());
  const due=await all(db,"SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT ?",acctNow(),limit);
  let done=0;
  for(const job of due){
    const claim=await exec(db,"UPDATE jobs SET status = 'running', attempts = attempts + 1, run_at = ? WHERE id = ? AND status = 'queued'",acctNow(),job.id);
    if(claim.meta.changes!==1)continue;
    try{
      const handler=JOB_HANDLERS[job.kind];
      if(!handler)throw new Error('Unknown job type '+job.kind);
      await handler(env,JSON.parse(job.payload),job);
      await exec(db,"UPDATE jobs SET status = 'done', finished_at = ?, last_error = '' WHERE id = ?",acctNow(),job.id);
      done++;
    }catch(error){
      const attempts=job.attempts+1,failed=attempts>=MAX_ATTEMPTS;
      await exec(db,'UPDATE jobs SET status = ?, run_at = ?, last_error = ?, finished_at = ? WHERE id = ?',failed?'failed':'queued',
        new Date(Date.now()+Math.min(3600e3,15e3*2**attempts)).toISOString(),String(error?.message||error).slice(0,300),failed?acctNow():null,job.id);
    }
  }
  return done;
}
// Which provider configuration sends for a workspace: a company's platform number, or the single-owner setup.
async function sendingRoute(env,owner){
  if(owner.startsWith('company:')){
    const companyId=owner.slice(8),platform=await platformSms(env),number=await companyNumber(env.DB,companyId);
    return platform&&number?{config:{...platform,number,companyId},companyId}:{config:null,companyId};
  }
  const legacy=smsConfig(env);
  return {config:legacy?.owner===owner?legacy:null,companyId:''};
}
async function deliverOutbound(env,owner,route,{to,body,id,channel='SMS',subject='',threadId='',from=''}){
  let outcome;
  if(channel==='Email'){
    const cfg=await emailConfig(env).catch(()=>null);
    const company=route.companyId&&await one(env.DB,'SELECT name FROM companies WHERE id = ?',route.companyId);
    outcome=cfg&&company?await sendThreadEmail(env,cfg,route.companyId,company.name,{to,subject,threadId,id,body}):{status:'failed',errorCode:'not-configured'};
    outcome={...outcome,sid:outcome.id};
  }else{
    const config=route.config&&from?{...route.config,number:from}:route.config;
    outcome=config?await twilioSend(config,to,body,id):{status:'failed',errorCode:'not-configured'};
  }
  await updateSmsWorkspace(env,owner,state=>({changed:recordSmsDelivery(state,id,outcome.status,outcome.sid,outcome.errorCode)}));
  if(route.companyId){
    const s=await settingsMap(env.DB);
    if(channel==='Email')await meter(env.DB,route.companyId,'email_out',{status:outcome.status==='failed'?'error':'ok',detail:outcome.errorCode||outcome.status});
    else{const segments=smsSegments(body);await meter(env.DB,route.companyId,'sms_out',{quantity:segments,status:outcome.status==='failed'?'error':'ok',cost:Number(s.cost_sms_micros||0)*segments,detail:outcome.errorCode||outcome.status});}
  }
  return outcome;
}
// A company may own several numbers: reply from the one the tenant texted when it still belongs to them.
async function replyNumber(env,route,via){
  if(!via||!route.companyId)return '';
  return (await one(env.DB,'SELECT number FROM phone_numbers WHERE number = ? AND company_id = ?',via,route.companyId))?.number||'';
}
// AI follow-up after intake: an automatic answer or a drafted reply for approval. If an acknowledgment
// was held back for the AI and the AI didn't answer, send the acknowledgment now.
async function afterIntake(env,owner,route,result,{channel,to,from='',subject='',sourceId}){
  let followUp=null;
  try{followUp=await aiFollowUp(env,owner,result.threadId,{route,channel});}catch(error){console.error('AI follow-up failed',error);}
  if(!result.pendingAck||followUp?.auto)return;
  const ack=await updateSmsWorkspace(env,owner,state=>{
    const thread=state.threads.find(t=>t.id===result.threadId);
    if(!thread)return {changed:false};
    const message=queueAcknowledgment(thread,result.pendingAck);
    message.sourceSid=sourceId;
    return {changed:true,value:{id:message.id,body:message.body}};
  });
  if(ack)await deliverOutbound(env,owner,route,{...ack,to,from,channel,subject,threadId:result.threadId});
}
const JOB_HANDLERS={
  async 'sms.inbound'(env,p,job){
    const owner=job.owner_id,route=await sendingRoute(env,owner);
    const seen=await one(env.DB,"SELECT id FROM records WHERE owner_id = ? AND collection = 'providerEvents' AND id = ?",owner,p.sid);
    const mediaConfig=route.config||await platformSms(env)||smsConfig(env);
    const attachments=!seen&&p.mediaItems?.length&&mediaConfig?await fetchTwilioMedia(env,owner,mediaConfig,p.mediaItems):[];
    const insight=seen?null:await classifyInbound(env,owner,{text:p.body||'',channel:'SMS'});
    const result=await updateSmsWorkspace(env,owner,state=>{
      const outcome=applyInboundSms(state,{sid:p.sid,from:p.from,to:p.to,body:p.body,media:p.media,opt:p.opt,attachments,segments:p.segments,ai:insight?.ai,deferAck:insight?.defer});
      if(outcome)return {changed:true,value:{threadId:outcome.thread.id,pendingAck:outcome.pendingAck,reply:outcome.reply?{id:outcome.reply.id,body:outcome.reply.body,to:p.from}:null}};
      // Retried after the workspace was updated: find the acknowledgment that still needs sending.
      for(const thread of state.threads){
        const pending=thread.messages.find(m=>m.sourceSid===p.sid&&m.kind==='out'&&m.delivery==='queued');
        if(pending)return {changed:false,value:{retry:true,reply:{id:pending.id,body:pending.body,to:p.from}}};
      }
      return {changed:false,value:{retry:true}};
    });
    if(route.companyId&&!seen){
      const s=await settingsMap(env.DB),segments=Math.max(1,Number(p.segments)||smsSegments(p.body));
      await meter(env.DB,route.companyId,'sms_in',{quantity:segments,cost:Number(s.cost_sms_micros||0)*segments});
    }
    const from=await replyNumber(env,route,p.to);
    if(result?.reply)await deliverOutbound(env,owner,route,{...result.reply,from});
    if(result?.threadId)await afterIntake(env,owner,route,result,{channel:'SMS',to:p.from,from,sourceId:p.sid});
  },
  async 'email.inbound'(env,p,job){
    const owner=job.owner_id,companyId=owner.slice(8),route={config:null,companyId};
    const seen=await one(env.DB,"SELECT id FROM records WHERE owner_id = ? AND collection = 'providerEvents' AND id = ?",owner,'email:'+p.messageId);
    const insight=seen?null:await classifyInbound(env,owner,{text:`${p.subject}\n${p.text}`,channel:'Email'});
    const result=await updateSmsWorkspace(env,owner,state=>{
      const outcome=applyInboundEmail(state,{...p,ai:insight?.ai,deferAck:insight?.defer});
      if(outcome)return {changed:true,value:{threadId:outcome.thread.id,subject:outcome.thread.subject,pendingAck:outcome.pendingAck,reply:outcome.reply?{id:outcome.reply.id,body:outcome.reply.body,to:p.from,subject:outcome.thread.subject,threadId:outcome.thread.id}:null}};
      for(const thread of state.threads){
        const pending=thread.messages.find(m=>m.sourceSid==='email:'+p.messageId&&m.kind==='out'&&m.delivery==='queued');
        if(pending)return {changed:false,value:{retry:true,reply:{id:pending.id,body:pending.body,to:p.from,subject:thread.subject,threadId:thread.id}}};
      }
      return {changed:false,value:{retry:true}};
    });
    if(!seen)await meter(env.DB,companyId,'email_in',{});
    if(result?.reply)await deliverOutbound(env,owner,route,{...result.reply,channel:'Email'});
    if(result?.threadId)await afterIntake(env,owner,route,result,{channel:'Email',to:p.from,subject:result.subject,sourceId:'email:'+p.messageId});
  },
  async 'scheduled.run'(env,p,job){
    const owner=job.owner_id,route=await sendingRoute(env,owner),sends=[];
    const emailReady=Boolean(route.companyId&&(await companyEmailStatus(env,route.companyId)).configured);
    await updateSmsWorkspace(env,owner,state=>{
      sends.length=0;
      const processed=runDueJobs(state,(thread,body)=>{
        const contact=state.contacts.find(c=>c.id===thread.contact);
        if(thread.channel==='Email'){
          if(!emailReady)throw new Error('Email isn’t set up for this workspace yet.');
          if(!contact||contact.optout||contact.emailBounced||!emailPattern.test(String(contact.email||'')))throw new Error('This contact can’t receive email.');
        }else if(thread.channel==='SMS'){
          if(!contact||contact.optout||!phonePattern.test(contact.phone||''))throw new Error('This contact can’t receive texts.');
          if(!route.config)throw new Error('Texting isn’t set up for this workspace.');
        }else throw new Error('Only texts and emails can be sent automatically.');
        const message={id:uid(),kind:'out',actor:'Scheduled',body,time:now(),delivery:'queued'};
        thread.messages.push(message);thread.updated=now();
        sends.push({id:message.id,body,channel:thread.channel,to:thread.channel==='Email'?contact.email:contact.phone,subject:thread.subject,threadId:thread.id,via:thread.via});
      });
      return {changed:processed.length>0};
    });
    for(const send of sends)await deliverOutbound(env,owner,route,{...send,from:send.channel==='SMS'?await replyNumber(env,route,send.via):''});
  }
};
// Cron: advance billing, queue scheduled sends that are due, and run queued jobs.
async function cronTick(env){
  try{await syncAll(env);}catch(error){console.error('billing sync failed',error);}
  try{await applyRetentionAndDeletion(env);}catch(error){console.error('retention failed',error);}
  try{
    const owners=await all(env.DB,"SELECT DISTINCT owner_id FROM records WHERE collection = 'scheduled' AND json_extract(data,'$.status') = 'Scheduled' AND json_extract(data,'$.date') <= ?",acctNow());
    const minute=acctNow().slice(0,16);
    for(const row of owners)await enqueue(env.DB,{owner:row.owner_id,kind:'scheduled.run',payload:{},dedupe:`scheduled:${row.owner_id}:${minute}`});
  }catch(error){console.error('scheduling failed',error);}
  return runJobs(env);
}
