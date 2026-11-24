// Subscriptions, invoices, payments (bank transfer and Stripe Checkout), company profile,
// team logins with invites, and password resets.
const COMPANY_ROLES=['owner','admin','manager','agent','maintenance','finance','viewer'];
const ACCESS_STATUSES=['trialing','active','past_due'];
const DAY=864e5;
const isoPlus=(iso,{days=0,months=0}={})=>{const d=new Date(iso);if(months)d.setUTCMonth(d.getUTCMonth()+months);return new Date(d.getTime()+days*DAY).toISOString();};
const tokenPair=async()=>{const token=hex(crypto.getRandomValues(new Uint8Array(32)));return {token,hash:await sha256(token)};};

/* Permissions */
async function companyUser(env,user,{roles=COMPANY_ROLES,needsAccess=false,feature=''}={}){
  if(!user?.company_id||!COMPANY_ROLES.includes(user.role))acctFail('Sign in to your company account.',401);
  if(!roles.includes(user.role))acctFail(roles.includes('admin')?'Only your company owner or an admin can do this.':'Only the company owner can do this.',403);
  const me=await meFor(env.DB,user);
  if(me.company?.status!=='active')acctFail('Your company account isn’t active.',403);
  if(needsAccess&&!me.access)acctFail('Your subscription isn’t active. The company owner can renew it in Billing.',402);
  if(feature&&!me.entitlements.features[feature])acctFail('This feature isn’t included in your plan.',403);
  return me;
}

/* Subscription state */
function subscriptionOut(row){
  return {status:row.sub_status||'none',periodStart:row.period_start,periodEnd:row.period_end,cancelAtPeriodEnd:Boolean(row.cancel_at_period_end),
    pendingPlanId:row.pending_plan_id||null,hadTrial:Boolean(row.had_trial)};
}
async function nextInvoiceNumber(db){
  const s=await settingsMap(db);
  const seq=Number(s.invoice_seq||0)+1;
  await putSetting(db,'invoice_seq',seq);
  return `${s.invoice_prefix||'HH'}-${new Date().getUTCFullYear()}-${String(seq).padStart(4,'0')}`;
}
async function createInvoice(db,{companyId,plan,kind,start,end,lines,dueAt}){
  const id=acctId(),total=lines.reduce((n,l)=>n+l.cents,0),number=await nextInvoiceNumber(db);
  await exec(db,'INSERT INTO invoices (id,company_id,number,kind,plan_id,plan_name,period,period_end,lines,total_cents,status,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id,companyId,number,kind,plan?.id||null,plan?.name||'',start,end||null,JSON.stringify(lines),total,'sent',dueAt||acctNow(),acctNow(),acctNow());
  if(total>0)await emailCompanyOwner(db,companyId,{billing:true,subject:`Invoice ${number} · $${(total/100).toFixed(2)}`,
    paragraphs:[`A new HushHawk invoice is ready: ${lines.map(l=>l.label).join('; ')}.`,`Total: $${(total/100).toFixed(2)}. Due ${new Date(dueAt||acctNow()).toDateString()}.`],cta:{label:'View and pay',url:'/#billing'}});
  return id;
}
const shortDate=iso=>new Date(iso).toISOString().slice(0,10);
async function overageLines(db,company,plan){
  if(plan?.overage!=='allow'||!company.period_start)return [];
  const s=await settingsMap(db),lines=[];
  const usage=await all(db,"SELECT kind, SUM(quantity) AS qty FROM usage_events WHERE company_id = ? AND at >= ? AND at < ? AND status = 'ok' GROUP BY kind",company.id,company.period_start,company.period_end);
  const used=kinds=>usage.filter(r=>kinds.includes(r.kind)).reduce((n,r)=>n+(r.qty||0),0);
  for(const [key,label,rate] of [['sms','Extra text messages',Number(s.overage_sms_cents||0)],['ai','Extra AI replies',Number(s.overage_ai_cents||0)]]){
    const limit=Number(plan.quotas?.[key]||0),extra=limit?Math.max(0,used(QUOTA_KINDS[key])-limit):0;
    if(extra&&rate)lines.push({label:`${label} · ${extra} × ${rate}¢`,cents:extra*rate});
  }
  return lines;
}
// Moves one company's subscription forward in time: trial ends, renewals, grace periods, cancellations.
async function syncSubscription(env,companyId){
  const db=env.DB,now=acctNow();
  const c=await one(db,'SELECT * FROM companies WHERE id = ?',companyId);
  if(!c||!c.plan_id||!c.period_end)return;
  const grace=Number((await settingsMap(db)).billing_grace_days||7);
  const set=(fields)=>exec(db,`UPDATE companies SET ${Object.keys(fields).map(k=>k+' = ?').join(', ')} WHERE id = ?`,...Object.values(fields),c.id);
  if(['trialing','active'].includes(c.sub_status)&&c.cancel_at_period_end&&now>=c.period_end){
    await set({sub_status:'canceled',cancel_at_period_end:0});
    await audit(db,'Billing','Subscription ended (canceled)',c.name);
    return;
  }
  if(['trialing','active','past_due'].includes(c.sub_status)&&!c.cancel_at_period_end){
    const renewalDue=c.sub_status==='trialing'?now>=c.period_end:now>=isoPlus(c.period_end,{days:-7});
    if(renewalDue&&!await one(db,"SELECT id FROM invoices WHERE company_id = ? AND kind = 'renewal' AND period = ? AND status != 'void'",c.id,c.period_end)){
      const plan=planOut(await one(db,'SELECT * FROM plans WHERE id = ?',c.pending_plan_id||c.plan_id));
      const current=planOut(await one(db,'SELECT * FROM plans WHERE id = ?',c.plan_id));
      const lines=[{label:`${plan.name} plan · ${shortDate(c.period_end)} to ${shortDate(isoPlus(c.period_end,{months:1}))}`,cents:plan.priceCents},...(c.sub_status==='trialing'?[]:await overageLines(db,c,current))];
      await createInvoice(db,{companyId:c.id,plan,kind:'renewal',start:c.period_end,end:isoPlus(c.period_end,{months:1}),lines,dueAt:c.period_end});
      await audit(db,'Billing',c.sub_status==='trialing'?'Trial ended · first invoice issued':'Renewal invoice issued',c.name);
    }
  }
  if(['trialing','active'].includes(c.sub_status)&&now>=c.period_end){
    await set({sub_status:'past_due'});
    await emailCompanyOwner(db,c.id,{billing:true,subject:'Payment overdue for your HushHawk subscription',paragraphs:[`The invoice for ${c.name} is now due. Please pay it within ${grace} days to keep your workspace running.`],cta:{label:'Pay now',url:'/#billing'},dedupe:`pastdue:${c.id}:${c.period_end}`});
  }
  else if(c.sub_status==='past_due'&&now>=isoPlus(c.period_end,{days:grace})){
    await set({sub_status:'unpaid'});
    await audit(db,'Billing','Subscription unpaid · access paused',c.name);
    await emailCompanyOwner(db,c.id,{billing:true,subject:'Your HushHawk workspace is paused',paragraphs:[`Access to ${c.name} is paused because an invoice is unpaid. Pay it to open the workspace again. Your records are safe.`],cta:{label:'Pay now',url:'/#pay'},dedupe:`unpaid:${c.id}:${c.period_end}`});
  }
}
async function syncAll(env){
  for(const row of await all(env.DB,"SELECT id FROM companies WHERE plan_id IS NOT NULL AND sub_status IN ('trialing','active','past_due')"))await syncSubscription(env,row.id);
}
async function markInvoicePaid(env,invoiceId,{method,reference='',actor}){
  const db=env.DB;
  const inv=await one(db,'SELECT * FROM invoices WHERE id = ?',invoiceId);
  if(!inv)acctFail('Invoice not found.',404);
  if(inv.status==='paid')return inv;
  if(inv.status==='void')acctFail('This invoice was voided.');
  const now=acctNow();
  await exec(db,"UPDATE invoices SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?",now,now,inv.id);
  await exec(db,'INSERT INTO payments (id,company_id,invoice_id,amount_cents,method,reference,recorded_by,at) VALUES (?,?,?,?,?,?,?,?)',acctId(),inv.company_id,inv.id,inv.total_cents,method,String(reference).slice(0,120),actor,now);
  const c=await one(db,'SELECT * FROM companies WHERE id = ?',inv.company_id);
  if(inv.kind==='subscription'){
    await exec(db,"UPDATE companies SET sub_status = 'active', plan_id = ?, pending_plan_id = NULL, period_start = ?, period_end = ?, cancel_at_period_end = 0 WHERE id = ?",inv.plan_id||c.plan_id,now,isoPlus(now,{months:1}),c.id);
  }else if(inv.kind==='renewal'){
    const start=inv.period,end=inv.period_end||isoPlus(inv.period,{months:1});
    const later=c.period_end&&c.period_end>end;
    if(!later)await exec(db,"UPDATE companies SET sub_status = 'active', plan_id = ?, pending_plan_id = NULL, period_start = ?, period_end = ? WHERE id = ?",inv.plan_id||c.plan_id,start,end,c.id);
  }else if(inv.kind==='upgrade'&&['past_due','unpaid'].includes(c.sub_status)&&c.period_end>now){
    await exec(db,"UPDATE companies SET sub_status = 'active' WHERE id = ?",c.id);
  }
  await audit(db,actor,`Payment recorded · ${inv.number} · ${method.replace('_',' ')}`,c.name);
  if(inv.total_cents>0)await emailCompanyOwner(db,c.id,{billing:true,subject:`Payment received · ${inv.number}`,paragraphs:[`Thank you. We received $${(inv.total_cents/100).toFixed(2)} for invoice ${inv.number}.`]});
  return inv;
}

/* Company: plan choice, cancellation, profile */
async function choosePlanV2(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner']}),input=await readJson(request,url),db=env.DB;
  const plan=planOut(await one(db,'SELECT * FROM plans WHERE id = ? AND active = 1',text(input.planId,60)));
  if(!plan)acctFail('Choose an available plan.');
  const c=await one(db,'SELECT * FROM companies WHERE id = ?',me.company.id);
  const status=c.sub_status||'none';
  const users=(await one(db,"SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND status = 'active'",c.id)).n;
  const workspace=await loadWorkspace(db,c.id);
  const fits=()=>{
    if(plan.seats&&users>plan.seats)acctFail(`${plan.name} includes ${plan.seats} team seats and you have ${users} people. Remove some in Team first.`);
    if(plan.properties&&workspace&&workspace.properties.length>plan.properties)acctFail(`${plan.name} includes ${plan.properties} properties and you have ${workspace.properties.length}. Remove some first.`);
  };
  let result='switched',invoiceId=null;
  if(['none','canceled','unpaid','pending_payment'].includes(status)){
    fits();
    await exec(db,"UPDATE invoices SET status = 'void', updated_at = ? WHERE company_id = ? AND status = 'sent' AND kind IN ('subscription','renewal','upgrade')",acctNow(),c.id);
    if(plan.trialDays&&!c.had_trial){
      await exec(db,"UPDATE companies SET plan_id = ?, pending_plan_id = NULL, sub_status = 'trialing', period_start = ?, period_end = ?, had_trial = 1, cancel_at_period_end = 0 WHERE id = ?",plan.id,acctNow(),isoPlus(acctNow(),{days:plan.trialDays}),c.id);
      result='trial';
    }else{
      await exec(db,"UPDATE companies SET plan_id = ?, pending_plan_id = NULL, sub_status = 'pending_payment', cancel_at_period_end = 0 WHERE id = ?",plan.id,c.id);
      invoiceId=await createInvoice(db,{companyId:c.id,plan,kind:'subscription',start:acctNow(),end:isoPlus(acctNow(),{months:1}),lines:[{label:`${plan.name} plan · first month`,cents:plan.priceCents}],dueAt:isoPlus(acctNow(),{days:7})});
      result=plan.priceCents?'payment':'payment';
      if(!plan.priceCents){await markInvoicePaid(env,invoiceId,{method:'free',actor:user.email});result='active';}
    }
  }else if(status==='trialing'){
    if(plan.id===c.plan_id)acctFail('You’re already on this plan.');
    fits();
    await exec(db,'UPDATE companies SET plan_id = ?, pending_plan_id = NULL WHERE id = ?',plan.id,c.id);
  }else{
    if(plan.id===c.plan_id&&!c.pending_plan_id)acctFail('You’re already on this plan.');
    const current=planOut(await one(db,'SELECT * FROM plans WHERE id = ?',c.plan_id));
    if(plan.id===c.plan_id){await exec(db,'UPDATE companies SET pending_plan_id = NULL WHERE id = ?',c.id);result='kept';}
    else if(plan.priceCents>current.priceCents){
      const total=new Date(c.period_end)-new Date(c.period_start),left=Math.max(0,new Date(c.period_end)-Date.now());
      const amount=Math.round((plan.priceCents-current.priceCents)*(total?left/total:1));
      await exec(db,'UPDATE companies SET plan_id = ?, pending_plan_id = NULL WHERE id = ?',plan.id,c.id);
      if(amount>0)invoiceId=await createInvoice(db,{companyId:c.id,plan,kind:'upgrade',start:acctNow(),end:c.period_end,lines:[{label:`Upgrade ${current.name} → ${plan.name} · rest of period to ${shortDate(c.period_end)}`,cents:amount}],dueAt:isoPlus(acctNow(),{days:7})});
      result='upgraded';
    }else{
      fits();
      await exec(db,'UPDATE companies SET pending_plan_id = ? WHERE id = ?',plan.id,c.id);
      result='scheduled';
    }
  }
  await audit(db,user.email,{trial:`Started a ${plan.trialDays}-day trial of ${plan.name}`,payment:`Chose ${plan.name} · awaiting payment`,active:`Subscribed to ${plan.name}`,switched:`Switched to ${plan.name}`,upgraded:`Upgraded to ${plan.name}`,scheduled:`Scheduled switch to ${plan.name}`,kept:`Kept ${plan.name}`}[result],me.company.name);
  return json({...await meFor(db,user),result,invoiceId});
}
async function subscriptionAction(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner']}),input=await readJson(request,url),db=env.DB;
  const c=await one(db,'SELECT * FROM companies WHERE id = ?',me.company.id);
  if(input.action==='cancel'){
    if(!['trialing','active','past_due'].includes(c.sub_status))acctFail('There’s no active subscription to cancel.');
    await exec(db,'UPDATE companies SET cancel_at_period_end = 1 WHERE id = ?',c.id);
    await audit(db,user.email,'Canceled subscription at period end',c.name);
  }else if(input.action==='resume'){
    await exec(db,'UPDATE companies SET cancel_at_period_end = 0 WHERE id = ?',c.id);
    await audit(db,user.email,'Resumed subscription',c.name);
  }else if(input.action==='keep-plan'){
    await exec(db,'UPDATE companies SET pending_plan_id = NULL WHERE id = ?',c.id);
    await audit(db,user.email,'Canceled scheduled plan change',c.name);
  }else acctFail('Unknown action.');
  return json(await meFor(db,user));
}
const PROFILE_FIELDS={phone:40,website:200,address:200,city:80,region:80,postalCode:20,country:60,units:10,billingEmail:254,timezone:60};
async function companyProfile(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner','admin']}),input=await readJson(request,url),db=env.DB;
  const profile={};
  for(const [key,max] of Object.entries(PROFILE_FIELDS))profile[key]=text(input[key],max);
  if(profile.billingEmail&&!emailPattern.test(profile.billingEmail))acctFail('Enter a valid billing email.');
  if(profile.units&&!/^\d+$/.test(profile.units))acctFail('Units must be a number.');
  const name=text(input.name,80);
  if(name.length<2)acctFail('Enter your company name.');
  await exec(db,'UPDATE companies SET name = ?, profile = ? WHERE id = ?',name,JSON.stringify(profile),me.company.id);
  await audit(db,user.email,'Updated company profile',name);
  return json(await meFor(db,user));
}

/* Payments: Stripe Checkout (card) */
async function stripeKey(env){return getSecret(env,'stripe_secret_key').catch(()=> '');}
async function stripeRequest(env,method,path,form){
  const key=await stripeKey(env);
  if(!key)acctFail('Card payments aren’t set up yet. Use the bank transfer details on the invoice.',409);
  let response,data={};
  try{
    response=await fetch('https://api.stripe.com/v1'+path,{method,headers:{Authorization:'Bearer '+key,...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:form?new URLSearchParams(form):undefined,signal:AbortSignal.timeout(15000)});
    data=await response.json().catch(()=>({}));
  }catch{acctFail('Couldn’t reach the payment provider. Try again.',504);}
  if(!response.ok)acctFail('Payment provider error: '+(data.error?.message||response.status),502);
  return data;
}
async function checkout(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner']}),input=await readJson(request,url);
  const inv=await one(env.DB,"SELECT * FROM invoices WHERE id = ? AND company_id = ?",text(input.invoiceId,60),me.company.id);
  if(!inv)acctFail('Invoice not found.',404);
  if(inv.status!=='sent')acctFail('This invoice isn’t open for payment.');
  const s=await settingsMap(env.DB);
  const session=await stripeRequest(env,'POST','/checkout/sessions',{
    mode:'payment',customer_email:user.email,client_reference_id:me.company.id,
    'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(inv.total_cents),
    'line_items[0][price_data][product_data][name]':`${s.seller_name||'HushHawk'} · invoice ${inv.number}`,
    'metadata[invoice_id]':inv.id,'metadata[company_id]':me.company.id,'payment_intent_data[metadata][invoice_id]':inv.id,
    success_url:url.origin+'/#billing/paid?session={CHECKOUT_SESSION_ID}',cancel_url:url.origin+'/#billing'});
  return json({url:session.url});
}
async function confirmCheckout(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner']}),input=await readJson(request,url);
  const id=text(input.sessionId,200);
  if(!/^cs_[A-Za-z0-9_]+$/.test(id))acctFail('Invalid payment session.');
  const session=await stripeRequest(env,'GET','/checkout/sessions/'+encodeURIComponent(id));
  if(session.client_reference_id!==me.company.id)acctFail('This payment belongs to another account.',403);
  if(session.payment_status!=='paid')return json({paid:false,...await meFor(env.DB,user)});
  await markInvoicePaid(env,session.metadata?.invoice_id,{method:'card',reference:session.payment_intent||session.id,actor:'Stripe'});
  return json({paid:true,...await meFor(env.DB,user)});
}
async function stripeWebhook(request,env){
  const secret=await getSecret(env,'stripe_webhook_secret').catch(()=> '');
  if(!secret)return new Response('Stripe webhook is not configured',{status:503});
  const payload=await request.text(),header=request.headers.get('Stripe-Signature')||'';
  const t=header.match(/t=(\d+)/)?.[1],signatures=[...header.matchAll(/v1=([a-f0-9]+)/g)].map(m=>m[1]);
  if(!t||!signatures.length||Math.abs(Date.now()/1000-Number(t))>300)return new Response('Invalid signature',{status:400});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`)));
  if(!signatures.some(sig=>sameText(sig,expected)))return new Response('Invalid signature',{status:400});
  let event;
  try{event=JSON.parse(payload);}catch{return new Response('Invalid payload',{status:400});}
  const session=event.data?.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&session?.payment_status==='paid'&&session.metadata?.invoice_id){
    try{await markInvoicePaid(env,session.metadata.invoice_id,{method:'card',reference:session.payment_intent||session.id,actor:'Stripe'});}
    catch(error){if(error.status!==404)throw error;}
  }
  return new Response('ok');
}

/* Team: invites, members, password resets */
async function inviteMember(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner','admin']}),input=await readJson(request,url),db=env.DB;
  const email=text(input.email,254).toLowerCase(),role=COMPANY_ROLES.includes(input.role)&&input.role!=='owner'?input.role:'agent';
  if(!emailPattern.test(email))acctFail('Enter a valid email.');
  if(role==='admin'&&user.role!=='owner')acctFail('Only the company owner can invite admins.',403);
  if(role!=='agent'&&!me.entitlements.features.team)acctFail('Roles other than Communication agent are included in plans with Advanced roles.',403);
  if(await one(db,'SELECT id FROM users WHERE email = ?',email))acctFail('Someone with this email already has a HushHawk account.');
  const seats=me.entitlements.seats;
  const used=(await one(db,"SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND status = 'active'",me.company.id)).n+
    (await one(db,'SELECT COUNT(*) AS n FROM invites WHERE company_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?',me.company.id,acctNow())).n;
  if(seats&&used>=seats)acctFail(`Your ${me.plan.name} plan includes ${seats} team seats and they’re all used or invited. Upgrade in Billing to add more.`,402);
  await exec(db,'UPDATE invites SET revoked_at = ? WHERE company_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL',acctNow(),me.company.id,email);
  const {token,hash}=await tokenPair();
  await exec(db,'INSERT INTO invites (id,company_id,email,role,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',acctId(),me.company.id,email,role,hash,user.email,acctNow(),isoPlus(acctNow(),{days:7}));
  await audit(db,user.email,`Invited ${email} as ${role}`,me.company.name);
  const emailed=Boolean(await emailConfig(env).catch(()=>null))&&await queueEmail(db,{to:email,subject:`${user.name} invited you to ${me.company.name} on HushHawk`,paragraphs:[`${user.name} invited you to join ${me.company.name} as ${role==='admin'?'an admin':'a team member'}.`,'The link works once and expires in 7 days.'],cta:{label:'Join the team',url:url.origin+'/#invite/'+token}});
  return json({link:url.origin+'/#invite/'+token,emailed,team:await teamOf(db,me.company.id)});
}
async function teamOf(db,companyId){
  return {users:await all(db,'SELECT id, name, email, role, status, mfa_enabled AS mfaEnabled, created_at AS createdAt, last_login AS lastLogin FROM users WHERE company_id = ? ORDER BY created_at',companyId),
    invites:await all(db,'SELECT id, email, role, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt FROM invites WHERE company_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',companyId,acctNow())};
}
async function syncWorkspaceTeam(env,companyId){
  const owner='company:'+companyId;
  const people=await all(env.DB,'SELECT id, name, email, role, status FROM users WHERE company_id = ?',companyId);
  if(!await one(env.DB,'SELECT owner_id FROM workspace_meta WHERE owner_id = ?',owner))return;
  const label={owner:'Company Owner',...ROLE_LABELS};
  await updateSmsWorkspace(env,owner,state=>{
    let changed=false;
    for(const p of people){
      const row=state.team.find(t=>t.id===p.id||t.email===p.email);
      const next={id:p.id,name:p.name,email:p.email,role:label[p.role]||p.role,status:p.status==='active'?'Active':'Inactive'};
      if(!row){state.team.push(next);changed=true;}
      else if(Object.entries(next).some(([k,v])=>row[k]!==v)){Object.assign(row,next);changed=true;}
    }
    for(const row of state.team)if(!people.some(p=>p.id===row.id||p.email===row.email)&&row.status!=='Inactive'){row.status='Inactive';changed=true;}
    return {changed};
  });
}
async function memberAction(request,env,url,user){
  const me=await companyUser(env,user,{roles:['owner','admin']}),input=await readJson(request,url),db=env.DB;
  if(input.action==='revoke-invite'){
    await exec(db,'UPDATE invites SET revoked_at = ? WHERE id = ? AND company_id = ?',acctNow(),text(input.id,60),me.company.id);
    await audit(db,user.email,'Revoked an invite',me.company.name);
    return json({team:await teamOf(db,me.company.id)});
  }
  const member=await one(db,'SELECT * FROM users WHERE id = ? AND company_id = ?',text(input.id,60),me.company.id);
  if(!member)acctFail('Team member not found.',404);
  if(member.role==='owner')acctFail('The company owner can’t be changed here.');
  if(member.role==='admin'&&user.role!=='owner')acctFail('Only the company owner can change admins.',403);
  let link=null;
  if(input.action==='role'){
    if(user.role!=='owner')acctFail('Only the company owner can change roles.',403);
    const role=COMPANY_ROLES.includes(input.role)&&input.role!=='owner'?input.role:'agent';
    if(role!=='agent'&&!me.entitlements.features.team)acctFail('Roles other than Communication agent are included in plans with Advanced roles.',403);
    await exec(db,'UPDATE users SET role = ? WHERE id = ?',role,member.id);
    await audit(db,user.email,`Changed ${member.email} to ${role}`,me.company.name);
  }else if(input.action==='disable'||input.action==='enable'){
    if(input.action==='enable'){
      const seats=me.entitlements.seats,active=(await one(db,"SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND status = 'active'",me.company.id)).n;
      if(seats&&active>=seats)acctFail(`All ${seats} seats are in use. Upgrade in Billing to add more.`,402);
    }
    await exec(db,'UPDATE users SET status = ? WHERE id = ?',input.action==='disable'?'disabled':'active',member.id);
    if(input.action==='disable')await exec(db,'DELETE FROM sessions WHERE user_id = ?',member.id);
    await audit(db,user.email,`${input.action==='disable'?'Disabled':'Re-enabled'} ${member.email}`,me.company.name);
  }else if(input.action==='remove'){
    await exec(db,'DELETE FROM sessions WHERE user_id = ?',member.id);
    await exec(db,'DELETE FROM users WHERE id = ?',member.id);
    await audit(db,user.email,`Removed ${member.email}`,me.company.name);
  }else if(input.action==='reset-link'){
    link=await resetLink(db,url,member.id,user.email);
    await audit(db,user.email,`Created a password reset link for ${member.email}`,me.company.name);
  }else acctFail('Unknown action.');
  await syncWorkspaceTeam(env,me.company.id);
  return json({link,team:await teamOf(db,me.company.id)});
}
async function resetLink(db,url,userId,actor){
  const {token,hash}=await tokenPair();
  await exec(db,'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL',acctNow(),userId);
  await exec(db,'INSERT INTO password_resets (token_hash,user_id,created_by,expires_at) VALUES (?,?,?,?)',hash,userId,actor,isoPlus(acctNow(),{days:2}));
  const target=await one(db,'SELECT email, name FROM users WHERE id = ?',userId);
  await queueEmail(db,{to:target?.email,subject:'Reset your HushHawk password',paragraphs:[`Hi ${target?.name||''}, a password reset link was created for your account.`,'It works once and expires in 2 days. If you didn’t ask for this, you can ignore this email.'],cta:{label:'Choose a new password',url:url.origin+'/#reset/'+token}});
  return url.origin+'/#reset/'+token;
}
async function inviteInfo(env,url){
  const token=url.searchParams.get('token')||'';
  if(!/^[a-f0-9]{64}$/.test(token))acctFail('This invite link isn’t valid.',404);
  const row=await one(env.DB,'SELECT i.*, c.name AS company FROM invites i JOIN companies c ON c.id = i.company_id WHERE i.token_hash = ?',await sha256(token));
  if(!row||row.revoked_at)acctFail('This invite was canceled. Ask for a new one.',404);
  if(row.accepted_at)acctFail('This invite was already used. Sign in instead.',410);
  if(row.expires_at<acctNow())acctFail('This invite has expired. Ask for a new one.',410);
  return row;
}
async function acceptInvite(request,env,url){
  const input=await readJson(request,url);
  const fake=new URL(url);fake.searchParams.set('token',String(input.token||''));
  const invite=await inviteInfo(env,fake),db=env.DB;
  const name=text(input.name,80),password=String(input.password||'');
  if(!name)acctFail('Enter your name.');
  if(password.length<10||password.length>200)acctFail('Use a password of at least 10 characters.');
  if(input.acceptTerms!==true)acctFail('Please accept the Terms of Service and Privacy Policy.');
  if(await one(db,'SELECT id FROM users WHERE email = ?',invite.email))acctFail('An account with this email already exists. Sign in instead.',409);
  const id=acctId(),salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  await exec(db,'INSERT INTO users (id,company_id,email,name,role,password_hash,password_salt,created_at,last_login,terms_accepted_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,invite.company_id,invite.email,name,invite.role,await hashPassword(password,salt),salt,acctNow(),acctNow(),acctNow());
  await exec(db,'UPDATE invites SET accepted_at = ? WHERE id = ?',acctNow(),invite.id);
  await audit(db,invite.email,'Joined the team',invite.company);
  await syncWorkspaceTeam(env,invite.company_id);
  const cookie=await startSession(db,url,id,true);
  return json(await meFor(db,await one(db,'SELECT * FROM users WHERE id = ?',id)),201,{'Set-Cookie':cookie});
}
async function resetInfo(env,token){
  if(!/^[a-f0-9]{64}$/.test(token))acctFail('This reset link isn’t valid.',404);
  const row=await one(env.DB,'SELECT r.*, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?',await sha256(token));
  if(!row||row.used_at)acctFail('This reset link was already used or replaced. Ask for a new one.',410);
  if(row.expires_at<acctNow())acctFail('This reset link has expired. Ask for a new one.',410);
  return row;
}
async function resetPassword(request,env,url){
  const input=await readJson(request,url),row=await resetInfo(env,String(input.token||'')),db=env.DB;
  const password=String(input.password||'');
  if(password.length<10||password.length>200)acctFail('Use a password of at least 10 characters.');
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  await exec(db,'UPDATE users SET password_hash = ?, password_salt = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',await hashPassword(password,salt),salt,row.user_id);
  await exec(db,'UPDATE password_resets SET used_at = ? WHERE token_hash = ?',acctNow(),row.token_hash);
  await exec(db,'DELETE FROM sessions WHERE user_id = ?',row.user_id);
  await audit(db,row.email,'Reset password');
  const cookie=await startSession(db,url,row.user_id,true);
  return json(await meFor(db,await one(db,'SELECT * FROM users WHERE id = ?',row.user_id)),200,{'Set-Cookie':cookie});
}
async function changePassword(request,env,url,user){
  if(!user)acctFail('Sign in first.',401);
  const input=await readJson(request,url),db=env.DB;
  if(!sameText(await hashPassword(String(input.current||''),user.password_salt),user.password_hash))acctFail('Your current password isn’t right.',400);
  const next=String(input.next||'');
  if(next.length<10||next.length>200)acctFail('Use a new password of at least 10 characters.');
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  await exec(db,'UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?',await hashPassword(next,salt),salt,user.id);
  await exec(db,'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',user.id,await sha256(cookieValue(request)));
  await audit(db,user.email,'Changed password');
  return json({ok:true});
}

/* Super admin: subscriptions, users, billing settings */
async function superSubscription(env,input,actor,url){
  const db=env.DB,c=await one(db,'SELECT * FROM companies WHERE id = ?',text(input.companyId,60));
  if(!c)acctFail('Company not found.',404);
  const plan=input.planId?planOut(await one(db,'SELECT * FROM plans WHERE id = ?',text(input.planId,60))):null;
  if(input.planId&&!plan)acctFail('Choose an existing plan.');
  const now=acctNow();
  switch(input.action){
    case 'mark-paid':{
      const inv=await one(db,'SELECT id FROM invoices WHERE id = ? AND company_id = ?',text(input.invoiceId,60),c.id);
      if(!inv)acctFail('Invoice not found.',404);
      const method=['bank_transfer','card','cash','check','other'].includes(input.method)?input.method:'other';
      await markInvoicePaid(env,inv.id,{method,reference:text(input.reference,120),actor:actor.email});break;}
    case 'void-invoice':
      await exec(db,"UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ? AND company_id = ? AND status = 'sent'",now,text(input.invoiceId,60),c.id);
      await audit(db,actor.email,'Voided an invoice',c.name);break;
    case 'activate':{
      const p=plan||planOut(await one(db,'SELECT * FROM plans WHERE id = ?',c.plan_id));
      if(!p)acctFail('Choose a plan.');
      const months=Math.min(36,Math.max(1,Math.floor(Number(input.months)||1)));
      await exec(db,"UPDATE companies SET plan_id = ?, pending_plan_id = NULL, sub_status = 'active', period_start = ?, period_end = ?, cancel_at_period_end = 0 WHERE id = ?",p.id,now,isoPlus(now,{months}),c.id);
      await exec(db,"UPDATE invoices SET status = 'void', updated_at = ? WHERE company_id = ? AND status = 'sent' AND kind IN ('subscription','renewal')",now,c.id);
      await audit(db,actor.email,`Activated ${p.name} manually for ${months} month${months===1?'':'s'}${input.reason?` · ${text(input.reason,120)}`:''}`,c.name);break;}
    case 'change-plan':
      if(!plan)acctFail('Choose a plan.');
      await exec(db,'UPDATE companies SET plan_id = ?, pending_plan_id = NULL WHERE id = ?',plan.id,c.id);
      await audit(db,actor.email,`Moved to ${plan.name} (no charge)`,c.name);break;
    case 'extend':{
      if(!c.period_end)acctFail('This company has no billing period to extend.');
      const days=Math.min(365,Math.max(1,Math.floor(Number(input.days)||0)));
      const end=isoPlus(c.period_end>now?c.period_end:now,{days});
      await exec(db,`UPDATE companies SET period_end = ?, sub_status = CASE WHEN sub_status IN ('past_due','unpaid') THEN 'active' ELSE sub_status END WHERE id = ?`,end,c.id);
      await audit(db,actor.email,`Extended billing period by ${days} days`,c.name);break;}
    case 'cancel-now':
      await exec(db,"UPDATE companies SET sub_status = 'canceled', cancel_at_period_end = 0 WHERE id = ?",c.id);
      await exec(db,"UPDATE invoices SET status = 'void', updated_at = ? WHERE company_id = ? AND status = 'sent'",now,c.id);
      await audit(db,actor.email,'Canceled subscription immediately',c.name);break;
    case 'invoice':{
      const cents=Math.round(Number(input.amountCents));
      const label=text(input.description,160);
      if(!label||!Number.isFinite(cents)||cents<=0)acctFail('Add a description and an amount.');
      await createInvoice(db,{companyId:c.id,plan:null,kind:'manual',start:now,lines:[{label,cents}],dueAt:isoPlus(now,{days:Math.max(0,Number(input.dueDays)||7)})});
      await audit(db,actor.email,'Created an invoice',c.name);break;}
    case 'user':{
      const member=await one(db,'SELECT * FROM users WHERE id = ? AND company_id = ?',text(input.userId,60),c.id);
      if(!member)acctFail('User not found.',404);
      if(input.op==='reset-link'){
        const link=await resetLink(db,url,member.id,actor.email);
        await audit(db,actor.email,`Created a password reset link for ${member.email}`,c.name);
        return {link};
      }
      if(input.op==='reset-mfa'){
        await exec(db,"UPDATE users SET mfa_enabled = 0, mfa_secret = '', mfa_pending = '', mfa_recovery = '[]' WHERE id = ?",member.id);
        await exec(db,'DELETE FROM sessions WHERE user_id = ?',member.id);
        await audit(db,actor.email,`Reset two-step sign-in for ${member.email}`,c.name);
        break;
      }
      if(!['disable','enable'].includes(input.op))acctFail('Unknown action.');
      await exec(db,'UPDATE users SET status = ? WHERE id = ?',input.op==='disable'?'disabled':'active',member.id);
      if(input.op==='disable')await exec(db,'DELETE FROM sessions WHERE user_id = ?',member.id);
      await audit(db,actor.email,`${input.op==='disable'?'Disabled':'Re-enabled'} ${member.email}`,c.name);
      await syncWorkspaceTeam(env,c.id);break;}
    case 'delete-now':
      if(input.confirm!==c.name)acctFail('Type the company name exactly to confirm.');
      await purgeCompany(env,c.id,actor.email);break;
    default:acctFail('Unknown action.');
  }
  return null;
}
async function superBillingSettings(env,input,actor){
  const db=env.DB;
  for(const [field,key,max] of [['sellerName','seller_name',120],['sellerDetails','seller_details',600],['paymentInstructions','payment_instructions',1200],['invoicePrefix','invoice_prefix',8]])
    if(input[field]!==undefined)await putSetting(db,key,text(input[field],max)||(key==='invoice_prefix'?'HH':''));
  if(input.graceDays!==undefined){const n=Math.floor(Number(input.graceDays));if(!(n>=0&&n<=60))acctFail('Grace period must be 0 to 60 days.');await putSetting(db,'billing_grace_days',n);}
  if(input.stripeKey){const key=String(input.stripeKey).trim();if(!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))acctFail('Stripe secret keys start with sk_test_ or sk_live_.');await putSecret(env,'stripe_secret_key',key);}
  if(input.stripeWebhookSecret){const key=String(input.stripeWebhookSecret).trim();if(!/^whsec_[A-Za-z0-9]+$/.test(key))acctFail('Stripe webhook secrets start with whsec_.');await putSecret(env,'stripe_webhook_secret',key);}
  for(const key of input.clear||[])if(['stripe_secret_key','stripe_webhook_secret'].includes(key))await exec(db,'DELETE FROM secrets WHERE key = ?',key);
  await audit(db,actor.email,'Updated billing settings');
}
async function billingSettingsOut(env){
  const s=await settingsMap(env.DB);
  const hints=Object.fromEntries((await all(env.DB,"SELECT key, hint FROM secrets WHERE key LIKE 'stripe_%'")).map(r=>[r.key,r.hint]));
  return {sellerName:s.seller_name||'',sellerDetails:s.seller_details||'',paymentInstructions:s.payment_instructions||'',invoicePrefix:s.invoice_prefix||'HH',graceDays:Number(s.billing_grace_days||7),
    stripeKey:hints.stripe_secret_key||null,stripeWebhookSecret:hints.stripe_webhook_secret||null};
}
const paymentOut=r=>({id:r.id,companyId:r.company_id,invoiceId:r.invoice_id,amountCents:r.amount_cents,method:r.method,reference:r.reference,recordedBy:r.recorded_by,at:r.at});

/* Routing */
async function billingApi(request,env,url){
  const path=url.pathname,db=env.DB;
  if(path==='/api/stripe/webhook'&&request.method==='POST')return stripeWebhook(request,env);
  if(path==='/api/auth/invite'&&request.method==='GET'){const row=await inviteInfo(env,url);return json({company:row.company,email:row.email,role:row.role});}
  if(path==='/api/auth/reset'&&request.method==='GET'){const row=await resetInfo(env,url.searchParams.get('token')||'');return json({email:row.email});}
  if(request.method!=='POST')return null;
  if(path==='/api/auth/accept-invite')return acceptInvite(request,env,url);
  if(path==='/api/auth/reset')return resetPassword(request,env,url);
  const user=await currentUser(request,db);
  if(path==='/api/auth/change-password')return changePassword(request,env,url,user);
  if(path==='/api/company/plan')return choosePlanV2(request,env,url,user);
  if(path==='/api/company/subscription')return subscriptionAction(request,env,url,user);
  if(path==='/api/company/profile')return companyProfile(request,env,url,user);
  if(path==='/api/company/invite')return inviteMember(request,env,url,user);
  if(path==='/api/company/member')return memberAction(request,env,url,user);
  if(path==='/api/billing/checkout')return checkout(request,env,url,user);
  if(path==='/api/billing/confirm')return confirmCheckout(request,env,url,user);
  return null;
}
