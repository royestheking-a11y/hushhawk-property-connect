const phonePattern=/^\+[1-9]\d{7,14}$/;
const messageSidPattern=/^(SM|MM)[a-f0-9]{32}$/i;
const resultStatuses=['accepted','queued','sending','sent','delivered','failed','undelivered'];
const terminalStatuses=['delivered','failed','undelivered'];

function smsConfig(env){
  if(!env.HUSHHAWK_SMS_OWNER_ID||!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')||
    !env.TWILIO_AUTH_TOKEN||!phonePattern.test(env.TWILIO_NUMBER||'')||!env.TWILIO_WEBHOOK_BASE)return null;
  try {
    const url=new URL(env.TWILIO_WEBHOOK_BASE);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
    return {owner:env.HUSHHAWK_SMS_OWNER_ID,account:env.TWILIO_ACCOUNT_SID,token:env.TWILIO_AUTH_TOKEN,number:env.TWILIO_NUMBER,base:url.origin};
  }catch{return null;}
}
function smsConnection(env,userId){
  const config=smsConfig(env);
  return {workspaceId:userId,configured:config?.owner===userId,number:config?.owner===userId?config.number:'',webhookBase:config?.owner===userId?config.base:''};
}
async function verifiedForm(request,config,url){
  if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return null;
  const signature=request.headers.get('X-Twilio-Signature')||'';
  if(!/^[A-Za-z0-9+/]{27}=$/.test(signature))return null;
  const raw=await request.text();
  if(raw.length>32000)return null;
  const fields=new URLSearchParams(raw);
  const keys=[...new Set(fields.keys())].sort();
  if(keys.some(key=>fields.getAll(key).length!==1))return null;
  const payload=config.base+url.pathname+url.search+keys.map(key=>key+fields.get(key)).join('');
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(config.token),{name:'HMAC',hash:'SHA-1'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),letter=>letter.charCodeAt(0)),encoder.encode(payload));
  return valid?fields:null;
}

function smsIntent(text,media){
  if(/\b(gas (leak|smell)|smell\w* (of )?gas|fire|smoke|sparks?|flood\w*|burst pipe|carbon monoxide|immediate danger)\b/i.test(text))return 'Emergency';
  if(media)return 'Media review';
  if(/\b(leak\w*|clog\w*|broken|repair|maintenance|hvac|mold|mould|plumb\w*|no heat|no water|water heater|not working|air condition\w*)\b/i.test(text))return 'Maintenance';
  if(/\b(rent|lease|deposit|evict\w*|payment|balance|access|lockout|fee|complaint)\b/i.test(text))return 'Staff review';
  return 'General';
}
const smsTime=()=>new Date().toISOString();
const smsId=()=>crypto.randomUUID();
const smsAudit=(state,activity,actor='SMS automation')=>state.audit.unshift({id:smsId(),activity,actor,date:smsTime()});
function linkedSmsThread(state,number){
  const contact=state.contacts.find(person=>person.phone===number||
    (typeof person.phone==='string'&&person.phone.startsWith('+')&&person.phone.replace(/[^+\d]/g,'')===number));
  if(contact){
    contact.phone=number;
    const thread=state.threads.find(row=>row.contact===contact.id&&row.channel==='SMS');
    if(thread)return {thread,contact};
  }
  const recipient=contact||{id:smsId(),name:number,type:'Other',email:'',phone:number,property:'',unit:'',optout:false,verified:false};
  if(!contact)state.contacts.push(recipient);
  const thread={id:smsId(),contact:recipient.id,subject:'Tenant text messages',channel:'SMS',priority:'Normal',status:'Open',assigned:'',unread:true,updated:smsTime(),labels:[],followUp:'',automationPaused:false,messages:[]};
  state.threads.push(thread);
  return {thread,contact:recipient};
}
function reviewTask(state,thread,kind,title){
  const existing=state.tasks.find(item=>item.thread===thread.id&&item.kind===kind&&item.status==='Open');
  if(!existing)state.tasks.push({id:smsId(),thread:thread.id,kind,title,assigned:thread.assigned,due:smsTime().slice(0,10),status:'Open'});
}
function queueAcknowledgment(thread,body,actor='Automation'){
  const message={id:smsId(),kind:'out',actor,body,time:smsTime(),delivery:'queued'};
  thread.messages.push(message);
  return message;
}
function applyInboundSms(state,event){
  if(state.providerEvents.includes(event.sid))return null;
  const {thread,contact}=linkedSmsThread(state,event.from);
  const message={id:smsId(),kind:'in',body:event.body||(event.attachments?.length?'Sent a photo or file.':'Media-only message received. Review in the provider console.'),time:smsTime(),source:'Twilio',providerSid:event.sid,mediaCount:event.media,...(event.attachments?.length?{attachments:event.attachments}:{}),...(event.segments?{segments:event.segments}:{})};
  if(event.to)thread.via=event.to;
  state.providerEvents.push(event.sid);
  thread.messages.push(message);
  thread.updated=message.time;
  thread.unread=true;
  thread.status='Open';
  const keyword=event.opt||event.body.trim().toUpperCase();
  if(/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/.test(keyword)){
    contact.optout=true;smsAudit(state,'SMS opt-out recorded');return {thread};
  }
  if(/^(START|UNSTOP|YES)$/.test(event.opt||'')||/^(START|UNSTOP)$/.test(keyword)){
    contact.optout=false;smsAudit(state,'SMS opt-in recorded');return {thread};
  }
  if(keyword==='HELP'){smsAudit(state,'SMS help keyword received');return {thread};}
  const {reply,pendingAck}=runIntake(state,{thread,contact,message,text:event.body||'',media:event.media,channel:'SMS',acknowledge:state.settings.liveSmsReplies,sourceId:event.sid,ai:event.ai,deferAck:event.deferAck});
  return {thread,reply,pendingAck};
}

// Shared intake for any inbound message: categorize, ticket and review task, company rules,
// then an optional acknowledgment (queued; sent by the job that processes the message).
function runIntake(state,{thread,contact,message,text,media=0,channel,acknowledge,sourceId,ai=null,deferAck=false}){
  const label=channel==='Email'?'email':'SMS';
  let category=smsIntent(text,media);
  // AI classification, when confident, can raise a vague message to maintenance or emergency (never lower it).
  const confident=ai&&ai.confidence>=0.6;
  if(confident){
    message.ai={category:ai.category,urgency:ai.urgency,sentiment:ai.sentiment,language:ai.language,summary:ai.summary,confidence:ai.confidence};
    if(category!=='Emergency'&&ai.urgency==='emergency'&&ai.confidence>=0.7)category='Emergency';
    else if(!['Emergency','Maintenance'].includes(category)&&ai.category==='Maintenance')category='Maintenance';
    if(ai.sentiment==='angry'||ai.sentiment==='frustrated')thread.labels=[...new Set([...(thread.labels||[]),'Upset tenant'])];
  }
  thread.category=category;
  thread.labels=[...new Set([...(thread.labels||[]),category])];
  if(category==='Emergency')thread.priority='Emergency';
  // Built-in intake always runs (safety escalation, ticket with repeat-report tracking, review task).
  // Company automation rules then add their own actions for the message's category.
  const ruleCategory=confident?ai.category:classify(text,channel);
  const useRules=!state.settings.automationPaused&&!thread.automationPaused&&state.rules.some(rule=>rule.enabled&&rule.trigger===ruleCategory);
  if(category==='Emergency'||category==='Maintenance'){
    const open=state.tickets.find(ticket=>ticket.thread===thread.id&&ticket.sourceMessage&&
      !['Resolved','Closed'].includes(ticket.status)&&
      (ticket.category===category||ticket.priority==='Emergency')&&
      ticket.description.trim().toLowerCase()===message.body.trim().toLowerCase());
    if(open){open.lastReported=message.time;open.reportCount=(open.reportCount||1)+1;}
    else state.tickets.push({id:smsId(),title:category==='Emergency'?`Urgent ${label} report`:`Maintenance request by ${label}`,thread:thread.id,contact:contact.id,property:contact.property||'',priority:category==='Emergency'?'Emergency':'Normal',status:'New',description:message.body,assigned:thread.assigned,date:message.time,sourceMessage:message.id,category,reportCount:1});
  }
  const taskLabel=category==='Emergency'?`URGENT · review tenant ${label}`:category==='Maintenance'?'Triage maintenance request':`Review tenant ${label}`;
  reviewTask(state,thread,category==='Emergency'?`Emergency ${label}`:`Inbound ${label}`,taskLabel);
  if(useRules)runRules(state,thread,ruleCategory);
  const suppress=!acknowledge||contact.optout||state.settings.automationPaused||thread.automationPaused;
  const recentReply=thread.messages.some(item=>item.kind==='out'&&item.actor==='Automation'&&Date.now()-Date.parse(item.time)<10*60*1000);
  // Emergencies are always acknowledged now; routine acknowledgments can wait for the AI's answer.
  const queue=body=>deferAck&&category!=='Emergency'?(pendingAck=body,null):queueAcknowledgment(thread,body);
  let reply,pendingAck=null;
  if(!suppress&&category==='Emergency'){
    reply=queue(`We received your urgent message and flagged it for staff. If anyone is in immediate danger, call your local emergency services now. Do not wait for a reply to this ${channel==='Email'?'email':'text'}.`);
  }else if(!suppress&&!recentReply&&category==='Maintenance'){
    reply=queue(contact.verified&&contact.property
      ?'Thanks for reporting this. We logged a maintenance request for staff to review. If you can do so safely, please tell us when the issue started and whether it is still happening.'
      :'Thanks for reporting this. We logged your message for maintenance review. Please share your property address and unit number so staff can route it.');
  }else if(!suppress&&!recentReply){
    reply=queue('Thanks for contacting the property team. We received your message and flagged it for staff review.');
  }
  if(reply)reply.sourceSid=sourceId;
  smsAudit(state,`Incoming ${label} · ${category}${useRules?' · rules applied':''}${reply?' · acknowledgment queued':''}`);
  state.runs.unshift({id:smsId(),name:`Live ${label} intake`,thread:thread.id,result:reply?'Acknowledgment queued · staff review open':'Staff review open',date:message.time});
  return {reply,category,pendingAck};
}

function xml(value){return value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));}
function smsResponse(content=''){return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});}
function callbackUrl(config,id){return config.base+'/api/sms/status?id='+id+(config.companyId?'&c='+config.companyId:'');}
function recordSmsDelivery(state,id,status,sid,errorCode){
  for(const thread of state.threads){
    const message=thread.messages.find(item=>item.id===id&&item.kind==='out');
    if(!message)continue;
    if(message.providerSid&&sid&&message.providerSid!==sid)return false;
    if(terminalStatuses.includes(message.delivery)||!status)return false;
    const order=['submitting','accepted','queued','sending','sent'];
    if(order.includes(status)&&order.indexOf(status)<order.indexOf(message.delivery))return false;
    if(status===message.delivery&&sid===message.providerSid)return false;
    Object.assign(message,{delivery:status,providerSid:sid||message.providerSid,providerError:errorCode||undefined});
    if(['failed','undelivered','uncertain'].includes(status)){
      thread.unread=true;
      reviewTask(state,thread,'SMS delivery issue','Review failed or unconfirmed SMS delivery');
    }
    return true;
  }
  return false;
}
async function smsWebhook(request,env,url,ctx){
  if(request.method!=='POST')return new Response('Method unavailable',{status:405});
  const route=env.DB?await smsRoute(request,env,url):null;
  if(!route)return new Response('SMS is not configured',{status:503});
  const {config,owner,companyId}=route;
  const fields=await verifiedForm(request,config,url);
  if(!fields||fields.get('AccountSid')!==config.account)return new Response('Invalid provider signature',{status:403});
  const sid=fields.get('MessageSid')||'';
  if(!messageSidPattern.test(sid))return new Response('Invalid message ID',{status:400});
  if(url.pathname==='/api/sms/status'){
    const id=url.searchParams.get('id')||'';
    const status=fields.get('MessageStatus')||fields.get('SmsStatus')||'';
    if(!/^[a-f0-9-]{36}$/i.test(id)||!resultStatuses.includes(status))return new Response(null,{status:204});
    await updateSmsWorkspace(env,owner,state=>({changed:recordSmsDelivery(state,id,status,sid,fields.get('ErrorCode'))}));
    return smsResponse();
  }
  const from=fields.get('From')||'',to=fields.get('To'),body=(fields.get('Body')||'').trim(),media=Number(fields.get('NumMedia')||0);
  if(to!==config.number||!phonePattern.test(from)||body.length>5000||!Number.isInteger(media)||media<0||media>10)return new Response('Invalid inbound event',{status:400});
  // Store the event as a job and answer Twilio straight away; processing and any reply happen in the background.
  const mediaItems=Array.from({length:Math.min(media,10)},(_,i)=>({url:fields.get('MediaUrl'+i)||'',type:fields.get('MediaContentType'+i)||''})).filter(m=>/^https:\/\/api\.twilio\.com\//.test(m.url));
  await enqueue(env.DB,{owner,kind:'sms.inbound',dedupe:'sms:'+sid,payload:{sid,from,to,body,media,mediaItems,segments:Number(fields.get('NumSegments')||0),opt:fields.get('OptOutType')||''}});
  const work=runJobs(env).catch(error=>console.error('job run failed',error));
  if(ctx?.waitUntil)ctx.waitUntil(work);else await work;
  return smsResponse();
}

async function sendAdminSms(request,env,url,user){
  if(!user)return json({error:'Sign in to your authorized account.'},401);
  const config=smsConfig(env);
  if(config?.owner!==user.id||!env.DB)return json({error:'Connect the SMS provider first.'},409);
  if(request.method!=='POST'||request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid request.'},403);
  const raw=await request.text();
  if(raw.length>12000)return json({error:'Message is too long.'},413);
  let payload;
  try{payload=JSON.parse(raw);}catch{return json({error:'Invalid message.'},400);}
  const {thread:threadId,id,body}=payload||{};
  if(typeof threadId!=='string'||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof body!=='string'||!body.trim()||body.length>1600)return json({error:'Enter a reply of up to 1,600 characters.'},400);
  const reservation=await updateSmsWorkspace(env,user.id,state=>{
    const thread=state.threads.find(item=>item.id===threadId&&item.channel==='SMS');
    const recipient=state.contacts.find(item=>item.id===thread?.contact);
    if(!recipient||recipient.optout||!phonePattern.test(recipient.phone))return {value:{blocked:true}};
    const existing=state.threads.flatMap(item=>item.messages).find(message=>message.id===id);
    if(existing)return {value:{duplicate:true,status:existing.delivery}};
    thread.messages.push({id,kind:'out',actor:'Staff',body:body.trim(),time:smsTime(),delivery:'submitting'});
    thread.updated=smsTime();
    smsAudit(state,'Staff submitted an SMS reply',user.email);
    return {changed:true,value:{number:recipient.phone}};
  });
  if(reservation.blocked)return json({error:'Recipient is unavailable or opted out.'},400);
  if(reservation.duplicate)return json({status:reservation.status});
  let status='uncertain',sid,errorCode;
  try {
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.account}/Messages.json`,{
      method:'POST',headers:{Authorization:'Basic '+btoa(config.account+':'+config.token)},
      body:new URLSearchParams({From:config.number,To:reservation.number,Body:body.trim(),StatusCallback:callbackUrl(config,id)}),
      signal:AbortSignal.timeout(10000)
    });
    const data=await response.json();
    if(response.ok&&messageSidPattern.test(data.sid)){sid=data.sid;status=resultStatuses.includes(data.status)?data.status:'accepted';}
    else if(!response.ok&&response.status<500){status='failed';errorCode=String(data.code||response.status);}
  }catch{/* A timeout can leave an accepted message. Do not replay it. */}
  await updateSmsWorkspace(env,user.id,state=>({changed:recordSmsDelivery(state,id,status,sid,errorCode)}));
  return json({status},status==='failed'||status==='uncertain'?502:200);
}
