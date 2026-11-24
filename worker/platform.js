// Providers, AI drafting, usage metering, phone numbers, support and invoices.
// Mirrored by scripts/dev_server.py for local preview; keep the two in step.
const ANTHROPIC_VERSION='2026-10-21';
const AI_MODELS=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5','claude-fable-5-2'];
const AI_EFFORTS=['low','medium','high','xhigh','max'];
const QUOTA_KINDS={sms:['sms_out','sms_in'],ai:['ai']};
const period=()=>new Date().toISOString().slice(0,7);
const periodStart=p=>p+'-01T00:00:00.000Z';
function nextPeriod(p){const [y,m]=p.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;}

async function settingsMap(db){
  return Object.fromEntries((await all(db,'SELECT key, value FROM platform_settings')).map(row=>[row.key,row.value]));
}
async function putSetting(db,key,value){
  await exec(db,'INSERT INTO platform_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',key,String(value));
}

/* Secrets: AES-GCM with a key derived from the HUSHHAWK_SECRETS_KEY Worker secret. */
async function secretsKey(env){
  if(!env.HUSHHAWK_SECRETS_KEY||String(env.HUSHHAWK_SECRETS_KEY).length<16)acctFail('Set the HUSHHAWK_SECRETS_KEY Worker secret before saving provider keys.',503);
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(env.HUSHHAWK_SECRETS_KEY)));
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function putSecret(env,key,plain){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},await secretsKey(env),new TextEncoder().encode(plain));
  await exec(env.DB,'INSERT INTO secrets (key,value,hint,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, hint = excluded.hint, updated_at = excluded.updated_at',
    key,'v1.'+b64(iv)+'.'+b64(sealed),'••••'+plain.slice(-4),acctNow());
}
async function getSecret(env,key){
  const row=await one(env.DB,'SELECT value FROM secrets WHERE key = ?',key);
  if(!row)return '';
  const [,iv,data]=row.value.split('.');
  try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await secretsKey(env),unb64(data)));}
  catch{acctFail('A stored provider key could not be decrypted. Re-enter it in Providers.',503);}
}

/* Usage and quotas */
// Usage counts over the subscription period when there is one, otherwise the calendar month.
function usageWindow(me){
  const s=me?.subscription;
  return s?.periodStart&&s?.periodEnd&&s.periodStart<=acctNow()?{from:s.periodStart,to:s.periodEnd}:null;
}
async function usageFor(db,companyId,p=period()){
  const from=typeof p==='object'&&p?p.from:periodStart(p||period()),to=typeof p==='object'&&p?p.to:periodStart(nextPeriod(p||period()));
  const rows=await all(db,"SELECT kind, SUM(quantity) AS qty, SUM(cost_micros) AS cost FROM usage_events WHERE company_id = ? AND at >= ? AND at < ? AND status = 'ok' GROUP BY kind",companyId,from,to);
  const by=Object.fromEntries(rows.map(r=>[r.kind,{qty:r.qty||0,cost:r.cost||0}]));
  const sum=kinds=>kinds.reduce((n,k)=>n+(by[k]?.qty||0),0);
  return {period:typeof p==='object'&&p?p.from.slice(0,10):p,from,to,sms:sum(QUOTA_KINDS.sms),smsOut:by.sms_out?.qty||0,smsIn:by.sms_in?.qty||0,ai:sum(QUOTA_KINDS.ai),costMicros:rows.reduce((n,r)=>n+(r.cost||0),0)};
}
async function meter(db,companyId,kind,{quantity=1,input=0,output=0,cost=0,status='ok',detail=''}={}){
  await exec(db,'INSERT INTO usage_events (id,company_id,kind,quantity,input_tokens,output_tokens,cost_micros,status,detail,at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    acctId(),companyId,kind,quantity,input,output,Math.round(cost),status,String(detail).slice(0,300),acctNow());
}
async function checkQuota(db,me,key){
  const limit=Number(me.entitlements.quotas?.[key]||0);
  if(!limit)return;
  const used=(await usageFor(db,me.company.id,usageWindow(me)))[key];
  if(used>=limit&&me.entitlements.overage!=='allow')
    acctFail(`Your ${me.plan.name} plan includes ${limit} ${key==='ai'?'AI replies':'text messages'} a month and you’ve used them all. Upgrade in Billing to keep going.`,402);
}
async function ownerContext(env,user,feature){
  return companyUser(env,user,{needsAccess:true,feature});
}
async function loadWorkspace(db,companyId){
  return (await loadState(db,'company:'+companyId))?.state??null;
}

/* AI */
async function callClaude(env,{system,messages}){
  const key=await getSecret(env,'anthropic_api_key');
  if(!key)acctFail('The AI provider isn’t connected yet. Contact HushHawk support.',503);
  const s=await settingsMap(env.DB);
  let response,data={};
  try{
    response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{
      'content-type':'application/json','x-api-key':key,'anthropic-version':ANTHROPIC_VERSION,'anthropic-beta':'server-side-fallback-2026-07-01'
    },body:JSON.stringify({model:s.ai_model||'claude-opus-5-5',max_tokens:16000,system,messages,output_config:{effort:s.ai_effort||'medium'},fallbacks:'default'}),
    signal:AbortSignal.timeout(90000)});
    data=await response.json().catch(()=>({}));
  }catch{acctFail('The AI provider didn’t respond in time. Try again.',504);}
  if(!response.ok)acctFail('AI provider error: '+(data.error?.message||response.status),502);
  if(data.stop_reason==='refusal')acctFail('The AI declined to draft this reply. Please write it yourself.',422);
  const text=(data.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('').trim();
  if(!text)acctFail('The AI returned an empty draft. Try again.',502);
  const input=data.usage?.input_tokens||0,output=data.usage?.output_tokens||0;
  const cost=input*Number(s.cost_ai_input_mtok_micros||0)/1e6+output*Number(s.cost_ai_output_mtok_micros||0)/1e6;
  return {text,model:data.model,input,output,cost};
}
function draftPrompt(state,thread,platformInstructions){
  const contact=state.contacts.find(c=>c.id===thread.contact)||{};
  const property=state.properties.find(p=>p.id===contact.property);
  const s=state.settings||{};
  const knowledge=(state.knowledge||[]).map(k=>`- ${k.title||k.topic}: ${k.body}`).join('\n')||'- (none provided)';
  const templates=(state.templates||[]).map(t=>`- ${t.name}: ${t.body}`).join('\n')||'- (none provided)';
  const system=`${platformInstructions}\n\nCompany: ${s.company||'Property team'}\nAssistant name: ${s.assistant||'Property team'}\nTone: ${s.tone||'Professional'}\nBusiness hours: ${s.hours||'not provided'}\n\nCompany knowledge:\n${knowledge}\n\nApproved templates:\n${templates}`;
  const transcript=thread.messages.slice(-20).map(m=>`[${m.kind==='in'?'Tenant':m.kind==='note'?'Internal note (not visible to tenant)':'Property team'}] ${m.body}`).join('\n');
  const who=`${contact.name||'a tenant'}${property?`, ${property.name}${contact.unit?' unit '+contact.unit:''}`:''}${contact.verified?'':' (identity not verified)'}`;
  return {system,messages:[{role:'user',content:`Conversation by ${thread.channel} with ${who}. Oldest first:\n\n${transcript}\n\nWrite only the next ${thread.channel==='Email'?'email':'text message'} from the property team. No preamble, no sign-off placeholders.`}]};
}
async function aiDraft(request,env,url,user){
  const me=await ownerContext(env,user,'ai'),input=await readJson(request,url);
  const state=await loadWorkspace(env.DB,me.company.id);
  const thread=state?.threads.find(t=>t.id===text(input.threadId,60));
  if(!thread)acctFail('Conversation not found. Reload and try again.',404);
  if(state.contacts.find(c=>c.id===thread.contact)?.optout)acctFail('This contact has opted out.',400);
  await checkQuota(env.DB,me,'ai');
  const s=await settingsMap(env.DB);
  try{
    const result=await callClaude(env,draftPrompt(state,thread,s.ai_instructions||''));
    await meter(env.DB,me.company.id,'ai',{input:result.input,output:result.output,cost:result.cost,detail:result.model});
    return json({text:result.text,usage:await usageFor(env.DB,me.company.id,usageWindow(me))});
  }catch(error){
    await meter(env.DB,me.company.id,'ai',{quantity:0,status:'error',detail:error.message});
    throw error;
  }
}

/* SMS for companies, through the platform Twilio account */
async function platformSms(env){
  const s=await settingsMap(env.DB);
  const token=await getSecret(env,'twilio_auth_token').catch(()=> '');
  if(!/^AC[a-f0-9]{32}$/i.test(s.twilio_account_sid||'')||!token||!s.twilio_webhook_base)return null;
  try{const base=new URL(s.twilio_webhook_base);if(base.protocol!=='https:')return null;return {account:s.twilio_account_sid,token,base:base.origin};}catch{return null;}
}
async function companyNumber(db,companyId){return (await one(db,'SELECT number FROM phone_numbers WHERE company_id = ? ORDER BY assigned_at LIMIT 1',companyId))?.number||'';}
async function companySmsStatus(env,companyId){
  const number=await companyNumber(env.DB,companyId);
  return {configured:Boolean(number&&await platformSms(env)),number,workspaceId:companyId};
}
async function companySms(request,env,url,user){
  const me=await companyUser(env,user,{roles:SENDERS,needsAccess:true,feature:'inbox'}),payload=await readJson(request,url);
  const platform=await platformSms(env),number=await companyNumber(env.DB,me.company.id);
  if(!platform||!number)acctFail('Texting isn’t set up for your company yet. Request a number in Billing.',409);
  const {thread:threadId,id,body}=payload;
  if(typeof threadId!=='string'||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof body!=='string'||!body.trim()||body.length>1600)acctFail('Enter a reply of up to 1,600 characters.');
  await checkQuota(env.DB,me,'sms');
  const owner='company:'+me.company.id,config={...platform,number,companyId:me.company.id};
  const reservation=await updateSmsWorkspace(env,owner,state=>{
    const thread=state.threads.find(item=>item.id===threadId&&item.channel==='SMS');
    const recipient=state.contacts.find(item=>item.id===thread?.contact);
    if(!recipient||recipient.optout||!phonePattern.test(recipient.phone))return {value:{blocked:true}};
    const existing=state.threads.flatMap(item=>item.messages).find(message=>message.id===id);
    if(existing)return {value:{duplicate:true,status:existing.delivery}};
    thread.messages.push({id,kind:'out',actor:user.name||'Staff',body:body.trim(),time:smsTime(),delivery:'submitting',segments:smsSegments(body.trim())});
    thread.updated=smsTime();
    smsAudit(state,'Staff submitted an SMS reply',user.email);
    return {changed:true,value:{number:recipient.phone,via:thread.via||''}};
  });
  if(reservation.blocked)acctFail('Recipient is unavailable or opted out.');
  if(reservation.duplicate)return json({status:reservation.status});
  const via=reservation.via&&(await one(env.DB,'SELECT number FROM phone_numbers WHERE number = ? AND company_id = ?',reservation.via,me.company.id))?.number;
  const outcome=await twilioSend(via?{...config,number:via}:config,reservation.number,body.trim(),id);
  await updateSmsWorkspace(env,owner,state=>({changed:recordSmsDelivery(state,id,outcome.status,outcome.sid,outcome.errorCode)}));
  const s=await settingsMap(env.DB);
  const segments=smsSegments(body.trim());
  await meter(env.DB,me.company.id,'sms_out',{quantity:segments,status:outcome.status==='failed'?'error':'ok',cost:Number(s.cost_sms_micros||0)*segments,detail:outcome.errorCode||outcome.status});
  return json({status:outcome.status},outcome.status==='failed'||outcome.status==='uncertain'?502:200);
}
async function twilioSend(config,to,body,id){
  let status='uncertain',sid,errorCode;
  try{
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.account}/Messages.json`,{
      method:'POST',headers:{Authorization:'Basic '+btoa(config.account+':'+config.token)},
      body:new URLSearchParams({From:config.number,To:to,Body:body,StatusCallback:callbackUrl(config,id)}),signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(response.ok&&messageSidPattern.test(data.sid)){sid=data.sid;status=resultStatuses.includes(data.status)?data.status:'accepted';}
    else if(!response.ok&&response.status<500){status='failed';errorCode=String(data.code||response.status);}
  }catch{/* A timeout can leave an accepted message. Do not replay it. */}
  return {status,sid,errorCode};
}
// Resolve which workspace an inbound Twilio webhook belongs to: the legacy single owner, or a company by its number.
async function smsRoute(request,env,url){
  const legacy=smsConfig(env);
  const companyParam=url.searchParams.get('c')||'';
  let to='';
  try{to=new URLSearchParams(await request.clone().text()).get('To')||'';}catch{}
  const legacyRoute=legacy&&{config:legacy,owner:legacy.owner,companyId:''};
  if(legacyRoute&&!companyParam&&(url.pathname==='/api/sms/status'||to===legacy.number))return legacyRoute;
  try{
    const platform=env.DB&&await platformSms(env);
    const companyId=platform&&(companyParam||(await one(env.DB,'SELECT company_id FROM phone_numbers WHERE number = ?',to))?.company_id||'');
    if(platform&&/^[a-f0-9-]{36}$/i.test(companyId)){
      const number=to||await companyNumber(env.DB,companyId);
      return {config:{...platform,number,companyId},owner:'company:'+companyId,companyId};
    }
  }catch{/* Platform tables or settings unavailable: fall back to the single-owner route. */}
  // Unknown destinations go through the single-owner route so the signature check rejects them.
  return legacyRoute||null;
}
/* Company-side overview, number requests and support */
function supportPriority(plan){return /dedicated/i.test(plan?.support||'')?'Dedicated':/priority/i.test(plan?.support||'')?'Priority':'Standard';}
const supportOut=row=>({id:row.id,companyId:row.company_id,userEmail:row.user_email,subject:row.subject,priority:row.priority,status:row.status,messages:JSON.parse(row.messages),createdAt:row.created_at,updatedAt:row.updated_at});
const invoiceOut=row=>({id:row.id,companyId:row.company_id,number:row.number,kind:row.kind,period:row.period,periodEnd:row.period_end,planName:row.plan_name,lines:JSON.parse(row.lines),totalCents:row.total_cents,status:row.status,dueAt:row.due_at,paidAt:row.paid_at,createdAt:row.created_at});
async function companyOverview(env,user){
  const me=await companyUser(env,user);
  const db=env.DB,id=me.company.id,owner=user.role==='owner';
  const billing=await billingSettingsOut(env);
  return json({usage:await usageFor(db,id,usageWindow(me)),quotas:me.entitlements.quotas,overage:me.entitlements.overage,sms:await companySmsStatus(env,id),
    numberRequests:await all(db,'SELECT id, area_code AS areaCode, note, status, created_at AS createdAt FROM number_requests WHERE company_id = ? ORDER BY created_at DESC',id),
    invoices:['owner','finance'].includes(user.role)?(await all(db,"SELECT * FROM invoices WHERE company_id = ? AND status != 'void' ORDER BY created_at DESC",id)).map(invoiceOut):[],
    payments:['owner','finance'].includes(user.role)?(await all(db,'SELECT * FROM payments WHERE company_id = ? ORDER BY at DESC',id)).map(paymentOut):[],
    seller:{name:billing.sellerName,details:billing.sellerDetails,instructions:billing.paymentInstructions,cardPayments:Boolean(billing.stripeKey)},
    team:await teamOf(db,id),
    support:(await all(db,'SELECT * FROM support_requests WHERE company_id = ? ORDER BY updated_at DESC',id)).map(supportOut)});
}
async function companyAction(request,env,url,user,action){
  const me=await companyUser(env,user,{roles:action==='number-request'?['owner','admin']:COMPANY_ROLES}),input=await readJson(request,url),db=env.DB,id=me.company.id;
  if(action==='number-request'){
    if(await one(db,"SELECT id FROM number_requests WHERE company_id = ? AND status = 'open'",id))acctFail('You already have a number request open.');
    await exec(db,'INSERT INTO number_requests (id,company_id,area_code,note,created_at) VALUES (?,?,?,?,?)',acctId(),id,text(input.areaCode,6).replace(/\D/g,''),text(input.note,400),acctNow());
    await audit(db,user.email,'Requested a phone number',me.company.name);
  }else if(action==='support'){
    const subject=text(input.subject,140),body=text(input.body,4000);
    if(!subject||!body)acctFail('Add a subject and a message.');
    await exec(db,'INSERT INTO support_requests (id,company_id,user_email,subject,priority,messages,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      acctId(),id,user.email,subject,supportPriority(me.plan),JSON.stringify([{from:'company',author:user.name,body,at:acctNow()}]),acctNow(),acctNow());
    await audit(db,user.email,'Opened a support request',me.company.name);
    await emailSuperAdmins(db,`Support request from ${me.company.name}: ${subject}`,[`${user.name} (${user.email}) wrote:`,body],'/#super/support');
  }else if(action==='support-reply'){
    const row=await one(db,'SELECT * FROM support_requests WHERE id = ? AND company_id = ?',text(input.id,60),id);
    const body=text(input.body,4000);
    if(!row)acctFail('Support request not found.',404);
    if(!body)acctFail('Write a message.');
    const messages=[...JSON.parse(row.messages),{from:'company',author:user.name,body,at:acctNow()}];
    await exec(db,"UPDATE support_requests SET messages = ?, status = 'open', updated_at = ? WHERE id = ?",JSON.stringify(messages),acctNow(),row.id);
  }else acctFail('Not found.',404);
  return companyOverview(env,user);
}

/* Super admin */
async function providersOut(env){
  const s=await settingsMap(env.DB);
  const hints=Object.fromEntries((await all(env.DB,'SELECT key, hint, updated_at FROM secrets')).map(r=>[r.key,{hint:r.hint,updatedAt:r.updated_at}]));
  return {aiModel:s.ai_model,aiEffort:s.ai_effort,aiInstructions:s.ai_instructions,models:AI_MODELS,efforts:AI_EFFORTS,
    anthropicKey:hints.anthropic_api_key||null,twilioSid:s.twilio_account_sid||'',twilioToken:hints.twilio_auth_token||null,twilioWebhookBase:s.twilio_webhook_base||'',
    secretsReady:Boolean(env.HUSHHAWK_SECRETS_KEY&&String(env.HUSHHAWK_SECRETS_KEY).length>=16),
    postmarkToken:hints.postmark_token||null,emailSender:s.email_sender||'',emailInbound:s.email_inbound_address||'',emailStream:s.email_stream||'outbound',alertEmail:s.alert_email||'',
    emailWebhookToken:hints.email_webhook_secret?await getSecret(env,'email_webhook_secret').catch(()=> ''):'',
    costs:{smsMicros:Number(s.cost_sms_micros||0),aiInputMtokMicros:Number(s.cost_ai_input_mtok_micros||0),aiOutputMtokMicros:Number(s.cost_ai_output_mtok_micros||0),overageSmsCents:Number(s.overage_sms_cents||0),overageAiCents:Number(s.overage_ai_cents||0)}};
}
async function fullOverview(env){
  await syncAll(env);
  const db=env.DB,base=await superOverview(db),p=period();
  const providers=await providersOut(env);
  const usageRows=await all(db,"SELECT company_id, kind, SUM(quantity) AS qty, SUM(cost_micros) AS cost, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors FROM usage_events WHERE at >= ? GROUP BY company_id, kind",periodStart(p));
  const recentErrors=await all(db,"SELECT company_id, kind, detail, at FROM usage_events WHERE status = 'error' AND at >= ? ORDER BY at DESC LIMIT 50",new Date(Date.now()-864e5).toISOString());
  const numbers=await all(db,'SELECT number, company_id AS companyId, label, added_at AS addedAt, assigned_at AS assignedAt FROM phone_numbers ORDER BY added_at');
  const numberRequests=await all(db,'SELECT id, company_id AS companyId, area_code AS areaCode, note, status, created_at AS createdAt FROM number_requests ORDER BY created_at DESC');
  const support=(await all(db,'SELECT * FROM support_requests ORDER BY updated_at DESC')).map(supportOut);
  const invoices=(await all(db,'SELECT * FROM invoices ORDER BY created_at DESC')).map(invoiceOut);
  const payments=(await all(db,'SELECT * FROM payments ORDER BY at DESC')).map(paymentOut);
  const users=await all(db,"SELECT id, company_id AS companyId, name, email, role, status, created_at AS createdAt, last_login AS lastLogin FROM users WHERE company_id IS NOT NULL ORDER BY created_at");
  const invites=await all(db,'SELECT id, company_id AS companyId, email, role, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt FROM invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?',acctNow());
  const alerts=[];
  if(!providers.anthropicKey)alerts.push({level:'warn',text:'AI provider key is missing. AI drafts fail until it’s added.',link:'providers'});
  if(!providers.twilioToken||!providers.twilioSid)alerts.push({level:'warn',text:'Twilio isn’t connected. Companies can’t send or receive texts.',link:'providers'});
  if(!providers.postmarkToken||!providers.emailSender)alerts.push({level:'warn',text:'Email isn’t connected. Invites, resets and invoices aren’t emailed, and companies can’t use email.',link:'providers'});
  const failedJobs=(await one(db,"SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND finished_at >= ?",new Date(Date.now()-864e5).toISOString())).n;
  if(failedJobs)alerts.push({level:'bad',text:`${failedJobs} background job${failedJobs===1?'':'s'} failed in the last 24 hours.`,link:'usage'});
  for(const company of base.companies){
    const rows=usageRows.filter(r=>r.company_id===company.id);
    const sum=kinds=>rows.filter(r=>kinds.includes(r.kind)).reduce((n,r)=>n+(r.qty||0),0);
    const plan=base.plans.find(x=>x.id===company.planId);
    company.usage.month={sms:sum(QUOTA_KINDS.sms),ai:sum(QUOTA_KINDS.ai),costMicros:rows.reduce((n,r)=>n+(r.cost||0),0),errors:rows.reduce((n,r)=>n+(r.errors||0),0)};
    company.number=numbers.find(n=>n.companyId===company.id)?.number||'';
    if(company.status!=='active'||!plan)continue;
    for(const key of ['sms','ai']){
      const limit=Number(plan.quotas?.[key]||0),used=company.usage.month[key];
      if(limit&&used>=limit)alerts.push({level:'bad',text:`${company.name} has used all ${limit} ${key==='ai'?'AI replies':'texts'} this month${plan.overage==='allow'?' (overage billed)':' (now blocked)'}.`,link:'companies/'+company.id});
      else if(limit&&used>=limit*0.8)alerts.push({level:'warn',text:`${company.name} has used ${Math.round(used/limit*100)}% of its ${key==='ai'?'AI replies':'texts'}.`,link:'companies/'+company.id});
    }
  }
  const errorsByCompany={};
  for(const e of recentErrors)errorsByCompany[e.company_id]=(errorsByCompany[e.company_id]||0)+1;
  for(const [id,count] of Object.entries(errorsByCompany)){const c=base.companies.find(x=>x.id===id);alerts.push({level:'bad',text:`${count} provider error${count===1?'':'s'} for ${c?.name||'a company'} in the last 24 hours.`,link:'usage'});}
  const openRequests=numberRequests.filter(r=>r.status==='open').length;
  if(openRequests)alerts.push({level:'info',text:`${openRequests} phone number request${openRequests===1?'':'s'} waiting.`,link:'numbers'});
  const openSupport=support.filter(r=>r.status==='open').length;
  if(openSupport)alerts.push({level:'info',text:`${openSupport} support request${openSupport===1?'':'s'} need a reply.`,link:'support'});
  const overdue=invoices.filter(i=>i.status==='sent'&&i.dueAt&&i.dueAt<acctNow());
  if(overdue.length)alerts.push({level:'warn',text:`${overdue.length} invoice${overdue.length===1?' is':'s are'} past due.`,link:'invoices'});
  const unpaid=base.companies.filter(c=>c.subscription.status==='unpaid').length;
  if(unpaid)alerts.push({level:'bad',text:`${unpaid} compan${unpaid===1?'y has':'ies have'} access paused for non-payment.`,link:'companies'});
  const leads=await all(db,'SELECT * FROM leads ORDER BY created_at DESC LIMIT 200');
  if(leads.some(l=>l.status==='new'))alerts.push({level:'info',text:`${leads.filter(l=>l.status==='new').length} new demo request${leads.filter(l=>l.status==='new').length===1?'':'s'}.`,link:'leads'});
  const deletions=base.companies.filter(c=>c.deletionRequestedAt);
  for(const c of deletions)alerts.push({level:'warn',text:`${c.name} asked to be deleted. Scheduled for ${new Date(Date.parse(c.deletionRequestedAt)+30*864e5).toDateString()}.`,link:'companies/'+c.id});
  return {...base,leads,period:p,providers,numbers,numberRequests,support,invoices,payments,users,invites,billing:await billingSettingsOut(env),alerts,recentErrors};
}
async function superProviders(env,input,actor){
  const db=env.DB;
  if(input.aiModel!==undefined){if(!AI_MODELS.includes(input.aiModel))acctFail('Choose a supported model.');await putSetting(db,'ai_model',input.aiModel);}
  if(input.aiEffort!==undefined){if(!AI_EFFORTS.includes(input.aiEffort))acctFail('Choose an effort level.');await putSetting(db,'ai_effort',input.aiEffort);}
  if(input.aiInstructions!==undefined)await putSetting(db,'ai_instructions',text(input.aiInstructions,6000));
  if(input.twilioSid!==undefined){const sid=text(input.twilioSid,40);if(sid&&!/^AC[a-f0-9]{32}$/i.test(sid))acctFail('Twilio Account SID starts with AC followed by 32 characters.');await putSetting(db,'twilio_account_sid',sid);}
  if(input.twilioWebhookBase!==undefined){const base=text(input.twilioWebhookBase,200);if(base){try{const u=new URL(base);if(u.protocol!=='https:')throw 0;}catch{acctFail('Webhook base must be an https:// address.');}}await putSetting(db,'twilio_webhook_base',base.replace(/\/$/,''));}
  if(input.anthropicKey){const key=String(input.anthropicKey).trim();if(!/^sk-ant-/.test(key))acctFail('That doesn’t look like an Anthropic API key (sk-ant-…).');await putSecret(env,'anthropic_api_key',key);}
  if(input.twilioToken){const token=String(input.twilioToken).trim();if(!/^[a-f0-9]{32}$/i.test(token))acctFail('Twilio Auth Token is 32 characters.');await putSecret(env,'twilio_auth_token',token);}
  if(input.postmarkToken){const token=String(input.postmarkToken).trim();if(!/^[a-f0-9-]{36}$/i.test(token))acctFail('A Postmark server token looks like 00000000-0000-0000-0000-000000000000.');await putSecret(env,'postmark_token',token);}
  for(const [field,key] of [['emailSender','email_sender'],['emailInbound','email_inbound_address'],['alertEmail','alert_email']]){
    if(input[field]===undefined)continue;
    const value=text(input[field],254).toLowerCase();
    if(value&&!emailPattern.test(value))acctFail('Enter a valid email address.');
    await putSetting(db,key,value);
  }
  if(input.emailStream!==undefined)await putSetting(db,'email_stream',text(input.emailStream,60)||'outbound');
  if(input.rotateEmailSecret||(input.postmarkToken&&!await one(db,"SELECT key FROM secrets WHERE key = 'email_webhook_secret'")))
    await putSecret(env,'email_webhook_secret',hex(crypto.getRandomValues(new Uint8Array(24))));
  for(const key of input.clear||[])if(['anthropic_api_key','twilio_auth_token','postmark_token'].includes(key))await exec(db,'DELETE FROM secrets WHERE key = ?',key);
  const costs=input.costs||{};
  for(const [field,key] of [['smsMicros','cost_sms_micros'],['aiInputMtokMicros','cost_ai_input_mtok_micros'],['aiOutputMtokMicros','cost_ai_output_mtok_micros'],['overageSmsCents','overage_sms_cents'],['overageAiCents','overage_ai_cents']])
    if(costs[field]!==undefined){const n=Math.round(Number(costs[field]));if(!Number.isFinite(n)||n<0)acctFail('Costs must be zero or more.');await putSetting(db,key,n);}
  await audit(db,actor.email,'Updated providers and AI setup');
}
async function superAiTest(env,actor){
  const started=Date.now();
  const result=await callClaude(env,{system:'Reply with one short sentence.',messages:[{role:'user',content:'Confirm the HushHawk connection works.'}]});
  await audit(env.DB,actor.email,'Tested the AI connection');
  return {ok:true,model:result.model,reply:result.text,ms:Date.now()-started,input:result.input,output:result.output};
}
async function superNumber(db,input,actor){
  const number=text(input.number,20);
  if(input.action==='add'){
    if(!phonePattern.test(number))acctFail('Enter the number in international format, like +15551234567.');
    if(await one(db,'SELECT number FROM phone_numbers WHERE number = ?',number))acctFail('That number is already listed.');
    await exec(db,'INSERT INTO phone_numbers (number,label,added_at) VALUES (?,?,?)',number,text(input.label,60),acctNow());
    await audit(db,actor.email,'Added phone number',number);
  }else if(input.action==='assign'){
    const company=await one(db,'SELECT id, name FROM companies WHERE id = ?',text(input.companyId,60));
    if(!company)acctFail('Choose a company.');
    const row=await one(db,'SELECT * FROM phone_numbers WHERE number = ?',number);
    if(!row)acctFail('Number not found.',404);
    if(row.company_id&&row.company_id!==company.id)acctFail('Unassign the number from its current company first.');
    await exec(db,'UPDATE phone_numbers SET company_id = ?, assigned_at = ? WHERE number = ?',company.id,acctNow(),number);
    await exec(db,"UPDATE number_requests SET status = 'done', resolved_at = ? WHERE company_id = ? AND status = 'open'",acctNow(),company.id);
    await audit(db,actor.email,'Assigned '+number,company.name);
  }else if(input.action==='unassign'){
    await exec(db,'UPDATE phone_numbers SET company_id = NULL, assigned_at = NULL WHERE number = ?',number);
    await audit(db,actor.email,'Unassigned phone number',number);
  }else if(input.action==='remove'){
    if((await one(db,'SELECT company_id FROM phone_numbers WHERE number = ?',number))?.company_id)acctFail('Unassign the number before removing it.');
    await exec(db,'DELETE FROM phone_numbers WHERE number = ?',number);
    await audit(db,actor.email,'Removed phone number',number);
  }else if(input.action==='decline'){
    await exec(db,"UPDATE number_requests SET status = 'declined', resolved_at = ? WHERE id = ?",acctNow(),text(input.requestId,60));
    await audit(db,actor.email,'Declined a phone number request');
  }else acctFail('Unknown action.');
}
async function superSupport(db,input,actor){
  const row=await one(db,'SELECT * FROM support_requests WHERE id = ?',text(input.id,60));
  if(!row)acctFail('Support request not found.',404);
  if(input.action==='reply'){
    const body=text(input.body,4000);
    if(!body)acctFail('Write a reply.');
    const messages=[...JSON.parse(row.messages),{from:'hushhawk',author:'HushHawk support',body,at:acctNow()}];
    await exec(db,"UPDATE support_requests SET messages = ?, status = 'answered', updated_at = ? WHERE id = ?",JSON.stringify(messages),acctNow(),row.id);
    await queueEmail(db,{to:row.user_email,subject:`Re: ${row.subject}`,paragraphs:['HushHawk support replied:',body],cta:{label:'Open support',url:'/#support/'+row.id}});
  }else if(['close','reopen'].includes(input.action)){
    await exec(db,'UPDATE support_requests SET status = ?, updated_at = ? WHERE id = ?',input.action==='close'?'closed':'open',acctNow(),row.id);
  }else acctFail('Unknown action.');
  await audit(db,actor.email,{reply:'Replied to support request',close:'Closed support request',reopen:'Reopened support request'}[input.action],row.subject);
}
async function superWorkspace(db,input,actor){
  const company=await one(db,'SELECT id, name FROM companies WHERE id = ?',text(input.id,60));
  if(!company)acctFail('Company not found.',404);
  const state=await loadWorkspace(db,company.id);
  await audit(db,actor.email,'Viewed workspace (read-only)',company.name);
  if(!state)return {company:company.name,empty:true};
  const contact=id=>state.contacts.find(c=>c.id===id);
  return {company:company.name,settings:{company:state.settings.company,hours:state.settings.hours,mode:state.settings.mode,tone:state.settings.tone},
    counts:{properties:state.properties.length,contacts:state.contacts.length,threads:state.threads.length,tickets:state.tickets.length,tasks:state.tasks.length,team:state.team.length,knowledge:state.knowledge.length},
    threads:[...state.threads].sort((a,b)=>String(b.updated).localeCompare(String(a.updated))).slice(0,10).map(t=>({subject:t.subject,channel:t.channel,status:t.status,priority:t.priority,contact:contact(t.contact)?.name||'Unknown',updated:t.updated,last:t.messages.at(-1)?.body?.slice(0,160)||''})),
    tickets:state.tickets.slice(-10).reverse().map(t=>({title:t.title,status:t.status,priority:t.priority})),
    team:state.team.map(m=>({name:m.name,role:m.role,status:m.status})),
    audit:state.audit.slice(0,15)};
}
async function platformApi(request,env,url,user){
  const path=url.pathname;
  if(path==='/api/company/overview'&&request.method==='GET')return companyOverview(env,user);
  if(request.method!=='POST')acctFail('Method unavailable.',405);
  if(path==='/api/ai/draft')return aiDraft(request,env,url,user);
  if(path==='/api/company/sms')return companySms(request,env,url,user);
  const companyAction_=path.match(/^\/api\/company\/(number-request|support|support-reply)$/);
  if(companyAction_)return companyAction(request,env,url,user,companyAction_[1]);
  return null;
}
async function superPlatform(env,path,input,user){
  const db=env.DB;
  if(path==='/api/super/providers')await superProviders(env,input,user);
  else if(path==='/api/super/ai-test')return json(await superAiTest(env,user));
  else if(path==='/api/super/email-test'){
    const cfg=await emailConfig(env);
    if(!cfg)acctFail('Save a Postmark server token and sender address first.');
    const result=await postmarkSend(cfg,{to:text(input.to,254)||user.email,subject:'HushHawk email test',text:'Email from HushHawk is working.',html:emailHtml({heading:'Email is working',paragraphs:['This test was sent from the HushHawk console.']}),fromName:'HushHawk',metadata:{kind:'test'}});
    if(result.status!=='sent')acctFail('Postmark refused the email: '+(result.error||result.status),502);
    await audit(db,user.email,'Sent a test email');
    return json({ok:true});
  }
  else if(path==='/api/super/number')await superNumber(db,input,user);
  else if(path==='/api/super/support')await superSupport(db,input,user);
  else if(path==='/api/super/workspace')return json(await superWorkspace(db,input,user));
  else if(path==='/api/super/lead'){
    const status=['new','contacted','won','lost'].includes(input.status)?input.status:'new';
    await exec(db,'UPDATE leads SET status = ?, notes = ?, updated_at = ? WHERE id = ?',status,text(input.notes,2000),acctNow(),text(input.id,60));
    await audit(db,user.email,'Updated a demo request');
  }
  else return null;
  return json(await fullOverview(env));
}
