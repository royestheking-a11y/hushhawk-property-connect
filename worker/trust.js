// Trust and launch: two-step sign-in (TOTP), roles, rate limits, data export, retention and
// deletion, public pricing and demo requests, and security headers.

/* ---------- Rate limiting ---------- */
const clientIp=request=>request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')?.split(',')[0].trim()||'local';
async function rateLimit(db,key,limit,windowSeconds,message='Too many attempts. Please wait a few minutes and try again.'){
  const now=Math.floor(Date.now()/1000),bucket=now-(now%windowSeconds),id=`${key}:${bucket}`;
  await exec(db,'INSERT INTO rate_limits (key,count,window_start) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1',id,bucket);
  const row=await one(db,'SELECT count FROM rate_limits WHERE key = ?',id);
  if(row.count>limit)acctFail(message,429);
  if(Math.random()<0.02)await exec(db,'DELETE FROM rate_limits WHERE window_start < ?',now-86400);
}

/* ---------- Sealed values (MFA secrets) ---------- */
async function sealText(env,plain){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},await secretsKey(env),new TextEncoder().encode(plain));
  return 'v1.'+b64(iv)+'.'+b64(sealed);
}
async function openText(env,value){
  const [,iv,data]=String(value).split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await secretsKey(env),unb64(data)));
}

/* ---------- TOTP (RFC 6238, 30 s, 6 digits) ---------- */
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes){let bits='',out='';for(const b of bytes)bits+=b.toString(2).padStart(8,'0');for(let i=0;i+5<=bits.length;i+=5)out+=B32[parseInt(bits.slice(i,i+5),2)];return out;}
function unbase32(text){let bits='';for(const c of text.replace(/=+$/,'').toUpperCase()){const v=B32.indexOf(c);if(v<0)continue;bits+=v.toString(2).padStart(5,'0');}const out=[];for(let i=0;i+8<=bits.length;i+=8)out.push(parseInt(bits.slice(i,i+8),2));return new Uint8Array(out);}
async function totpAt(secret,step){
  const key=await crypto.subtle.importKey('raw',unbase32(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const counter=new ArrayBuffer(8),view=new DataView(counter);
  view.setUint32(0,Math.floor(step/2**32));view.setUint32(4,step>>>0);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,counter)),offset=mac[19]&15;
  const code=((mac[offset]&127)<<24|mac[offset+1]<<16|mac[offset+2]<<8|mac[offset+3])%1e6;
  return String(code).padStart(6,'0');
}
// Returns the matched time step, or 0. Accepts one step either side for clock drift.
async function checkTotp(secret,code,lastStep=0){
  if(!/^\d{6}$/.test(String(code||'').trim()))return 0;
  const now=Math.floor(Date.now()/30000);
  for(const step of [now,now-1,now+1])if(step>lastStep&&sameText(await totpAt(secret,step),String(code).trim()))return step;
  return 0;
}
async function mfaRequired(db,user){
  if(user.role==='super_admin')return (await settingsMap(db)).require_mfa_super==='1';
  if(!['owner','admin'].includes(user.role))return false;
  return Boolean((await one(db,'SELECT require_mfa FROM companies WHERE id = ?',user.company_id))?.require_mfa);
}
async function startMfaChallenge(db,userId,remember){
  const {token,hash}=await tokenPair();
  await exec(db,'INSERT INTO mfa_challenges (token_hash,user_id,remember,expires_at) VALUES (?,?,?,?)',hash,userId,remember?1:0,new Date(Date.now()+10*60e3).toISOString());
  return token;
}
async function mfaVerify(request,env,url){
  const db=env.DB,input=await readJson(request,url);
  await rateLimit(db,'mfa:'+clientIp(request),30,600);
  const token=String(input.challenge||'');
  const challenge=/^[a-f0-9]{64}$/.test(token)&&await one(db,'SELECT * FROM mfa_challenges WHERE token_hash = ?',await sha256(token));
  if(!challenge||challenge.expires_at<acctNow())acctFail('This sign-in step expired. Sign in again.',401);
  if(challenge.attempts>=5){await exec(db,'DELETE FROM mfa_challenges WHERE token_hash = ?',challenge.token_hash);acctFail('Too many wrong codes. Sign in again.',429);}
  await exec(db,'UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?',challenge.token_hash);
  const user=await one(db,'SELECT * FROM users WHERE id = ?',challenge.user_id);
  if(!user||user.status==='disabled')acctFail('This account is turned off.',403);
  let ok=false;
  const code=String(input.code||'').replace(/\s|-/g,'');
  if(/^\d{6}$/.test(code)){
    const step=await checkTotp(await openText(env,user.mfa_secret),code,user.mfa_last_step);
    if(step){ok=true;await exec(db,'UPDATE users SET mfa_last_step = ? WHERE id = ?',step,user.id);}
  }else if(/^[a-z0-9]{10}$/i.test(code)){
    const hashes=JSON.parse(user.mfa_recovery||'[]'),hash=await sha256(code.toLowerCase());
    if(hashes.includes(hash)){ok=true;await exec(db,'UPDATE users SET mfa_recovery = ? WHERE id = ?',JSON.stringify(hashes.filter(h=>h!==hash)),user.id);await audit(db,user.email,'Signed in with a recovery code');}
  }
  if(!ok)acctFail('That code isn’t right. Check your authenticator app and try again.',401);
  await exec(db,'DELETE FROM mfa_challenges WHERE token_hash = ?',challenge.token_hash);
  await exec(db,'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?',acctNow(),user.id);
  const cookie=await startSession(db,url,user.id,Boolean(challenge.remember));
  return json(await meFor(db,user),200,{'Set-Cookie':cookie});
}
async function mfaSetup(request,env,url,user){
  if(!user)acctFail('Sign in first.',401);
  const secret=base32(crypto.getRandomValues(new Uint8Array(20)));
  await exec(env.DB,'UPDATE users SET mfa_pending = ? WHERE id = ?',await sealText(env,secret),user.id);
  const label=encodeURIComponent(`HushHawk:${user.email}`);
  return json({secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=HushHawk&algorithm=SHA1&digits=6&period=30`});
}
async function mfaEnable(request,env,url,user){
  if(!user)acctFail('Sign in first.',401);
  const input=await readJson(request,url);
  if(!user.mfa_pending)acctFail('Start setup again.');
  const secret=await openText(env,user.mfa_pending),step=await checkTotp(secret,input.code);
  if(!step)acctFail('That code isn’t right. Make sure your phone’s clock is set automatically and try the newest code.');
  const codes=Array.from({length:10},()=>base32(crypto.getRandomValues(new Uint8Array(7))).slice(0,10).toLowerCase());
  await exec(env.DB,"UPDATE users SET mfa_enabled = 1, mfa_secret = mfa_pending, mfa_pending = '', mfa_last_step = ?, mfa_recovery = ? WHERE id = ?",step,JSON.stringify(await Promise.all(codes.map(sha256))),user.id);
  await exec(env.DB,'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',user.id,await sha256(cookieValue(request)));
  await audit(env.DB,user.email,'Turned on two-step sign-in');
  return json({recoveryCodes:codes});
}
async function mfaDisable(request,env,url,user){
  if(!user)acctFail('Sign in first.',401);
  const input=await readJson(request,url);
  if(await mfaRequired(env.DB,user))acctFail('Two-step sign-in is required for your role and can’t be turned off.',403);
  if(!sameText(await hashPassword(String(input.password||''),user.password_salt),user.password_hash))acctFail('Your password isn’t right.');
  await exec(env.DB,"UPDATE users SET mfa_enabled = 0, mfa_secret = '', mfa_recovery = '[]' WHERE id = ?",user.id);
  await audit(env.DB,user.email,'Turned off two-step sign-in');
  return json({ok:true});
}

/* ---------- Roles ---------- */
const ROLE_LABELS={owner:'Owner',admin:'Admin',manager:'Property manager',agent:'Communication agent',maintenance:'Maintenance coordinator',finance:'Finance',viewer:'Viewer'};
const ALL_WORKSPACE='*';
const WRITE_SCOPE={owner:ALL_WORKSPACE,admin:ALL_WORKSPACE,manager:ALL_WORKSPACE,
  agent:['threads','contacts','tasks','approvals','calls','scheduled','events','audit','runs','providerEvents','leads'],
  maintenance:['tickets','tasks','events','threads','audit','runs'],finance:['audit'],viewer:[]};
const canWrite=(role,collection)=>WRITE_SCOPE[role]===ALL_WORKSPACE||(collection!=='_meta'&&(WRITE_SCOPE[role]||[]).includes(collection));
const SENDERS=['owner','admin','manager','agent','maintenance'];

/* ---------- Data export, retention and deletion ---------- */
async function companyExport(env,user){
  const me=await companyUser(env,user,{roles:['owner','admin']}),db=env.DB,id=me.company.id,owner='company:'+id;
  const company=await one(db,'SELECT id, name, status, plan_id, created_at, profile, retention_months FROM companies WHERE id = ?',id);
  const docs=await all(db,'SELECT id, title, file_name, version, updated_at FROM knowledge_docs WHERE owner_id = ?',owner);
  for(const doc of docs)doc.text=(await all(db,'SELECT text FROM knowledge_chunks WHERE doc_id = ? ORDER BY seq',doc.id)).map(r=>r.text).join('\n\n');
  const data={exportedAt:acctNow(),exportedBy:user.email,company:{...company,profile:JSON.parse(company.profile||'{}')},
    users:await all(db,'SELECT name, email, role, status, created_at, last_login FROM users WHERE company_id = ?',id),
    workspace:(await loadState(db,owner))?.state||null,knowledgeDocuments:docs,
    invoices:(await all(db,'SELECT * FROM invoices WHERE company_id = ?',id)).map(invoiceOut),
    payments:(await all(db,'SELECT * FROM payments WHERE company_id = ?',id)).map(paymentOut),
    support:(await all(db,'SELECT * FROM support_requests WHERE company_id = ?',id)).map(supportOut),
    files:await all(db,'SELECT id, name, type, size, source, created_at FROM files WHERE owner_id = ?',owner)};
  await audit(db,user.email,'Exported company data',me.company.name);
  return new Response(JSON.stringify(data,null,2),{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="hushhawk-export-${acctNow().slice(0,10)}.json"`,'Cache-Control':'no-store'}});
}
async function companySecurity(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner','admin']}),input=await readJson(request,url),db=env.DB,id=me.company.id;
  if(input.requireMfa!==undefined)await exec(db,'UPDATE companies SET require_mfa = ? WHERE id = ?',input.requireMfa?1:0,id);
  if(input.retentionMonths!==undefined){
    const months=Number(input.retentionMonths);
    if(![0,12,24,36,60,84].includes(months))acctFail('Choose a retention period.');
    await exec(db,'UPDATE companies SET retention_months = ? WHERE id = ?',months,id);
  }
  if(input.action==='request-deletion'){
    if(user.role!=='owner')acctFail('Only the company owner can delete the company.',403);
    if(input.confirm!==me.company.name)acctFail('Type the company name exactly to confirm.');
    await exec(db,'UPDATE companies SET deletion_requested_at = ?, cancel_at_period_end = 1 WHERE id = ?',acctNow(),id);
    await emailSuperAdmins(db,`Deletion requested: ${me.company.name}`,[`${user.email} asked to delete ${me.company.name}. It will be deleted automatically in 30 days unless canceled.`],'/#super/companies/'+id);
  }
  if(input.action==='cancel-deletion')await exec(db,'UPDATE companies SET deletion_requested_at = NULL WHERE id = ?',id);
  await audit(db,user.email,input.action==='request-deletion'?'Requested company deletion (30 days)':input.action==='cancel-deletion'?'Canceled company deletion':'Updated security and data settings',me.company.name);
  return json(await meFor(db,user));
}
// Permanently removes a company's workspace data and people. Invoices and payments are kept for accounting.
async function purgeCompany(env,companyId,actor){
  const db=env.DB,owner='company:'+companyId;
  const company=await one(db,'SELECT name FROM companies WHERE id = ?',companyId);
  if(!company)return;
  const fileIds=(await all(db,'SELECT id, storage FROM files WHERE owner_id = ?',owner));
  if(env.FILES?.delete)for(const f of fileIds.filter(f=>f.storage==='r2'))await env.FILES.delete(`${owner}/${f.id}`).catch(()=>{});
  const users=(await all(db,'SELECT id FROM users WHERE company_id = ?',companyId)).map(r=>r.id);
  const statements=[
    env_prepare(db,'DELETE FROM records WHERE owner_id = ?',owner),env_prepare(db,'DELETE FROM messages WHERE owner_id = ?',owner),
    env_prepare(db,'DELETE FROM workspace_meta WHERE owner_id = ?',owner),env_prepare(db,'DELETE FROM admin_workspaces WHERE owner_id = ?',owner),
    env_prepare(db,'DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE owner_id = ?)',owner),env_prepare(db,'DELETE FROM files WHERE owner_id = ?',owner),
    env_prepare(db,'DELETE FROM knowledge_chunks WHERE owner_id = ?',owner),env_prepare(db,'DELETE FROM knowledge_docs WHERE owner_id = ?',owner),
    env_prepare(db,'DELETE FROM ai_runs WHERE owner_id = ?',owner),env_prepare(db,'DELETE FROM jobs WHERE owner_id = ?',owner),
    env_prepare(db,'DELETE FROM invites WHERE company_id = ?',companyId),env_prepare(db,'DELETE FROM support_requests WHERE company_id = ?',companyId),
    env_prepare(db,'DELETE FROM number_requests WHERE company_id = ?',companyId),env_prepare(db,'UPDATE phone_numbers SET company_id = NULL, assigned_at = NULL WHERE company_id = ?',companyId),
    ...users.flatMap(u=>[env_prepare(db,'DELETE FROM sessions WHERE user_id = ?',u),env_prepare(db,'DELETE FROM password_resets WHERE user_id = ?',u),env_prepare(db,'DELETE FROM mfa_challenges WHERE user_id = ?',u)]),
    env_prepare(db,'DELETE FROM users WHERE company_id = ?',companyId),
    env_prepare(db,"UPDATE companies SET status = 'deleted', sub_status = 'canceled', profile = '{}', notes = '', overrides = '{}', deletion_requested_at = NULL WHERE id = ?",companyId)
  ];
  await runBatch(db,statements);
  await audit(db,actor,'Permanently deleted company data',company.name);
}
async function applyRetentionAndDeletion(env){
  const db=env.DB;
  for(const c of await all(db,'SELECT id FROM companies WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at < ?',new Date(Date.now()-30*864e5).toISOString()))
    await purgeCompany(env,c.id,'Scheduled deletion');
  for(const c of await all(db,"SELECT id, retention_months FROM companies WHERE retention_months > 0 AND status != 'deleted'")){
    const cutoff=new Date();cutoff.setUTCMonth(cutoff.getUTCMonth()-c.retention_months);
    const owner='company:'+c.id,iso=cutoff.toISOString();
    await exec(db,"DELETE FROM messages WHERE owner_id = ? AND time != '' AND time < ?",owner,iso);
    await exec(db,'DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE owner_id = ? AND created_at < ?)',owner,iso);
    await exec(db,'DELETE FROM files WHERE owner_id = ? AND created_at < ?',owner,iso);
  }
}

/* ---------- Public: pricing and demo requests ---------- */
async function publicPlans(env){
  const db=env.DB;
  const plans=(await all(db,'SELECT * FROM plans WHERE active = 1 ORDER BY sort, price_cents')).map(planOut);
  return json({catalog:FEATURES,plans:plans.map(p=>({name:p.name,priceCents:p.priceCents,description:p.description,support:p.support,features:p.features,seats:p.seats,properties:p.properties,quotas:p.quotas,trialDays:p.trialDays}))},200,{'Cache-Control':'public, max-age=300'});
}
async function publicLead(request,env,url){
  const db=env.DB,input=await readJson(request,url,20000);
  await rateLimit(db,'lead:'+clientIp(request),5,3600,'Thanks! We already have your request. We’ll be in touch soon.');
  if(input.website)return json({ok:true}); // Hidden field: bots fill it in.
  const name=text(input.name,80),email=text(input.email,254).toLowerCase();
  if(!name)acctFail('Enter your name.');
  if(!emailPattern.test(email))acctFail('Enter a valid email.');
  const lead={id:acctId(),name,email,company:text(input.company,120),phone:text(input.phone,40),units:text(input.units,20),message:text(input.message,2000)};
  await exec(db,'INSERT INTO leads (id,name,email,company,phone,units,message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',lead.id,lead.name,lead.email,lead.company,lead.phone,lead.units,lead.message,acctNow(),acctNow());
  await emailSuperAdmins(db,`New demo request: ${lead.company||lead.name}`,[`${lead.name} <${lead.email}>${lead.phone?' · '+lead.phone:''}`,`${lead.company||'No company given'}${lead.units?` · ${lead.units} units`:''}`,lead.message||'(no message)'],'/#super/leads');
  await queueEmail(db,{to:lead.email,subject:'Thanks for your interest in HushHawk Property Management',paragraphs:[`Hi ${lead.name}, thanks for asking about HushHawk Property Management. We’ll reply within one business day to set up a walkthrough.`,'In the meantime you can try the interactive demo with fictional data.'],cta:{label:'Open the demo',url:url.origin+'/#demo'}});
  return json({ok:true});
}

/* ---------- Security headers for pages and assets ---------- */
function securityHeaders(url,extra={}){
  return {'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    ...(url.protocol==='https:'?{'Strict-Transport-Security':'max-age=31536000; includeSubDomains'}:{}),...extra};
}

/* ---------- Routing ---------- */
async function trustApi(request,env,url){
  const path=url.pathname,db=env.DB;
  if(path==='/api/public/plans'&&request.method==='GET')return publicPlans(env);
  if(path==='/api/public/lead'&&request.method==='POST')return publicLead(request,env,url);
  if(path==='/api/auth/mfa'&&request.method==='POST')return mfaVerify(request,env,url);
  const user=await currentUser(request,db);
  if(path==='/api/company/export'&&request.method==='GET')return companyExport(env,user);
  if(request.method!=='POST')return null;
  if(path==='/api/auth/mfa-setup')return mfaSetup(request,env,url,user);
  if(path==='/api/auth/mfa-enable')return mfaEnable(request,env,url,user);
  if(path==='/api/auth/mfa-disable')return mfaDisable(request,env,url,user);
  if(path==='/api/auth/signout-all'){
    if(!user)acctFail('Sign in first.',401);
    await exec(db,'DELETE FROM sessions WHERE user_id = ?',user.id);
    await audit(db,user.email,'Signed out of all devices');
    return json({ok:true},200,{'Set-Cookie':sessionCookie(url,'',0)});
  }
  if(path==='/api/company/security')return companySecurity(request,env,url,user);
  return null;
}
