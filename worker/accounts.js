// Accounts, sessions, plans and the super admin API.
// Mirrored by scripts/dev_server.py for local preview; keep the two in step.
const FEATURES=[
  ['inbox','Unified inbox','SMS, email, calls and voicemail in one timeline'],
  ['voice','Voice center','Call log, voicemail transcripts and callback tasks'],
  ['ai','AI-drafted replies','Suggested replies with human approval'],
  ['automations','Automation rules','Rules that label, route and create tickets'],
  ['maintenance','Maintenance & tasks','Tickets, tasks and calendar'],
  ['templates','Templates & knowledge','Approved answers and policies'],
  ['analytics','Reports & analytics','Activity and workload reports'],
  ['integrations','Integrations & import','Provider connections and portfolio import'],
  ['team','Advanced roles','Admins, property managers, maintenance, finance and viewer roles']
];
const FEATURE_KEYS=FEATURES.map(([key])=>key);
const SESSION_COOKIE='hh_session';
const PBKDF2_ITERATIONS=100000;
const emailPattern=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const acctNow=()=>new Date().toISOString();
const acctId=()=>crypto.randomUUID();
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex=text=>Uint8Array.from(text.match(/../g)||[],pair=>parseInt(pair,16));
async function sha256(text){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
async function hashPassword(password,saltHex){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(saltHex),iterations:PBKDF2_ITERATIONS},key,256));
}
function sameText(a,b){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const acctFail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};

async function all(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results||[];}
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const exec=(db,sql,...args)=>db.prepare(sql).bind(...args).run();

async function settingsOf(db){
  const rows=await all(db,'SELECT key, value FROM platform_settings');
  const map=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  return {aiAvailable:map.ai_available!=='0',signupsOpen:map.signups_open!=='0',requireApproval:map.require_approval!=='0',requireMfaSuper:map.require_mfa_super==='1'};
}
const planOut=row=>row&&({id:row.id,name:row.name,priceCents:row.price_cents,description:row.description,support:row.support,
  features:JSON.parse(row.features).filter(key=>FEATURE_KEYS.includes(key)),seats:row.seats,properties:row.properties,active:Boolean(row.active),sort:row.sort,
  quotas:JSON.parse(row.quotas||'{}'),overage:row.overage||'block',trialDays:row.trial_days||0});
function entitlements(plan,overrides,settings){
  const features=Object.fromEntries(FEATURE_KEYS.map(key=>{
    let on=Boolean(plan?.features.includes(key));
    if(overrides[key]==='on')on=true;
    if(overrides[key]==='off')on=false;
    if(key==='ai'&&!settings.aiAvailable)on=false;
    return [key,on];
  }));
  return {features,seats:plan?.seats??0,properties:plan?.properties??0,support:plan?.support||'',quotas:plan?.quotas||{},overage:plan?.overage||'block'};
}
async function audit(db,actor,action,target=''){
  await exec(db,'INSERT INTO platform_audit (id,at,actor,action,target) VALUES (?,?,?,?,?)',acctId(),acctNow(),actor,action,target);
}

async function bootstrapSuperAdmin(env){
  const email=String(env.HUSHHAWK_SUPER_ADMIN_EMAIL||'').trim().toLowerCase();
  const password=String(env.HUSHHAWK_SUPER_ADMIN_PASSWORD||'');
  if(!email||password.length<12)return;
  if(await one(env.DB,"SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"))return;
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  await exec(env.DB,'INSERT OR IGNORE INTO users (id,company_id,email,name,role,password_hash,password_salt,created_at) VALUES (?,NULL,?,?,?,?,?,?)',
    acctId(),email,'Super admin','super_admin',await hashPassword(password,salt),salt,acctNow());
}

function cookieValue(request){
  const match=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)hh_session=([a-f0-9]{64})/);
  return match?match[1]:'';
}
function sessionCookie(url,token,maxAge){
  const secure=url.protocol==='https:'?'; Secure':'';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge===null?'':'; Max-Age='+maxAge}`;
}
async function startSession(db,url,userId,remember){
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hours=remember?24*30:12;
  await exec(db,'INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',await sha256(token),userId,new Date(Date.now()+hours*3600e3).toISOString(),acctNow());
  return sessionCookie(url,token,remember?hours*3600:null);
}
async function currentUser(request,db){
  const token=cookieValue(request);
  if(!token)return null;
  const row=await one(db,'SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',await sha256(token));
  if(!row||row.expires_at<acctNow()||row.status==='disabled')return null;
  return row;
}
async function meFor(db,user){
  if(!user)return {user:null};
  const settings=await settingsOf(db);
  const base={user:{id:user.id,email:user.email,name:user.name,role:user.role,roleLabel:ROLE_LABELS[user.role]||'Super admin',mfaEnabled:Boolean(user.mfa_enabled),mfaRequired:await mfaRequired(db,user),recoveryCodesLeft:JSON.parse(user.mfa_recovery||'[]').length},platform:{aiAvailable:settings.aiAvailable},catalog:FEATURES};
  if(user.role==='super_admin')return base;
  await syncSubscription({DB:db},user.company_id);
  const company=await one(db,'SELECT * FROM companies WHERE id = ?',user.company_id);
  const plan=company?.plan_id?planOut(await one(db,'SELECT * FROM plans WHERE id = ?',company.plan_id)):null;
  const plans=(await all(db,'SELECT * FROM plans WHERE active = 1 ORDER BY sort, price_cents')).map(planOut);
  const subscription=company?subscriptionOut(company):null;
  const access=Boolean(company?.status==='active'&&plan&&ACCESS_STATUSES.includes(subscription.status));
  const openInvoices=company&&['owner','finance'].includes(user.role)?(await all(db,"SELECT * FROM invoices WHERE company_id = ? AND status = 'sent' ORDER BY created_at",company.id)).map(invoiceOut):[];
  const pendingPlan=subscription?.pendingPlanId?planOut(await one(db,'SELECT * FROM plans WHERE id = ?',subscription.pendingPlanId)):null;
  return {...base,company:company&&{id:company.id,name:company.name,status:company.status,planId:company.plan_id,createdAt:company.created_at,profile:JSON.parse(company.profile||'{}'),requireMfa:Boolean(company.require_mfa),retentionMonths:company.retention_months||0,deletionRequestedAt:company.deletion_requested_at||null},
    plan,plans,subscription,pendingPlan,access,openInvoices,entitlements:entitlements(plan,JSON.parse(company?.overrides||'{}'),settings)};
}
async function readJson(request,url,maxChars=200000){
  if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))acctFail('Invalid request origin or content type.',403);
  const body=await request.text();
  if(body.length>maxChars)acctFail('Request is too large.',413);
  try{const value=JSON.parse(body);if(value&&typeof value==='object')return value;}catch{}
  acctFail('Invalid request.');
}
const text=(value,max)=>String(value??'').trim().slice(0,max);

async function signup(request,env,url){
  const db=env.DB,input=await readJson(request,url),settings=await settingsOf(db);
  if(!settings.signupsOpen)acctFail('New sign-ups are paused. Contact HushHawk to request access.',403);
  await rateLimit(db,'signup:'+clientIp(request),10,3600);
  if(input.acceptTerms!==true)acctFail('Please accept the Terms of Service and Privacy Policy.');
  const company=text(input.company,80),name=text(input.name,80),email=text(input.email,254).toLowerCase(),password=String(input.password||'');
  if(company.length<2)acctFail('Enter your company name.');
  if(!name)acctFail('Enter your name.');
  if(!emailPattern.test(email))acctFail('Enter a valid work email.');
  if(password.length<10||password.length>200)acctFail('Use a password of at least 10 characters.');
  if(await one(db,'SELECT id FROM users WHERE email = ?',email))acctFail('An account with this email already exists. Sign in instead.',409);
  const companyId=acctId(),userId=acctId(),salt=hex(crypto.getRandomValues(new Uint8Array(16))),at=acctNow();
  const status=settings.requireApproval?'pending':'active';
  await exec(db,'INSERT INTO companies (id,name,status,created_at) VALUES (?,?,?,?)',companyId,company,status,at);
  await exec(db,'INSERT INTO users (id,company_id,email,name,role,password_hash,password_salt,created_at,last_login,terms_accepted_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    userId,companyId,email,name,'owner',await hashPassword(password,salt),salt,at,at,at);
  await audit(db,email,status==='pending'?'Signed up · awaiting approval':'Signed up · approved automatically',company);
  if(status==='pending')await emailSuperAdmins(db,`New company waiting for approval: ${company}`,[`${name} (${email}) signed up ${company} and is waiting for approval.`],'/#super/companies/'+companyId);
  const cookie=await startSession(db,url,userId,true);
  return json(await meFor(db,await one(db,'SELECT * FROM users WHERE id = ?',userId)),201,{'Set-Cookie':cookie});
}
async function login(request,env,url){
  const db=env.DB,input=await readJson(request,url);
  const email=text(input.email,254).toLowerCase(),password=String(input.password||'');
  await rateLimit(db,'login:'+clientIp(request),30,600);
  const user=email&&await one(db,'SELECT * FROM users WHERE email = ?',email);
  if(user?.locked_until&&user.locked_until>acctNow())acctFail('Too many attempts. Try again in 15 minutes.',429);
  const valid=user&&sameText(await hashPassword(password,user.password_salt),user.password_hash);
  if(!valid){
    if(user){
      const failures=user.failed_logins+1;
      await exec(db,'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',failures>=8?0:failures,failures>=8?new Date(Date.now()+15*60e3).toISOString():null,user.id);
    }
    acctFail('That email and password don’t match.',401);
  }
  if(user.status==='disabled')acctFail('This account is turned off. Ask your company owner or HushHawk support.',403);
  if(user.mfa_enabled){
    await exec(db,'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?',user.id);
    return json({mfaRequired:true,challenge:await startMfaChallenge(db,user.id,input.remember!==false)});
  }
  await exec(db,'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = ? WHERE id = ?',acctNow(),user.id);
  await exec(db,'DELETE FROM sessions WHERE expires_at < ?',acctNow());
  const cookie=await startSession(db,url,user.id,input.remember!==false);
  return json(await meFor(db,user),200,{'Set-Cookie':cookie});
}
async function logout(request,env,url){
  const token=cookieValue(request);
  if(token)await exec(env.DB,'DELETE FROM sessions WHERE token_hash = ?',await sha256(token));
  return json({ok:true},200,{'Set-Cookie':sessionCookie(url,'',0)});
}
async function companyWorkspace(request,env,url,user){
  const me=await companyUser(env,user,{needsAccess:true});
  const owner='company:'+me.company.id;
  const extra=request.method==='GET'?{sms:await companySmsStatus(env,me.company.id),emailInbox:await companyEmailStatus(env,me.company.id),members:await all(env.DB,'SELECT id, name, email, role, status FROM users WHERE company_id = ?',me.company.id)}:{};
  return workspaceRoute(request,env,url,owner,{actor:user.email,email:user.email,extra,canWrite:c=>canWrite(user.role,c),limits:me.entitlements.properties?{properties:me.entitlements.properties,planName:me.plan.name}:null});
}

async function superOverview(db){
  const [companies,owners,plans,settings,log,spaces]=await Promise.all([
    all(db,'SELECT * FROM companies ORDER BY created_at DESC'),
    all(db,"SELECT company_id, name, email, last_login FROM users WHERE role = 'owner'"),
    all(db,'SELECT * FROM plans ORDER BY sort, price_cents'),
    settingsOf(db),
    all(db,'SELECT * FROM platform_audit ORDER BY at DESC LIMIT 200'),
    all(db,"SELECT m.owner_id, m.updated_at, (SELECT COUNT(*) FROM records r WHERE r.owner_id = m.owner_id AND r.collection = 'properties') AS properties, (SELECT COUNT(*) FROM records r WHERE r.owner_id = m.owner_id AND r.collection = 'team') AS team, (SELECT COUNT(*) FROM records r WHERE r.owner_id = m.owner_id AND r.collection = 'threads') AS threads FROM workspace_meta m WHERE m.owner_id LIKE 'company:%'")
  ]);
  const usage=Object.fromEntries(spaces.map(row=>[row.owner_id.slice(8),{properties:row.properties,team:row.team,threads:row.threads,updatedAt:row.updated_at}]));
  return {catalog:FEATURES,settings,plans:plans.map(planOut),audit:log,
    companies:companies.map(row=>{
      const owner=owners.find(o=>o.company_id===row.id);
      return {id:row.id,name:row.name,status:row.status,planId:row.plan_id,overrides:JSON.parse(row.overrides),notes:row.notes,createdAt:row.created_at,reviewedAt:row.reviewed_at,reviewedBy:row.reviewed_by,
        profile:JSON.parse(row.profile||'{}'),subscription:subscriptionOut(row),requireMfa:Boolean(row.require_mfa),retentionMonths:row.retention_months||0,deletionRequestedAt:row.deletion_requested_at||null,
        owner:owner?{name:owner.name,email:owner.email,lastLogin:owner.last_login}:null,usage:usage[row.id]||{properties:0,team:0,threads:0,updatedAt:null}};
    })};
}
async function superCompany(db,input,actor){
  const company=await one(db,'SELECT * FROM companies WHERE id = ?',text(input.id,60));
  if(!company)acctFail('Company not found.',404);
  const transitions={approve:'active',reactivate:'active',reject:'rejected',suspend:'suspended'};
  if(transitions[input.action]){
    await exec(db,'UPDATE companies SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?',transitions[input.action],acctNow(),actor.email,company.id);
    if(input.action!=='approve'&&input.action!=='reactivate')
      await exec(db,'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)',company.id);
    await audit(db,actor.email,{approve:'Approved company',reactivate:'Reactivated company',reject:'Rejected company',suspend:'Suspended company'}[input.action],company.name);
    const notes={approve:['Your company has been approved',[`Good news: ${company.name} is approved on HushHawk.`,'Sign in to choose your plan and open your workspace.'],{label:'Choose your plan',url:'/#login'}],
      reactivate:['Your workspace is active again',[`${company.name} has been reactivated. You can sign in again.`],{label:'Sign in',url:'/#login'}],
      reject:['About your HushHawk sign-up',[`We weren’t able to approve ${company.name}. Reply to HushHawk support if you think this is a mistake.`],null],
      suspend:['Your HushHawk workspace is suspended',[`Access to ${company.name} is paused. Contact HushHawk support to restore it. Your records are kept.`],null]}[input.action];
    await emailCompanyOwner(db,company.id,{subject:notes[0],paragraphs:notes[1],cta:notes[2]});
  } else if(input.action==='update'){
    const overrides=Object.fromEntries(Object.entries(input.overrides||{}).filter(([key,value])=>FEATURE_KEYS.includes(key)&&['on','off'].includes(value)));
    await exec(db,'UPDATE companies SET overrides = ?, notes = ?, name = ? WHERE id = ?',JSON.stringify(overrides),text(input.notes,2000),text(input.name,80)||company.name,company.id);
    await audit(db,actor.email,'Updated company access',company.name);
  } else acctFail('Unknown action.');
  return superOverview(db);
}
async function superPlan(db,input,actor){
  const name=text(input.name,60),price=Math.round(Number(input.priceCents));
  if(!name)acctFail('Enter a plan name.');
  if(!Number.isFinite(price)||price<0||price>10000000)acctFail('Enter a valid monthly price.');
  const seats=Math.max(0,Math.floor(Number(input.seats)||0)),properties=Math.max(0,Math.floor(Number(input.properties)||0));
  const features=JSON.stringify(FEATURE_KEYS.filter(key=>(input.features||[]).includes(key)));
  const existing=input.id&&await one(db,'SELECT * FROM plans WHERE id = ?',text(input.id,60));
  const quotas=JSON.stringify({sms:Math.max(0,Math.floor(Number(input.quotas?.sms)||0)),ai:Math.max(0,Math.floor(Number(input.quotas?.ai)||0))});
  const overage=input.overage==='allow'?'allow':'block';
  const trialDays=Math.min(90,Math.max(0,Math.floor(Number(input.trialDays)||0)));
  const values=[name,price,text(input.description,400),text(input.support,200),features,seats,properties,input.active===false?0:1,quotas,overage,trialDays];
  if(existing){
    await exec(db,'UPDATE plans SET name = ?, price_cents = ?, description = ?, support = ?, features = ?, seats = ?, properties = ?, active = ?, quotas = ?, overage = ?, trial_days = ?, updated_at = ? WHERE id = ?',...values,acctNow(),existing.id);
    await audit(db,actor.email,'Updated plan',name);
  } else {
    const slug=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'plan')+'-'+acctId().slice(0,6);
    const sort=((await one(db,'SELECT MAX(sort) AS top FROM plans'))?.top||0)+1;
    await exec(db,'INSERT INTO plans (name,price_cents,description,support,features,seats,properties,active,quotas,overage,trial_days,id,sort,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...values,slug,sort,acctNow());
    await audit(db,actor.email,'Created plan',name);
  }
  return superOverview(db);
}
async function superSettings(db,input,actor){
  for(const [field,key] of [['aiAvailable','ai_available'],['signupsOpen','signups_open'],['requireApproval','require_approval'],['requireMfaSuper','require_mfa_super']]){
    if(typeof input[field]==='boolean')await exec(db,'INSERT INTO platform_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',key,input[field]?'1':'0');
  }
  await audit(db,actor.email,'Updated platform settings');
  return superOverview(db);
}

async function accountsApi(request,env,url){
  if(!env.DB)return json({error:'Account storage is unavailable.'},503);
  try{
    await bootstrapSuperAdmin(env);
    await rememberOrigin(env.DB,url);
    const path=url.pathname;
    if(path==='/api/me'&&request.method==='GET')return json(await meFor(env.DB,await currentUser(request,env.DB)));
    const trust=await trustApi(request,env,url);
    if(trust)return trust;
    const billing=await billingApi(request,env,url);
    if(billing)return billing;
    if(path==='/api/workspace'||path==='/api/workspace/changes')return await companyWorkspace(request,env,url,await currentUser(request,env.DB));
    if(path==='/api/company/email'&&request.method==='POST')return await companyEmail(request,env,url,await currentUser(request,env.DB));
    if(path.startsWith('/api/ai/')){const handled=await aiApi(request,env,url,await currentUser(request,env.DB));if(handled)return handled;}
    if(/^\/api\/(ai\/draft|company\/(overview|sms|number-request|support|support-reply))$/.test(path)){
      const handled=await platformApi(request,env,url,await currentUser(request,env.DB));
      if(handled)return handled;
    }
    if(request.method!=='POST')acctFail('Method unavailable.',405);
    if(path==='/api/auth/signup')return await signup(request,env,url);
    if(path==='/api/auth/login')return await login(request,env,url);
    if(path==='/api/auth/logout')return await logout(request,env,url);
    const user=await currentUser(request,env.DB);
    if(path.startsWith('/api/super/')){
      if(user?.role!=='super_admin')acctFail('Super admin access is required.',403);
      const input=await readJson(request,url);
      if(path==='/api/super/overview')return json(await fullOverview(env));
      if(path==='/api/super/company'){await superCompany(env.DB,input,user);return json(await fullOverview(env));}
      if(path==='/api/super/plan'){await superPlan(env.DB,input,user);return json(await fullOverview(env));}
      if(path==='/api/super/settings'){await superSettings(env.DB,input,user);return json(await fullOverview(env));}
      if(path==='/api/super/subscription'){const extra=await superSubscription(env,input,user,url);return json({...await fullOverview(env),...(extra||{})});}
      if(path==='/api/super/billing-settings'){await superBillingSettings(env,input,user);return json(await fullOverview(env));}
      if(path==='/api/super/billing-run'){await syncAll(env);await audit(env.DB,user.email,'Ran the billing cycle');return json(await fullOverview(env));}
      const handled=await superPlatform(env,path,input,user);
      if(handled)return handled;
    }
    acctFail('Not found.',404);
  }catch(error){
    return json({error:error.status?error.message:'The account service could not complete the request.'},error.status||500);
  }
}
