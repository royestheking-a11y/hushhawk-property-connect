// Email through Postmark (shared inbox in and out, delivery events, system emails),
// attachment storage, and SMS segment counting.

/* ---------- Files: attachments from MMS and email ---------- */
const FILE_LIMIT=10*1024*1024,CHUNK=900000;
async function storeFile(env,owner,{name,type,bytes,source=''}){
  if(bytes.byteLength>FILE_LIMIT)return null;
  const id=acctId(),db=env.DB;
  if(env.FILES?.put){
    await env.FILES.put(`${owner}/${id}`,bytes,{httpMetadata:{contentType:type}});
    await exec(db,'INSERT INTO files (id,owner_id,name,type,size,storage,source,created_at) VALUES (?,?,?,?,?,?,?,?)',id,owner,name,type,bytes.byteLength,'r2',source,acctNow());
  }else{
    let binary='';const view=new Uint8Array(bytes);
    for(let i=0;i<view.length;i+=32768)binary+=String.fromCharCode(...view.subarray(i,i+32768));
    const encoded=btoa(binary),statements=[];
    for(let i=0,seq=0;i<encoded.length;i+=CHUNK,seq++)statements.push(env_prepare(db,'INSERT INTO file_chunks (file_id,seq,data) VALUES (?,?,?)',id,seq,encoded.slice(i,i+CHUNK)));
    statements.push(env_prepare(db,'INSERT INTO files (id,owner_id,name,type,size,storage,source,created_at) VALUES (?,?,?,?,?,?,?,?)',id,owner,name,type,bytes.byteLength,'db',source,acctNow()));
    await runBatch(db,statements);
  }
  return {id,name,type,size:bytes.byteLength};
}
const safeName=name=>String(name||'file').replace(/[^\w.\- ]+/g,'_').slice(0,120)||'file';
async function fileRoute(request,env,url){
  const user=await currentUser(request,env.DB);
  const id=url.pathname.split('/').pop();
  const file=await one(env.DB,'SELECT * FROM files WHERE id = ?',id);
  const allowed=file&&(user?.role==='super_admin'?false:user?.company_id&&file.owner_id==='company:'+user.company_id);
  if(!allowed)return json({error:'File not found.'},404);
  let body;
  if(file.storage==='r2'){const object=await env.FILES.get(`${file.owner_id}/${file.id}`);if(!object)return json({error:'File not found.'},404);body=object.body;}
  else body=Uint8Array.from(atob((await all(env.DB,'SELECT data FROM file_chunks WHERE file_id = ? ORDER BY seq',file.id)).map(r=>r.data).join('')),c=>c.charCodeAt(0));
  const inline=/^image\/(png|jpe?g|gif|webp)$/.test(file.type);
  return new Response(body,{headers:{'Content-Type':inline?file.type:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename="${safeName(file.name)}"`,
    'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'"}});
}
// Twilio MMS media: downloaded with account credentials and kept with the message.
async function fetchTwilioMedia(env,owner,config,media){
  const saved=[];
  for(const item of media.slice(0,10)){
    try{
      const response=await fetch(item.url,{headers:{Authorization:'Basic '+btoa(config.account+':'+config.token)},signal:AbortSignal.timeout(20000)});
      if(!response.ok)continue;
      const bytes=await response.arrayBuffer();
      const ext=(item.type.split('/')[1]||'bin').replace(/[^a-z0-9]/gi,'');
      const file=await storeFile(env,owner,{name:`photo-${saved.length+1}.${ext}`,type:item.type||'application/octet-stream',bytes,source:'mms'});
      if(file)saved.push(file);
    }catch{/* Missing media leaves the text of the message intact. */}
  }
  return saved;
}

/* ---------- SMS segments ---------- */
const GSM7=new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€']);
const GSM7_EXT=new Set([...'^{}\\[~]|€']);
function smsSegments(text){
  const chars=[...String(text||'')];
  if(chars.every(c=>GSM7.has(c))){
    const length=chars.reduce((n,c)=>n+(GSM7_EXT.has(c)?2:1),0);
    return length<=160?1:Math.ceil(length/153);
  }
  const units=String(text||'').length;
  return units<=70?1:Math.ceil(units/67);
}

/* ---------- Postmark ---------- */
async function emailConfig(env){
  const s=await settingsMap(env.DB);
  const token=await getSecret(env,'postmark_token').catch(()=> '');
  const sender=(s.email_sender||'').trim();
  if(!token||!sender)return null;
  return {token,sender,inbound:(s.email_inbound_address||'').trim().toLowerCase(),stream:s.email_stream||'outbound',alert:(s.alert_email||'').trim()};
}
// Plus-addressing on the inbound address routes mail to a company, and replies to a conversation.
const companyKey=id=>'c'+id.replace(/-/g,'').slice(0,10);
function companyAddress(cfg,companyId,threadId=''){
  if(!cfg?.inbound?.includes('@'))return '';
  const [local,domain]=cfg.inbound.split('@');
  return `${local.split('+')[0]}+${companyKey(companyId)}${threadId?'.t'+threadId.replace(/-/g,'').slice(0,12):''}@${domain}`;
}
function parseMailboxHash(hash){
  const m=String(hash||'').toLowerCase().match(/^c([a-f0-9]{10})(?:\.t([a-z0-9]{6,12}))?$/);
  return m?{company:m[1],thread:m[2]||''}:null;
}
async function companyByKey(db,key){
  const rows=await all(db,"SELECT id FROM companies WHERE replace(id,'-','') LIKE ?",key+'%');
  return rows.length===1?rows[0].id:null;
}
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function emailHtml({heading='',paragraphs=[],cta=null,footer=''}){
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Inter,Arial,sans-serif;color:#0e1a2f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e3e8f0;border-radius:14px">
<tr><td style="padding:22px 28px;border-bottom:1px solid #eef1f5;font-weight:800;letter-spacing:.04em;color:#082b63">HUSHHAWK <span style="font-weight:600;color:#1456c0">Property Connect</span></td></tr>
<tr><td style="padding:26px 28px">${heading?`<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${htmlEscape(heading)}</h1>`:''}
${paragraphs.map(p=>`<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#33405a;white-space:pre-wrap">${htmlEscape(p)}</p>`).join('')}
${cta?`<p style="margin:22px 0 6px"><a href="${htmlEscape(cta.url)}" style="display:inline-block;background:#1456c0;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${htmlEscape(cta.label)}</a></p><p style="margin:0;font-size:12px;color:#8a95a8;word-break:break-all">${htmlEscape(cta.url)}</p>`:''}
</td></tr><tr><td style="padding:16px 28px;border-top:1px solid #eef1f5;font-size:12px;color:#8a95a8">${htmlEscape(footer||'Powered by HushHawk')}</td></tr>
</table></td></tr></table></body></html>`;
}
async function postmarkSend(cfg,{to,subject,text,html,replyTo,fromName,metadata,headers}){
  let response,data={};
  try{
    response=await fetch('https://api.postmarkapp.com/email',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','X-Postmark-Server-Token':cfg.token},
      body:JSON.stringify({From:fromName?`"${String(fromName).replace(/["\\<>\r\n]/g,'').slice(0,60)}" <${cfg.sender}>`:cfg.sender,To:to,Subject:String(subject).slice(0,250),TextBody:text,HtmlBody:html,
        ReplyTo:replyTo||undefined,MessageStream:cfg.stream,Metadata:metadata,Headers:headers}),signal:AbortSignal.timeout(15000)});
    data=await response.json().catch(()=>({}));
  }catch{return {status:'uncertain'};}
  if(response.ok&&data.ErrorCode===0)return {status:'sent',id:data.MessageID};
  return {status:'failed',errorCode:String(data.ErrorCode??response.status),error:data.Message||'Email provider error'};
}
// System email (invites, resets, approvals, invoices, support). Returns false when email isn't set up.
async function systemEmail(env,{to,subject,heading,paragraphs,cta,footer}){
  try{
    const cfg=await emailConfig(env);
    if(!cfg||!to)return false;
    const text=[heading,...paragraphs,cta?`${cta.label}: ${cta.url}`:'','— HushHawk Property Connect'].filter(Boolean).join('\n\n');
    const result=await postmarkSend(cfg,{to,subject,text,html:emailHtml({heading,paragraphs,cta,footer}),fromName:'HushHawk',metadata:{kind:'system'}});
    if(result.status!=='sent')console.error('system email failed',result.error||result.status);
    return result.status==='sent';
  }catch(error){console.error('system email failed',error);return false;}
}
async function superAdminEmails(env){
  const cfg=await emailConfig(env).catch(()=>null);
  const admins=(await all(env.DB,"SELECT email FROM users WHERE role = 'super_admin' AND status = 'active'")).map(r=>r.email);
  return cfg?.alert?[cfg.alert]:admins;
}
async function notifySuperAdmins(env,subject,paragraphs,link){
  const origin=link?.origin;
  for(const to of await superAdminEmails(env))await systemEmail(env,{to,subject,heading:subject,paragraphs,cta:origin?{label:'Open the console',url:link.url}:null});
}
async function companyBillingEmail(db,companyId){
  const row=await one(db,"SELECT c.profile, u.email FROM companies c LEFT JOIN users u ON u.company_id = c.id AND u.role = 'owner' WHERE c.id = ?",companyId);
  return JSON.parse(row?.profile||'{}').billingEmail||row?.email||'';
}

/* ---------- Company email: replies and status ---------- */
async function companyEmailStatus(env,companyId){
  const cfg=await emailConfig(env).catch(()=>null);
  const address=companyAddress(cfg,companyId);
  return {configured:Boolean(cfg&&address),address};
}
async function sendThreadEmail(env,cfg,companyId,companyName,{to,subject,threadId,id,body}){
  return postmarkSend(cfg,{to,subject:/^re:/i.test(subject)?subject:'Re: '+subject,text:body,
    html:emailHtml({paragraphs:[body],footer:`${companyName} · Reply to this email to continue the conversation.`}),
    replyTo:companyAddress(cfg,companyId,threadId),fromName:companyName,metadata:{owner:'company:'+companyId,message:id}});
}
async function companyEmail(request,env,url,user){
  const me=await companyUser(env,user,{roles:SENDERS,needsAccess:true,feature:'inbox'}),p=await readJson(request,url,60000);
  const cfg=await emailConfig(env);
  if(!cfg?.inbound)acctFail('Email isn’t set up yet. HushHawk will switch it on.',409);
  const {thread:threadId,id,body}=p;
  if(typeof threadId!=='string'||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof body!=='string'||!body.trim()||body.length>20000)acctFail('Enter a reply of up to 20,000 characters.');
  const owner='company:'+me.company.id;
  const reservation=await updateSmsWorkspace(env,owner,state=>{
    const thread=state.threads.find(item=>item.id===threadId&&item.channel==='Email');
    const recipient=state.contacts.find(item=>item.id===thread?.contact);
    if(!recipient||recipient.optout||recipient.emailBounced||!emailPattern.test(String(recipient.email||'')))return {value:{blocked:true}};
    const existing=thread.messages.find(message=>message.id===id);
    if(existing)return {value:{duplicate:true,status:existing.delivery}};
    thread.messages.push({id,kind:'out',actor:user.name||'Staff',body:body.trim(),time:smsTime(),delivery:'submitting'});
    thread.updated=smsTime();
    smsAudit(state,'Staff sent an email reply',user.email);
    return {changed:true,value:{to:recipient.email,subject:thread.subject,threadId}};
  });
  if(reservation.blocked)acctFail('This contact can’t receive email (opted out, bounced or no address).');
  if(reservation.duplicate)return json({status:reservation.status});
  const outcome=await sendThreadEmail(env,cfg,me.company.id,me.company.name,{...reservation,id,body:body.trim()});
  await updateSmsWorkspace(env,owner,state=>({changed:recordSmsDelivery(state,id,outcome.status,outcome.id,outcome.errorCode)}));
  await meter(env.DB,me.company.id,'email_out',{status:outcome.status==='failed'?'error':'ok',detail:outcome.error||outcome.status});
  if(outcome.status==='failed')acctFail('The email couldn’t be sent: '+(outcome.error||'provider error'),502);
  return json({status:outcome.status});
}

/* ---------- Inbound email and delivery events (Postmark webhooks) ---------- */
async function webhookAllowed(request,env,url){
  const secret=await getSecret(env,'email_webhook_secret').catch(()=> '');
  if(!secret)return false;
  let provided=url.searchParams.get('token')||'';
  const auth=request.headers.get('Authorization')||'';
  if(!provided&&auth.startsWith('Basic ')){try{provided=atob(auth.slice(6)).split(':').slice(1).join(':');}catch{}}
  return Boolean(provided)&&sameText(provided,secret);
}
async function emailInbound(request,env,url,ctx){
  if(!await webhookAllowed(request,env,url))return new Response('Forbidden',{status:403});
  const raw=await request.text();
  if(raw.length>30e6)return new Response('Too large',{status:413});
  let mail;
  try{mail=JSON.parse(raw);}catch{return new Response('Invalid payload',{status:400});}
  const hashes=[mail.MailboxHash,...(mail.ToFull||[]).map(t=>t.MailboxHash),...(mail.CcFull||[]).map(t=>t.MailboxHash),...(mail.BccFull||[]).map(t=>t.MailboxHash)].filter(Boolean);
  const route=hashes.map(parseMailboxHash).find(Boolean);
  const companyId=route&&await companyByKey(env.DB,route.company);
  if(!companyId||!mail.MessageID)return json({ignored:true});
  const owner='company:'+companyId;
  const from=String(mail.FromFull?.Email||mail.From||'').toLowerCase();
  if(!emailPattern.test(from))return json({ignored:true});
  if(await one(env.DB,'SELECT id FROM jobs WHERE dedupe = ?','email:'+mail.MessageID))return json({duplicate:true});
  const attachments=[];
  for(const a of (mail.Attachments||[]).slice(0,10)){
    try{
      const bytes=Uint8Array.from(atob(a.Content||''),c=>c.charCodeAt(0));
      const file=await storeFile(env,owner,{name:safeName(a.Name),type:a.ContentType||'application/octet-stream',bytes,source:'email'});
      if(file)attachments.push(file);
    }catch{/* Unreadable attachments are skipped. */}
  }
  const text=String(mail.StrippedTextReply||mail.TextBody||String(mail.HtmlBody||'').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,'').replace(/<br\s*\/?>|<\/p>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ')).trim().slice(0,20000);
  await enqueue(env.DB,{owner,kind:'email.inbound',dedupe:'email:'+mail.MessageID,payload:{messageId:String(mail.MessageID),from,fromName:String(mail.FromFull?.Name||mail.FromName||'').slice(0,80),subject:String(mail.Subject||'(no subject)').slice(0,250),text,thread:route.thread,attachments}});
  const work=runJobs(env).catch(error=>console.error('job run failed',error));
  if(ctx?.waitUntil)ctx.waitUntil(work);else await work;
  return json({ok:true});
}
function applyInboundEmail(state,e){
  const key='email:'+e.messageId;
  if(state.providerEvents.includes(key))return null;
  state.providerEvents.push(key);
  let contact=state.contacts.find(c=>String(c.email||'').toLowerCase()===e.from);
  if(!contact){contact={id:smsId(),name:e.fromName||e.from,type:'Other',email:e.from,phone:'',property:'',unit:'',optout:false,verified:false};state.contacts.push(contact);}
  const clean=value=>String(value||'').replace(/^((re|fw|fwd|aw)\s*:\s*)+/i,'').trim().toLowerCase();
  let thread=e.thread&&state.threads.find(t=>t.channel==='Email'&&t.id.replace(/-/g,'').startsWith(e.thread));
  if(!thread)thread=state.threads.find(t=>t.contact===contact.id&&t.channel==='Email'&&clean(t.subject)===clean(e.subject));
  if(!thread){
    thread={id:smsId(),contact:contact.id,subject:e.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i,'')||'(no subject)',channel:'Email',priority:'Normal',status:'Open',assigned:'',unread:true,updated:smsTime(),labels:[],followUp:'',automationPaused:false,messages:[]};
    state.threads.push(thread);
  }
  const message={id:smsId(),kind:'in',body:e.text||(e.attachments?.length?'Sent attachments.':'(No text content)'),time:smsTime(),source:'Email',subject:e.subject,providerId:e.messageId,...(e.attachments?.length?{attachments:e.attachments}:{})};
  thread.messages.push(message);
  thread.updated=message.time;thread.unread=true;thread.status='Open';
  const {reply,pendingAck}=runIntake(state,{thread,contact,message,text:`${e.subject||''}\n${e.text||''}`,channel:'Email',acknowledge:state.settings.liveEmailReplies,sourceId:key,ai:e.ai,deferAck:e.deferAck});
  return {thread,contact,reply,pendingAck};
}
async function emailEvents(request,env,url){
  if(!await webhookAllowed(request,env,url))return new Response('Forbidden',{status:403});
  let event;
  try{event=JSON.parse(await request.text());}catch{return new Response('Invalid payload',{status:400});}
  const owner=event.Metadata?.owner,messageId=event.Metadata?.message;
  if(!owner||!/^company:[a-f0-9-]{36}$/.test(owner)||!messageId)return json({ignored:true});
  const status={Delivery:'delivered',Bounce:'failed',SpamComplaint:'failed'}[event.RecordType];
  if(!status)return json({ignored:true});
  await updateSmsWorkspace(env,owner,state=>{
    let changed=recordSmsDelivery(state,messageId,status,event.MessageID,event.RecordType==='Bounce'?`bounce:${event.Type||''}`:event.RecordType==='SpamComplaint'?'spam-complaint':undefined);
    if(event.RecordType!=='Delivery'){
      const email=String(event.Email||event.Recipient||'').toLowerCase();
      const contact=state.contacts.find(c=>String(c.email||'').toLowerCase()===email);
      if(contact&&event.RecordType==='SpamComplaint'&&!contact.optout){contact.optout=true;changed=true;smsAudit(state,'Email spam complaint · contact opted out');}
      if(contact&&event.RecordType==='Bounce'&&/HardBounce|BadEmailAddress/i.test(event.Type||'')&&!contact.emailBounced){contact.emailBounced=true;changed=true;smsAudit(state,'Email address bounced');}
    }
    return {changed};
  }).catch(()=>{});
  return json({ok:true});
}

/* ---------- System email queue (retried by the job runner) ---------- */
async function rememberOrigin(db,url){
  if(globalThis.__hhOrigin===url.origin)return;
  globalThis.__hhOrigin=url.origin;
  await putSetting(db,'app_origin',url.origin).catch(()=>{});
}
async function queueEmail(db,{to,subject,heading,paragraphs,cta=null,dedupe=null}){
  if(!to)return false;
  const origin=(await settingsMap(db)).app_origin||'';
  const link=cta?{label:cta.label,url:/^https?:/.test(cta.url)?cta.url:origin?origin+cta.url:''}:null;
  return enqueue(db,{owner:'system',kind:'email.system',dedupe,payload:{to,subject,heading:heading||subject,paragraphs,cta:link?.url?link:null}});
}
JOB_HANDLERS['email.system']=async(env,p)=>{
  const cfg=await emailConfig(env).catch(()=>null);
  if(!cfg)return; // Email isn't set up: links stay available on screen instead.
  const result=await postmarkSend(cfg,{to:p.to,subject:p.subject,
    text:[p.heading,...p.paragraphs,p.cta?`${p.cta.label}: ${p.cta.url}`:'','— HushHawk Property Connect'].filter(Boolean).join('\n\n'),
    html:emailHtml({heading:p.heading,paragraphs:p.paragraphs,cta:p.cta}),fromName:'HushHawk',metadata:{kind:'system'}});
  if(result.status!=='sent')throw new Error(result.error||'Email provider error');
};
async function emailSuperAdmins(db,subject,paragraphs,url){
  const s=await settingsMap(db);
  const to=(s.alert_email||'').trim()?[s.alert_email.trim()]:(await all(db,"SELECT email FROM users WHERE role = 'super_admin' AND status = 'active'")).map(r=>r.email);
  for(const address of to)await queueEmail(db,{to:address,subject,paragraphs,cta:{label:'Open the console',url}});
}
async function emailCompanyOwner(db,companyId,{subject,paragraphs,cta,billing=false,dedupe=null}){
  const to=billing?await companyBillingEmail(db,companyId):(await one(db,"SELECT email FROM users WHERE company_id = ? AND role = 'owner'",companyId))?.email;
  return queueEmail(db,{to,subject,paragraphs,cta,dedupe});
}
