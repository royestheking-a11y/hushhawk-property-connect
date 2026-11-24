// Company accounts, onboarding, plan selection and the super admin console.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=d=>`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const g={
  arrow:svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back:svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  check:svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x:svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  clock:svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  shield:svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  grid:svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  building:svg('<path d="M4 21V5l8-2v18M12 7l8 2v12M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M3 21h18"/>'),
  layers:svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  sliders:svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  list:svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  out:svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>'),
  plus:svg('<path d="M12 5v14M5 12h14"/>'),
  search:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  lock:svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  spark:svg('<path d="M12 3c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6z"/>'),
  support:svg('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>'),
  people:svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  eye:svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>')
};
const money=cents=>cents%100?`$${(cents/100).toFixed(2)}`:`$${(cents/100).toLocaleString()}`;
const date=value=>value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';
const dateTime=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';
const limit=(n,unit)=>n?`${n} ${unit}`:`Unlimited ${unit}`;
const statusTone={pending:'warn',active:'good',suspended:'bad',rejected:'muted'};
const statusLabel={pending:'Awaiting approval',active:'Active',suspended:'Suspended',rejected:'Rejected'};
const pill=(status)=>`<span class="ac-pill ${statusTone[status]||''}">${esc(statusLabel[status]||status)}</span>`;

export async function api(path,body){
  let response;
  try{
    response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch{throw new Error('Could not reach the HushHawk server. Check your connection.');}
  let result={};
  try{result=await response.json();}catch{
    throw new Error('Accounts need the HushHawk server. Run python3 scripts/dev_server.py for local preview.');
  }
  if(!response.ok)throw new Error(result.error||'Something went wrong. Try again.');
  return result;
}
export async function fetchMe(){
  try{
    const response=await fetch('/api/me',{cache:'no-store'});
    if(!response.ok||!response.headers.get('Content-Type')?.includes('json'))return null;
    const me=await response.json();
    return me.user?me:null;
  }catch{return null;}
}
export const homeRoute=me=>{
  if(!me?.user)return 'login';
  if(me.user.role==='super_admin')return 'super';
  if(me.company?.status!=='active')return 'account';
  if(me.access)return 'dashboard';
  if(me.user.role!=='owner')return 'account';
  return ['pending_payment','unpaid'].includes(me.subscription?.status)&&me.openInvoices.length?'pay':'plans';
};
const go=route=>{location.replace('/#'+route);location.reload();};

/* ---------- Sign up ---------- */
let signupStep=1;
const signupData={company:'',name:'',email:''};
export function signupPage({brand}){
  const steps=['Company','Account','Review'];
  const step=signupStep;
  const body=step===1?`
      <p class="signin-eyebrow">Step 1 of 2</p><h1>Tell us about your company</h1>
      <p class="signin-lede">We set up a private workspace for your team. You can change these details later.</p>
      <form class="signin-form" data-acct-form="signupCompany" novalidate>
        <label class="field" for="su-company"><span>Company name</span><input id="su-company" name="company" required maxlength="80" placeholder="e.g. Riverside Property Group" value="${esc(signupData.company)}" autocomplete="organization" autofocus></label>
        <label class="field" for="su-name"><span>Your name</span><input id="su-name" name="name" required maxlength="80" placeholder="Full name" value="${esc(signupData.name)}" autocomplete="name"></label>
        <div class="admin-login-error" role="alert" hidden></div>
        <button type="submit" class="signin-submit">Continue ${g.arrow}</button>
      </form>`
    :step===2?`
      <p class="signin-eyebrow">Step 2 of 2</p><h1>Create your sign-in</h1>
      <p class="signin-lede">You’ll use this to sign in to <strong>${esc(signupData.company)}</strong>.</p>
      <form class="signin-form" data-acct-form="signupAccount" novalidate>
        <label class="field" for="su-email"><span>Work email</span><input id="su-email" name="email" type="email" required placeholder="you@company.com" value="${esc(signupData.email)}" autocomplete="email" spellcheck="false" autofocus></label>
        <label class="field" for="su-password"><span>Password</span>
          <span class="field-pw"><input id="su-password" name="password" type="password" required minlength="10" placeholder="At least 10 characters" autocomplete="new-password" data-acct-input="strength">
          <button type="button" class="field-reveal" data-acct="reveal" aria-label="Show password" aria-pressed="false">${g.eye}</button></span>
        </label>
        <div class="pw-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div><small class="pw-hint">Use 10 or more characters. A short phrase works well.</small>
        <label class="signin-remember terms"><input type="checkbox" name="acceptTerms" required><span>I agree to the <a href="#terms" target="_blank">Terms of Service</a>, <a href="#privacy" target="_blank">Privacy Policy</a> and <a href="#sms-terms" target="_blank">Messaging Terms</a></span></label>
        <div class="admin-login-error" role="alert" hidden></div>
        <button type="submit" class="signin-submit">Create account</button>
        <button type="button" class="ac-textbtn" data-acct="signupBack">${g.back} Back</button>
      </form>`
    :`
      <div class="su-done">${g.check}</div>
      <p class="signin-eyebrow">Account created</p><h1>You’re on the list</h1>
      <p class="signin-lede">Thanks, ${esc(signupData.name.split(' ')[0])}. Our team reviews every new company before the workspace opens. Once <strong>${esc(signupData.company)}</strong> is approved, you’ll choose a plan and get started.</p>
      <button type="button" class="signin-submit" data-acct="toAccount">View account status ${g.arrow}</button>`;
  return `<main class="signin" id="main">
    <section class="signin-panel">
      <header class="signin-top">${brand()}${step===3?'':'<a class="signin-back" href="#login">Sign in instead</a>'}</header>
      <div class="signin-body">
        <ol class="su-steps" aria-label="Sign-up progress">${steps.map((s,i)=>`<li class="${i+1<step?'done':i+1===step?'on':''}"><span>${i+1<step?g.check:i+1}</span>${s}</li>`).join('')}</ol>
        ${body}
      </div>
      <footer class="signin-foot">${g.lock}<span>Your password is hashed and never stored in plain text</span></footer>
    </section>
    <aside class="signin-art" aria-hidden="true"><div class="art-glow"></div>
      <div class="art-copy"><p class="signin-eyebrow">Getting started</p><h2>From sign-up to your first tenant message.</h2></div>
      <ol class="su-path">
        <li class="${step>=3?'done':'on'}"><b>1</b><div><strong>Create your account</strong><small>Company name, email and password</small></div></li>
        <li class="${step>=3?'on':''}"><b>2</b><div><strong>We approve your company</strong><small>Every new workspace is reviewed</small></div></li>
        <li><b>3</b><div><strong>Choose your plan</strong><small>Pick the features and support you need</small></div></li>
        <li><b>4</b><div><strong>Open your workspace</strong><small>Add properties and start answering tenants</small></div></li>
      </ol>
      <ul class="art-points"><li>${g.check} No card needed to sign up</li><li>${g.check} Change plans any time</li></ul>
    </aside>
  </main>`;
}

/* ---------- Account status (pending / rejected / suspended) ---------- */
export function statusPage(me,{brand}){
  const c=me.company,s=c.status;
  if(s==='active')return `<main class="ac-center" id="main"><header class="ac-top">${brand()}<button class="signin-back" data-acct="logout">${g.out} Sign out</button></header>
    <section class="ac-card status-card"><span class="status-ico pending">${g.lock}</span><h1>${esc(c.name)} isn’t subscribed right now</h1><p>The workspace opens again once your company owner chooses a plan or pays the open invoice. Ask them to sign in and check Billing.</p>
    <div class="status-meta"><div><small>Company</small><strong>${esc(c.name)}</strong></div><div><small>Signed in as</small><strong>${esc(me.user.email)}</strong></div></div><button class="signin-submit" data-acct="refresh">Check again</button></section></main>`;
  const copy={
    pending:['Your account is being reviewed','We’re reviewing '+c.name+'. You’ll be able to choose a plan as soon as it’s approved. Check back here any time.'],
    rejected:['We couldn’t approve this account','Your request for '+c.name+' wasn’t approved. If you think this is a mistake, contact HushHawk support.'],
    suspended:['This workspace is suspended','Access to '+c.name+' is paused. Contact HushHawk support to restore it. Your records are kept safe.']
  }[s]||['Account status','Contact HushHawk support for help with your account.'];
  const steps=[['Account created',date(c.createdAt),'done'],['Company review',s==='pending'?'In progress':statusLabel[s],s==='pending'?'on':'bad'],['Choose your plan','',''],['Open your workspace','','']];
  return `<main class="ac-center" id="main"><header class="ac-top">${brand()}<button class="signin-back" data-acct="logout">${g.out} Sign out</button></header>
    <section class="ac-card status-card">
      <span class="status-ico ${s}">${s==='pending'?g.clock:g.lock}</span>
      <h1>${esc(copy[0])}</h1><p>${esc(copy[1])}</p>
      <ol class="status-steps">${steps.map(([t,sub,state])=>`<li class="${state}"><span>${state==='done'?g.check:state==='bad'?g.x:''}</span><div><strong>${t}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div></li>`).join('')}</ol>
      <div class="status-meta"><div><small>Company</small><strong>${esc(c.name)}</strong></div><div><small>Signed in as</small><strong>${esc(me.user.email)}</strong></div></div>
      ${s==='pending'?`<button class="signin-submit" data-acct="refresh">Check status</button>`:''}
    </section></main>`;
}

/* ---------- Subscription helpers ---------- */
const subLabel={none:'No subscription',trialing:'Free trial',pending_payment:'Awaiting first payment',active:'Active',past_due:'Payment overdue',unpaid:'Paused · unpaid',canceled:'Canceled'};
const subTone={trialing:'good',active:'good',pending_payment:'warn',past_due:'warn',unpaid:'bad',canceled:'muted',none:'muted'};
const subPill=s=>`<span class="ac-pill ${subTone[s]||''}">${esc(subLabel[s]||s)}</span>`;
const overdue=i=>i.status==='sent'&&i.dueAt&&i.dueAt<new Date().toISOString();
const invPill=i=>overdue(i)?'<span class="ac-pill bad">Overdue</span>':`<span class="ac-pill ${{sent:'warn',paid:'good',void:'muted'}[i.status]||''}">${{sent:'Open',paid:'Paid',void:'Void'}[i.status]||esc(i.status)}</span>`;
const kindLabel={subscription:'First month',renewal:'Renewal',upgrade:'Upgrade',manual:'Other'};
const daysLeft=iso=>Math.max(0,Math.ceil((new Date(iso)-Date.now())/864e5));
const trialEligible=(me,plan)=>plan.trialDays>0&&!me.subscription?.hadTrial;
let lastLink='';
const linkBox=(label)=>lastLink?`<div class="link-box"><strong>${label}</strong><code>${esc(lastLink)}</code><button type="button" class="btn" data-acct="copy" data-text="${esc(lastLink)}">Copy link</button><small>Send it yourself by email or chat. It works once.</small></div>`:'';

/* ---------- Plans and payment ---------- */
function planCard(plan,me,{current=false,pending=false,label,note=''}={}){
  const on=new Set(plan.features);
  const starting=['none','canceled','unpaid','pending_payment'].includes(me.subscription?.status||'none');
  const trial=!current&&starting&&trialEligible(me,plan);
  return `<article class="plan${current?' current':''}${pending?' pending':''}">
    <header><h3>${esc(plan.name)}</h3>${current?'<span class="ac-pill good">Current plan</span>':pending?`<span class="ac-pill warn">Starts ${date(me.subscription.periodEnd)}</span>`:trial?`<span class="ac-pill good">${plan.trialDays}-day free trial</span>`:''}</header>
    <p class="plan-price"><strong>${money(plan.priceCents)}</strong><span>/ month</span></p>
    <p class="plan-desc">${esc(plan.description)}</p>
    <div class="plan-limits"><span>${g.people}${limit(plan.seats,'team seats')}</span><span>${g.building}${limit(plan.properties,'properties')}</span><span>${g.list}${plan.quotas?.sms?plan.quotas.sms.toLocaleString()+' texts / month':'Unlimited texts'}</span>${on.has('ai')?`<span>${g.spark}${plan.quotas?.ai?plan.quotas.ai.toLocaleString()+' AI replies / month':'Unlimited AI replies'}</span>`:''}<span>${g.support}${esc(plan.support||'Standard support')}</span></div>
    <ul>${me.catalog.map(([key,name])=>`<li class="${on.has(key)?'':'off'}">${on.has(key)?g.check:g.x}<span>${esc(name)}${key==='ai'&&on.has(key)&&!me.platform.aiAvailable?' <em>(temporarily unavailable)</em>':''}</span></li>`).join('')}</ul>
    ${current||pending?`<button class="plan-btn" disabled>${current?'Your current plan':'Scheduled'}</button>`:`<button class="plan-btn" data-acct="choosePlan" data-id="${esc(plan.id)}">${esc(label||(trial?`Start ${plan.trialDays}-day free trial`:`Choose ${plan.name}`))}</button>`}
    ${note?`<small class="plan-note">${esc(note)}</small>`:''}
  </article>`;
}
export function planPage(me,{brand}){
  const s=me.subscription?.status||'none';
  const intro=s==='canceled'?['Your subscription has ended','Choose a plan to open your workspace again. Your records are kept.']
    :s==='unpaid'?['Choose a plan','Your access is paused for an unpaid invoice. Pay it from the payment page, or pick a different plan.']
    :['Choose your plan','Pick the features and support your team needs. You can change plans later from Billing.'];
  return `<main class="ac-center wide" id="main"><header class="ac-top">${brand()}<div class="ac-top-actions">${me.openInvoices.length?`<a class="signin-back" href="#pay">Payment page</a>`:''}<button class="signin-back" data-acct="logout">${g.out} Sign out</button></div></header>
    <div class="ac-head"><span class="ac-pill good">${g.check} ${esc(me.company.name)} is approved</span><h1>${intro[0]}</h1><p>${intro[1]}</p></div>
    <div class="plan-grid">${me.plans.map(p=>planCard(p,me,{note:trialEligible(me,p)?'No payment now. Your first invoice arrives when the trial ends.':`You’ll pay the first invoice of ${money(p.priceCents)} next.`})).join('')||'<p class="ac-empty">No plans are available yet. Contact HushHawk support.</p>'}</div>
  </main>`;
}
export function payPage(me,{brand},rerender){
  const d=companyData(rerender),seller=d?.seller;
  const s=me.subscription?.status;
  const total=me.openInvoices.reduce((n,i)=>n+i.totalCents,0);
  return `<main class="ac-center wide" id="main"><header class="ac-top">${brand()}<div class="ac-top-actions"><a class="signin-back" href="#plans">Change plan</a><button class="signin-back" data-acct="logout">${g.out} Sign out</button></div></header>
    <div class="ac-head">${subPill(s)}<h1>${s==='unpaid'?'Your workspace is paused':'Complete your payment'}</h1><p>${s==='unpaid'?'Pay the open invoice to open your workspace again. Your records are safe.':`Pay ${money(total)} to start your ${esc(me.plan?.name||'')} plan. Your workspace opens as soon as payment is recorded.`}</p></div>
    <div class="pay-grid">
      <section class="ac-card pay-card"><h2>Amount due</h2>
        ${me.openInvoices.map(i=>`<div class="pay-inv"><div><strong>${esc(i.number)}</strong><small>${i.lines.map(l=>esc(l.label)).join(' · ')}</small></div><strong>${money(i.totalCents)}</strong><div class="pay-actions">${seller?.cardPayments?`<button class="plan-btn" data-acct="payCard" data-id="${i.id}">Pay by card</button>`:''}<a class="btn" href="#invoice/${i.id}">View invoice</a></div></div>`).join('')}
        <button class="ac-textbtn" data-acct="refreshPay">${g.clock} I’ve paid · check again</button>
      </section>
      <section class="ac-card pay-card"><h2>Pay by bank transfer</h2>${seller?`<p class="pay-instr">${esc(seller.instructions||'Contact HushHawk for payment details.')}</p><p class="pay-ref">Reference: <strong>${me.openInvoices.map(i=>esc(i.number)).join(', ')}</strong></p>${seller.details?`<p class="pay-seller">${esc(seller.details)}</p>`:''}`:'<p class="ac-empty">Loading…</p>'}
      ${seller&&!seller.cardPayments?'<p class="bill-note">Card payments aren’t switched on yet.</p>':''}</section>
    </div></main>`;
}
export function invoiceDoc(inv,{seller,company,profile={},canPay=false,back='#billing'}){
  const address=[profile.address,[profile.city,profile.region,profile.postalCode].filter(Boolean).join(', '),profile.country].filter(Boolean);
  return `<div class="inv-tools no-print"><a class="btn" href="${back}">${g.back} Back</a><button class="btn" data-acct="print">Print or save PDF</button>${canPay&&inv.status==='sent'&&seller?.cardPayments?`<button class="btn primary" data-acct="payCard" data-id="${inv.id}">Pay by card</button>`:''}</div>
  <article class="inv-doc">
    <header><div><strong class="inv-seller">${esc(seller?.name||'HushHawk')}</strong>${seller?.details?`<p>${esc(seller.details)}</p>`:''}</div><div class="inv-title"><h1>Invoice</h1><p>${esc(inv.number||'—')}</p>${invPill(inv)}</div></header>
    <div class="inv-meta"><div><small>Billed to</small><strong>${esc(company)}</strong>${address.map(a=>`<span>${esc(a)}</span>`).join('')}${profile.billingEmail?`<span>${esc(profile.billingEmail)}</span>`:''}</div>
      <div><small>Issued</small><strong>${date(inv.createdAt)}</strong><small>Due</small><strong>${date(inv.dueAt)}</strong>${inv.paidAt?`<small>Paid</small><strong>${date(inv.paidAt)}</strong>`:''}</div></div>
    <table class="inv-lines"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${inv.lines.map(l=>`<tr><td>${esc(l.label)}</td><td>${money(l.cents)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td>${money(inv.totalCents)}</td></tr></tfoot></table>
    ${inv.status==='sent'&&seller?.instructions?`<p class="inv-instr"><strong>How to pay:</strong> ${esc(seller.instructions)} Reference: ${esc(inv.number)}.</p>`:''}
  </article>`;
}
export function invoicePage(me,id,rerender){
  const d=companyData(rerender);
  if(!d)return '<p class="ac-empty">Loading…</p>';
  const inv=d.invoices.find(i=>i.id===id)||me.openInvoices.find(i=>i.id===id);
  if(!inv)return '<p class="ac-empty">Invoice not found.</p>';
  return invoiceDoc(inv,{seller:d.seller,company:me.company.name,profile:me.company.profile,canPay:me.user.role==='owner',back:me.access?'#billing':'#pay'});
}
export function billingPage(me,usage,rerender=()=>{}){
  const plan=me.plan,e=me.entitlements,sub=me.subscription,d=companyData(rerender);
  const status=sub.status;
  const when=status==='trialing'?`Trial ends ${date(sub.periodEnd)} · ${daysLeft(sub.periodEnd)} days left`:sub.cancelAtPeriodEnd?`Ends ${date(sub.periodEnd)}`:status==='past_due'?`Payment was due ${date(sub.periodEnd)}`:`Renews ${date(sub.periodEnd)}`;
  const meter=(label,used,max)=>`<div class="meter"><div><span>${label}</span><strong>${used}${max?` / ${max}`:''}</strong></div><i><b style="width:${max?Math.min(100,used/max*100):8}%"></b></i><small>${max?`${Math.max(0,max-used)} remaining`:'Unlimited on your plan'}</small></div>`;
  const changeLabel=p=>status==='trialing'?`Switch to ${p.name}`:p.priceCents>plan.priceCents?'Upgrade now':`Switch on ${date(sub.periodEnd)}`;
  const changeNote=p=>status==='trialing'?'Free while your trial lasts.':p.priceCents>plan.priceCents?'Starts now. You pay the difference for the rest of this period.':'Takes effect at your next renewal. No refund for this period.';
  return `<div class="heading"><div><h1>Billing & plan</h1><p>Your subscription, payments and what your plan includes.</p></div></div>
    ${me.openInvoices.length?`<div class="bill-alert">${g.clock}<span>${me.openInvoices.length} open invoice${me.openInvoices.length===1?'':'s'} · ${money(me.openInvoices.reduce((n,i)=>n+i.totalCents,0))} due</span>${me.openInvoices.map(i=>`<a class="btn" href="#invoice/${i.id}">${esc(i.number)}</a>`).join('')}${d?.seller?.cardPayments?`<button class="btn primary" data-acct="payCard" data-id="${me.openInvoices[0].id}">Pay by card</button>`:''}</div>`:''}
    <section class="bill-hero"><div><small>Current plan</small><h2>${esc(plan.name)} ${subPill(status)}</h2><p>${money(plan.priceCents)} / month · ${when}</p>
      ${me.pendingPlan?`<p class="bill-pending">Switching to <strong>${esc(me.pendingPlan.name)}</strong> on ${date(sub.periodEnd)}. <button class="link-btn" data-acct="subscription" data-op="keep-plan">Keep ${esc(plan.name)}</button></p>`:''}
      <div class="bill-actions">${me.user.role!=='owner'?'':sub.cancelAtPeriodEnd?`<button class="btn light" data-acct="subscription" data-op="resume">Resume subscription</button>`:`<button class="btn ghost-light" data-acct="subscription" data-op="cancel">Cancel subscription</button>`}</div></div>
      <div class="bill-meters">${meter('Properties',usage.properties,e.properties)}${meter('Team seats',d?.team.users.filter(u=>u.status==='active').length??usage.team,e.seats)}</div></section>
    ${companyUsageBlock(me,rerender)}
    <h2 class="bill-h">Included features</h2>
    <div class="bill-feats">${me.catalog.map(([key,name,desc])=>`<div class="${e.features[key]?'':'off'}">${e.features[key]?g.check:g.lock}<div><strong>${esc(name)}</strong><small>${esc(key==='ai'&&!me.platform.aiAvailable?'Temporarily unavailable on HushHawk':desc)}</small></div></div>`).join('')}</div>
    ${me.user.role==='owner'?`<h2 class="bill-h">Change plan</h2>
    <div class="plan-grid">${me.plans.map(p=>planCard(p,me,{current:p.id===plan.id,pending:p.id===me.pendingPlan?.id,label:changeLabel(p),note:p.id===plan.id?'':changeNote(p)})).join('')}</div>`:''}
    <h2 class="bill-h">Invoices & payments</h2>
    ${d?(d.invoices.length?`<div class="card"><div class="tablewrap"><table><thead><tr><th>Invoice</th><th>For</th><th>Total</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${d.invoices.map(i=>`<tr><td><strong>${esc(i.number)}</strong></td><td><small>${esc(kindLabel[i.kind]||i.kind)} · ${i.lines.map(l=>esc(l.label)).join('; ')}</small></td><td>${money(i.totalCents)}</td><td>${date(i.dueAt)}</td><td>${invPill(i)}</td><td><a class="btn" href="#invoice/${i.id}">View</a></td></tr>`).join('')}</tbody></table></div></div>`:'<p class="ac-empty">No invoices yet.</p>')
      +(d.payments.length?`<p class="bill-note">Payments received: ${d.payments.map(p=>`${money(p.amountCents)} on ${date(p.at)} (${esc(p.method.replace('_',' '))})`).join(' · ')}</p>`:''):'<p class="ac-empty">Loading…</p>'}`;
}
function companyUsageBlock(me,rerender){
  const d=companyData(rerender);
  if(!d)return `<p class="ac-empty">${co.error?esc(co.error):'Loading usage…'}</p>`;
  const meter=(label,used,max)=>`<div class="meter light"><div><span>${label}</span><strong>${used.toLocaleString()}${max?` / ${max.toLocaleString()}`:''}</strong></div><i><b class="${max&&used>=max?'over':max&&used>=max*.8?'near':''}" style="width:${max?Math.min(100,used/max*100):6}%"></b></i><small>${max?(used>=max?(d.overage==='allow'?'Limit reached · extra use is billed':'Limit reached · upgrade to keep going'):`${(max-used).toLocaleString()} left this period`):'Unlimited on your plan'}</small></div>`;
  const request=d.numberRequests.find(r=>r.status==='open');
  const canRequest=['owner','admin'].includes(me.user.role);
  return `<div class="bill-cards">
    <section class="bill-card"><h3>This billing period</h3>${meter('Text messages',d.usage.sms,d.quotas.sms||0)}${me.entitlements.features.ai?meter('AI replies',d.usage.ai,d.quotas.ai||0):''}<small class="bill-note">${d.usage.to?`Resets ${date(d.usage.to)}.`:'Resets on the 1st of each month.'}</small></section>
    <section class="bill-card"><h3>Texting number</h3>${d.sms.number?`<p class="bill-number">${esc(d.sms.number)}</p><small class="bill-note">${d.sms.configured?'Tenants can text this number. Replies send from it.':'Assigned. Texting switches on once HushHawk finishes provider setup.'}</small>`
      :request?`<p class="bill-wait">${g.clock} Number requested ${date(request.createdAt)}</p><small class="bill-note">HushHawk will assign one shortly.</small>`
      :canRequest?`<form data-acct-form="numberRequest" class="bill-form"><label>Preferred area code <small>(optional)</small><input name="areaCode" inputmode="numeric" maxlength="3" placeholder="e.g. 512"></label><label>Note<input name="note" maxlength="400" placeholder="Anything we should know"></label><button class="btn primary">Request a number</button></form>`:'<p class="bill-note">No number yet. Your company owner can request one.</p>'}</section>
  </div>`;
}

/* ---------- Roles ---------- */
export const ROLE_NAMES={owner:'Owner',admin:'Admin',manager:'Property manager',agent:'Communication agent',maintenance:'Maintenance coordinator',finance:'Finance',viewer:'Viewer'};
const ROLE_HELP={admin:'everything except billing; manages the team',manager:'properties, conversations, maintenance, rules and settings',agent:'conversations, contacts and tasks',maintenance:'tickets, tasks and the calendar',finance:'invoices and reports; read-only elsewhere',viewer:'read-only'};

/* ---------- Team ---------- */
export function teamPage(me,rerender){
  const d=companyData(rerender),owner=me.user.role==='owner';
  if(!d)return '<p class="ac-empty">Loading team…</p>';
  const {users,invites}=d.team,seats=me.entitlements.seats,used=users.filter(u=>u.status==='active').length+invites.length;
  const canAdmin=me.entitlements.features.team;
  const roleName=ROLE_NAMES;
  const assignable=Object.entries(ROLE_NAMES).filter(([r])=>r!=='owner'&&(r==='agent'||canAdmin)&&(owner||r!=='admin'));
  return `<div class="heading"><div><h1>Team</h1><p>People who can sign in to ${esc(me.company.name)}. ${seats?`${used} of ${seats} seats used (including open invites).`:'Unlimited seats on your plan.'}</p></div></div>
    <section class="card pad"><h2>Invite someone</h2>
      <form data-acct-form="invite" class="team-invite"><input name="email" type="email" required placeholder="name@company.com" aria-label="Email"><select name="role" aria-label="Role">${assignable.map(([r,l])=>`<option value="${r}">${l} · ${ROLE_HELP[r]}</option>`).join('')}</select><button class="btn primary"${seats&&used>=seats?' disabled title="All seats are in use"':''}>Create invite link</button></form>
      ${seats&&used>=seats?`<p class="bill-note">All seats are in use. ${owner?'<a href="#billing">Upgrade your plan</a> to add more.':'Ask the owner to upgrade.'}</p>`:''}
      ${linkBox('Invite link')}</section>
    <section class="card"><div class="cardhead"><h2>Members</h2></div><div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users.map(u=>{
      const self=u.id===me.user.id,editable=!self&&u.role!=='owner'&&(owner||u.role!=='admin');
      return `<tr><td><strong>${esc(u.name)}</strong>${self?' <span class="ac-pill">You</span>':''}<br><small>${esc(u.email)}</small></td>
      <td>${owner&&editable&&canAdmin?`<select data-acct-input="memberRole" data-id="${u.id}" aria-label="Role for ${esc(u.name)}">${assignable.map(([r,l])=>`<option value="${r}"${u.role===r?' selected':''}>${l}</option>`).join('')}</select>`:roleName[u.role]||u.role}${u.mfaEnabled?' <span class="ac-pill good" title="Two-step sign-in on">2-step</span>':''}</td>
      <td>${u.status==='active'?'<span class="ac-pill good">Active</span>':'<span class="ac-pill muted">Turned off</span>'}</td><td><small>${dateTime(u.lastLogin)}</small></td>
      <td class="team-actions">${editable?`<button class="btn" data-acct="member" data-op="reset-link" data-id="${u.id}">Reset link</button><button class="btn" data-acct="member" data-op="${u.status==='active'?'disable':'enable'}" data-id="${u.id}">${u.status==='active'?'Turn off':'Turn on'}</button><button class="btn danger" data-acct="member" data-op="remove" data-id="${u.id}">Remove</button>`:''}</td></tr>`;}).join('')}</tbody></table></div></section>
    ${invites.length?`<section class="card"><div class="cardhead"><h2>Open invites</h2></div><div class="tablewrap"><table><thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead><tbody>${invites.map(i=>`<tr><td>${esc(i.email)}</td><td>${roleName[i.role]}</td><td><small>${date(i.expiresAt)}</small></td><td class="team-actions"><button class="btn" data-acct="member" data-op="revoke-invite" data-id="${i.id}">Revoke</button></td></tr>`).join('')}</tbody></table></div></section>`:''}`;
}

/* ---------- Settings additions ---------- */
export function accountSettings(me){
  const p=me.company.profile||{},canEdit=['owner','admin'].includes(me.user.role);
  const f=(label,name,value,attrs='')=>`<label>${label}<input name="${name}" value="${esc(value||'')}" ${attrs}${canEdit?'':' disabled'}></label>`;
  return `<section class="card pad acct-card"><h2>Company profile</h2><p class="muted">Shown on your invoices and to HushHawk support.</p>
    <form data-acct-form="profile"><div class="formgrid">${f('Company name','name',me.company.name,'required maxlength="80"')}${f('Phone','phone',p.phone,'maxlength="40"')}${f('Website','website',p.website,'maxlength="200" placeholder="https://"')}${f('Billing email','billingEmail',p.billingEmail,'type="email" maxlength="254"')}${f('Street address','address',p.address,'maxlength="200"')}${f('City','city',p.city,'maxlength="80"')}${f('State or region','region',p.region,'maxlength="80"')}${f('Postal code','postalCode',p.postalCode,'maxlength="20"')}${f('Country','country',p.country,'maxlength="60"')}${f('Units managed','units',p.units,'inputmode="numeric" maxlength="10"')}</div>
    ${canEdit?'<div class="actions" style="margin-top:14px"><button class="btn primary">Save profile</button></div>':'<p class="bill-note">Only the owner or an admin can edit this.</p>'}</form></section>
    ${securityCards(me)}`;
}
const RETENTION=[[0,'Keep forever'],[12,'12 months'],[24,'2 years'],[36,'3 years'],[60,'5 years'],[84,'7 years']];
function securityCards(me){
  const c=me.company,admin=['owner','admin'].includes(me.user.role),owner=me.user.role==='owner';
  return `${mfaCard(me)}${passwordCard()}
    ${admin?`<section class="card pad acct-card"><h2>Security & data</h2>
      <form data-acct-form="security" class="sec-form">
        <label class="sa-switch"><input type="checkbox" name="requireMfa"${c.requireMfa?' checked':''}><span></span><div><strong>Require two-step sign-in for owners and admins</strong><small>They’ll be asked to set it up the next time they sign in.</small></div></label>
        <label>Keep conversations for<select name="retentionMonths">${RETENTION.map(([m,l])=>`<option value="${m}"${c.retentionMonths===m?' selected':''}>${l}</option>`).join('')}</select></label>
        <small class="muted">Messages and attachments older than this are deleted automatically every day.</small>
        <div class="actions"><button class="btn primary">Save security settings</button></div>
      </form>
      <div class="sec-actions"><a class="btn" href="/api/company/export" download>${g.list} Export all company data (JSON)</a></div>
      ${owner?(c.deletionRequestedAt?`<div class="sec-danger"><strong>Deletion scheduled for ${date(new Date(Date.parse(c.deletionRequestedAt)+30*864e5))}.</strong><p>All workspace data and team accounts will be permanently deleted then. Invoices are kept for accounting.</p><button class="btn" data-acct="cancelDeletion">Cancel deletion</button></div>`
        :`<details class="sec-danger"><summary>Delete this company</summary><p>Your subscription ends, and after 30 days all workspace data, files and team accounts are permanently deleted. Export your data first. You can cancel within the 30 days.</p><form data-acct-form="requestDeletion"><label>Type <strong>${esc(c.name)}</strong> to confirm<input name="confirm" autocomplete="off"></label><button class="btn danger">Delete company in 30 days</button></form></details>`):''}
    </section>`:''}`;
}
let mfaSetup=null,recoveryCodes=null;
function mfaCard(me){
  const u=me.user;
  if(recoveryCodes)return `<section class="card pad acct-card"><h2>Save your recovery codes</h2><p class="muted">Each code works once if you lose your phone. Store them somewhere safe; they won’t be shown again.</p><div class="codes">${recoveryCodes.map(c=>`<code>${esc(c)}</code>`).join('')}</div><div class="actions"><button class="btn" data-acct="copy" data-text="${esc(recoveryCodes.join('\n'))}">Copy codes</button><button class="btn primary" data-acct="codesSaved">I’ve saved them</button></div></section>`;
  if(u.mfaEnabled)return `<section class="card pad acct-card"><h2>Two-step sign-in</h2><p><span class="ac-pill good">${g.check} On</span> You’ll enter a code from your authenticator app when you sign in. ${u.recoveryCodesLeft} recovery code${u.recoveryCodesLeft===1?'':'s'} left.</p>
    ${u.mfaRequired?'<p class="bill-note">Required for your role, so it can’t be turned off.</p>':`<form data-acct-form="mfaDisable" class="pw-form"><label>Password to turn it off<input name="password" type="password" required autocomplete="current-password"></label><div class="actions"><button class="btn">Turn off</button></div></form>`}
    <div class="actions"><button class="btn" data-acct="signoutAll">Sign out of all devices</button></div></section>`;
  if(mfaSetup)return `<section class="card pad acct-card"><h2>Set up two-step sign-in</h2><ol class="mfa-steps"><li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</li><li>Add an account with this key, or <a href="${esc(mfaSetup.otpauth)}">open it in your authenticator app</a> on this device:<code class="mfa-key">${esc(mfaSetup.secret.match(/.{1,4}/g).join(' '))}</code></li><li>Enter the 6-digit code the app shows.</li></ol>
    <form data-acct-form="mfaEnable" class="pw-form"><label>6-digit code<input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label><div class="actions"><button class="btn primary">Turn on</button><button type="button" class="btn" data-acct="mfaCancel">Cancel</button></div></form></section>`;
  return `<section class="card pad acct-card"><h2>Two-step sign-in</h2><p class="muted">Protect your account with a code from your phone in addition to your password.${u.mfaRequired?' <strong>Required for your role.</strong>':''}</p><div class="actions"><button class="btn primary" data-acct="mfaStart">Set up two-step sign-in</button><button class="btn" data-acct="signoutAll">Sign out of all devices</button></div></section>`;
}
// Shown before anything else when two-step sign-in is required but not set up yet.
export function mfaRequiredPage(me,{brand}){
  return `<main class="ac-center" id="main"><header class="ac-top">${brand()}<button class="signin-back" data-acct="logout">${g.out} Sign out</button></header>
    <div class="mfa-gate"><div class="ac-head"><h1>Set up two-step sign-in</h1><p>Your ${me.user.role==='super_admin'?'platform':'company'} requires a code from your phone when you sign in. It takes about a minute.</p></div>${mfaCard(me)}</div></main>`;
}
function passwordCard(){
  return `<section class="card pad acct-card"><h2>Your password</h2><form data-acct-form="password" class="pw-form"><label>Current password<input name="current" type="password" required autocomplete="current-password"></label><label>New password<input name="next" type="password" required minlength="10" autocomplete="new-password" placeholder="At least 10 characters"></label><div class="actions"><button class="btn primary">Change password</button></div></form><p class="bill-note">Changing it signs you out everywhere else.</p></section>`;
}

/* ---------- Public: invite, reset, forgot ---------- */
const pub={kind:'',token:'',data:null,error:''};
function loadPublic(kind,token,rerender){
  if(pub.kind===kind&&pub.token===token)return;
  Object.assign(pub,{kind,token,data:null,error:''});
  api(`/api/auth/${kind}?token=${encodeURIComponent(token)}`).then(d=>{pub.data=d;}).catch(e=>{pub.error=e.message;}).finally(rerender);
}
const pubShell=(brand,body)=>`<main class="ac-center" id="main"><header class="ac-top">${brand()}<a class="signin-back" href="#login">Sign in</a></header><section class="ac-card pub-card">${body}</section></main>`;
export function invitePage(token,{brand},rerender,me){
  if(me?.user)return pubShell(brand,`<h1>You’re already signed in</h1><p>You’re signed in as ${esc(me.user.email)}. Sign out to accept this invite with a different account.</p><button class="signin-submit" data-acct="logout">Sign out</button>`);
  loadPublic('invite',token,rerender);
  if(pub.error)return pubShell(brand,`<h1>Invite unavailable</h1><p>${esc(pub.error)}</p>`);
  if(!pub.data)return pubShell(brand,'<p class="ac-empty">Checking your invite…</p>');
  return pubShell(brand,`<p class="signin-eyebrow">Team invite</p><h1>Join ${esc(pub.data.company)}</h1><p>You’ve been invited as ${pub.data.role==='admin'?'an admin':'a team member'}. Set up your sign-in for <strong>${esc(pub.data.email)}</strong>.</p>
    <form class="signin-form" data-acct-form="acceptInvite"><label class="field"><span>Your name</span><input name="name" required maxlength="80" autocomplete="name"></label><label class="field"><span>Password</span><input name="password" type="password" required minlength="10" placeholder="At least 10 characters" autocomplete="new-password"></label><div class="admin-login-error" role="alert" hidden></div><label class="signin-remember terms"><input type="checkbox" name="acceptTerms"><span>I agree to the <a href="#terms" target="_blank">Terms</a> and <a href="#privacy" target="_blank">Privacy Policy</a></span></label><button class="signin-submit">Join team</button></form>`);
}
export function resetPage(token,{brand},rerender){
  loadPublic('reset',token,rerender);
  if(pub.error)return pubShell(brand,`<h1>Reset link unavailable</h1><p>${esc(pub.error)}</p><a class="btn" href="#forgot">How to get a new link</a>`);
  if(!pub.data)return pubShell(brand,'<p class="ac-empty">Checking your link…</p>');
  return pubShell(brand,`<p class="signin-eyebrow">Password reset</p><h1>Choose a new password</h1><p>For <strong>${esc(pub.data.email)}</strong>. You’ll be signed in afterwards.</p>
    <form class="signin-form" data-acct-form="resetPassword"><label class="field"><span>New password</span><input name="password" type="password" required minlength="10" placeholder="At least 10 characters" autocomplete="new-password"></label><div class="admin-login-error" role="alert" hidden></div><button class="signin-submit">Save password</button></form>`);
}
export function forgotPage({brand}){
  return pubShell(brand,`<p class="signin-eyebrow">Forgot your password?</p><h1>Get a reset link</h1>
    <ol class="forgot-steps"><li><strong>Team members and admins:</strong> ask your company owner or an admin. They can create a reset link from <em>Team</em>.</li><li><strong>Company owners:</strong> contact HushHawk support with your company name. We’ll send you a reset link.</li></ol>
    <p class="bill-note">Reset links work once and expire after 2 days.</p><a class="signin-submit" href="#login">Back to sign in</a>`);
}
export async function confirmPayment(sessionId){
  return api('/api/billing/confirm',{sessionId});
}

export function lockedPage(name,me){
  return `<section class="plan-locked">${g.lock}<h1>${esc(name)} isn’t included in your plan</h1><p>Your ${esc(me.plan?.name||'current')} plan doesn’t include this feature. Upgrade to unlock it for your whole team.</p><a class="btn primary" href="#billing">See plans</a></section>`;
}

/* ---------- Super admin console ---------- */
const sup={data:null,loading:false,error:'',tab:'pending',q:'',snapshots:{},invoiceFilter:'open',lastLink:''};
async function loadSuper(rerender){
  if(sup.loading)return;
  sup.loading=true;sup.loadedAt=Date.now();
  try{sup.data=await api('/api/super/overview',{});sup.error='';}
  catch(error){sup.error=error.message;}
  finally{sup.loading=false;rerender();}
}
export function superConsole(me,{brand},rerender){
  sup.me=me;
  const [,section='overview',id='',sub='']=location.hash.slice(1).split('/');
  if((!sup.data&&!sup.error)||(sup.data&&Date.now()-(sup.loadedAt||0)>3000))loadSuper(rerender);
  clearInterval(sup.poll);sup.poll=setInterval(()=>{if(location.hash.startsWith('#super')&&!document.hidden&&!document.activeElement?.matches('input,select,textarea'))loadSuper(rerender);else if(!location.hash.startsWith('#super'))clearInterval(sup.poll);},30000);
  const d=sup.data;
  const pending=d?.companies.filter(c=>c.status==='pending').length||0;
  const openSupport=d?.support.filter(s=>s.status==='open').length||0,openNumbers=d?.numberRequests.filter(r=>r.status==='open').length||0;
  const nav=[['overview','Overview',g.grid],['companies','Companies',g.building,pending],['usage','Usage & costs',g.layers],['plans','Plans & packages',g.list],
    ['providers','Providers & AI',g.spark],['numbers','Phone numbers',g.support,openNumbers],['support','Support',g.people,openSupport],['leads','Demo requests',g.list,d?.leads?.filter(l=>l.status==='new').length||0],['invoices','Invoices & payments',g.building],
    ['platform','Platform controls',g.sliders],['audit','Activity log',g.clock]];
  let body;
  if(sup.error)body=`<div class="ac-error">${esc(sup.error)} <button class="btn" data-acct="superReload">Retry</button></div>`;
  else if(!d)body='<p class="ac-empty">Loading platform data…</p>';
  else body={overview:superOverview,companies:id?(dd,i)=>companyDetail(dd,i,sub||'overview'):companyList,invoice:superInvoicePage,usage:usagePage,plans:id?planEditor:planList,providers:providersPage,numbers:numbersPage,support:supportAdminPage,leads:leadsPage,invoices:invoicesPage,platform:platformPage,audit:auditPage}[section]?.(d,id)||superOverview(d);
  return `<div class="sa">
    <aside class="sa-side">${brand()}<span class="sa-tag">${g.shield} Super admin</span>
      <nav>${nav.map(([key,label,icon,count])=>`<a href="#super/${key}" class="${section===key||(key==='invoices'&&section==='invoice')?'on':''}">${icon}<span>${label}</span>${count?`<b>${count}</b>`:''}</a>`).join('')}</nav>
      <div class="sa-me"><span>${esc(me.user.email[0].toUpperCase())}</span><div><strong>${esc(me.user.name)}</strong><small>${esc(me.user.email)}</small></div><button data-acct="logout" aria-label="Sign out" title="Sign out">${g.out}</button></div>
    </aside>
    <main class="sa-main" id="main">${body}</main>
  </div>`;
}
function head(title,sub,actions=''){return `<header class="sa-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="sa-actions">${actions}</div></header>`;}
function superOverview(d){
  const by=s=>d.companies.filter(c=>c.status===s);
  const value=by('active').reduce((sum,c)=>sum+(d.plans.find(p=>p.id===c.planId)?.priceCents||0),0);
  const tiles=[['Companies',d.companies.length,g.building],['Awaiting approval',by('pending').length,g.clock],['Active',by('active').length,g.check],['Monthly plan value',money(value),g.layers]];
  const queue=by('pending');
  return head('Platform overview','Everything happening across HushHawk, at a glance.')+
    `<div class="sa-tiles">${tiles.map(([l,v,i])=>`<div class="sa-tile">${i}<strong>${v}</strong><small>${l}</small></div>`).join('')}</div>
    ${alertsBlock(d)}
    <div class="sa-cols">
      <section class="sa-card"><header><h2>Approval queue</h2><a href="#super/companies">All companies</a></header>
        ${queue.length?queue.map(c=>`<div class="sa-row"><span class="sa-av">${esc(c.name[0])}</span><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'')} · ${date(c.createdAt)}</small></div><div class="sa-btns"><button class="btn" data-acct="company" data-op="reject" data-id="${c.id}">Reject</button><button class="btn primary" data-acct="company" data-op="approve" data-id="${c.id}">Approve</button></div></div>`).join(''):'<p class="ac-empty">No companies waiting for approval.</p>'}
      </section>
      <section class="sa-card"><header><h2>Companies by plan</h2><a href="#super/plans">Manage plans</a></header>
        ${d.plans.map(p=>{const n=d.companies.filter(c=>c.planId===p.id&&c.status==='active').length;const max=Math.max(1,by('active').length);return `<div class="sa-bar"><div><span>${esc(p.name)}</span><strong>${n}</strong></div><i><b style="width:${n/max*100}%"></b></i></div>`;}).join('')}
        <div class="sa-bar"><div><span>No plan chosen yet</span><strong>${by('active').filter(c=>!c.planId).length}</strong></div></div>
        <p class="sa-foot">Monthly plan value counts active companies at list price. No billing provider is connected.</p>
      </section>
    </div>
    <section class="sa-card"><header><h2>Recent activity</h2><a href="#super/audit">Full log</a></header>${auditRows(d.audit.slice(0,8))}</section>`;
}
function companyList(d){
  const tabs=[['pending','Awaiting approval'],['active','Active'],['suspended','Suspended'],['rejected','Rejected'],['all','All']];
  const q=sup.q.toLowerCase();
  const rows=d.companies.filter(c=>(sup.tab==='all'||c.status===sup.tab)&&(!q||(c.name+' '+(c.owner?.email||'')).toLowerCase().includes(q)));
  return head('Companies','Approve new sign-ups and manage each company’s plan and access.')+
    `<div class="sa-toolbar"><div class="sa-tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${sup.tab===k}" data-acct="tab" data-id="${k}">${l}<b>${k==='all'?d.companies.length:d.companies.filter(c=>c.status===k).length}</b></button>`).join('')}</div>
      <label class="sa-search">${g.search}<input type="search" placeholder="Search company or email" value="${esc(sup.q)}" data-acct-input="search" aria-label="Search companies"></label></div>
    <section class="sa-card flush">${rows.length?`<table class="sa-table"><thead><tr><th>Company</th><th>Status</th><th>Plan</th><th>Usage</th><th>Signed up</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr data-acct="openCompany" data-id="${c.id}"><td><div class="sa-co"><span class="sa-av">${esc(c.name[0])}</span><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'')}</small></div></div></td><td>${pill(c.status)}</td><td>${esc(d.plans.find(p=>p.id===c.planId)?.name||'—')}</td><td><small>${c.usage.properties} properties · ${c.usage.team} seats</small></td><td><small>${date(c.createdAt)}</small></td><td class="sa-go">${g.arrow}</td></tr>`).join('')}</tbody></table>`:'<p class="ac-empty pad">No companies in this view.</p>'}</section>`;
}
function planList(d){
  return head('Plans & packages','Decide what each package includes, its price and support level.',`<a class="btn primary" href="#super/plans/new">${g.plus} New plan</a>`)+
    `<div class="sa-plans">${d.plans.map(p=>{const n=d.companies.filter(c=>c.planId===p.id).length;return `<a class="sa-plan" href="#super/plans/${p.id}">
      <header><h3>${esc(p.name)}</h3><span class="ac-pill ${p.active?'good':'muted'}">${p.active?'Available':'Hidden'}</span></header>
      <p class="plan-price"><strong>${money(p.priceCents)}</strong><span>/ month</span></p>
      <p class="sa-plan-meta">${limit(p.seats,'seats')} · ${limit(p.properties,'properties')}</p>
      <p class="sa-plan-meta">${p.quotas?.sms?p.quotas.sms.toLocaleString()+' texts':'Unlimited texts'} · ${p.quotas?.ai?p.quotas.ai.toLocaleString()+' AI replies':'unlimited AI'} · ${p.overage==='allow'?'overage billed':'hard limit'}</p>
      <p class="sa-plan-meta">${esc(p.support)}${p.trialDays?` · ${p.trialDays}-day trial`:''}</p>
      <div class="sa-chips">${d.catalog.filter(([k])=>p.features.includes(k)).map(([,name])=>`<span>${esc(name)}</span>`).join('')}</div>
      <footer>${n} compan${n===1?'y':'ies'} · Edit ${g.arrow}</footer></a>`;}).join('')}</div>`;
}
function planEditor(d,id){
  const p=id==='new'?{id:'',name:'',priceCents:0,description:'',support:'',features:['inbox'],seats:0,properties:0,active:true,quotas:{sms:0,ai:0},overage:'block',trialDays:0}:d.plans.find(x=>x.id===id);
  if(!p)return head('Plan not found','')+'<a class="btn" href="#super/plans">Back to plans</a>';
  return `<a class="sa-crumb" href="#super/plans">${g.back} Plans</a>`+head(p.id?'Edit '+esc(p.name):'New plan','Changes apply immediately to every company on this plan.')+
    `<form class="sa-card" data-acct-form="plan" data-id="${esc(p.id)}">
      <div class="sa-form">
        <label>Plan name<input name="name" value="${esc(p.name)}" maxlength="60" required></label>
        <label>Monthly price (USD)<input name="price" type="number" min="0" step="0.01" value="${(p.priceCents/100).toFixed(2)}" required></label>
        <label class="span2">Description<input name="description" value="${esc(p.description)}" maxlength="400" placeholder="One line shown on the plan card"></label>
        <label class="span2">Support level<input name="support" value="${esc(p.support)}" maxlength="200" list="support-levels" placeholder="e.g. Priority support · reply within 4 business hours"></label>
        <datalist id="support-levels"><option value="Email support · reply within 2 business days"><option value="Priority support · reply within 4 business hours"><option value="Dedicated account manager · phone and email"></datalist>
        <label>Team seats <small>0 = unlimited</small><input name="seats" type="number" min="0" step="1" value="${p.seats}"></label>
        <label>Properties <small>0 = unlimited</small><input name="properties" type="number" min="0" step="1" value="${p.properties}"></label>
        <label>Texts per month <small>0 = unlimited</small><input name="quotaSms" type="number" min="0" step="1" value="${p.quotas?.sms||0}"></label>
        <label>AI replies per month <small>0 = unlimited</small><input name="quotaAi" type="number" min="0" step="1" value="${p.quotas?.ai||0}"></label>
        <label>Free trial (days) <small>0 = no trial; one trial per company</small><input name="trialDays" type="number" min="0" max="90" step="1" value="${p.trialDays||0}"></label>
        <label class="span2">When a company reaches a limit<select name="overage"><option value="block"${p.overage!=='allow'?' selected':''}>Block until next month (company can upgrade)</option><option value="allow"${p.overage==='allow'?' selected':''}>Keep working and bill overage at your overage rates</option></select></label>
      </div>
      <h3 class="sa-sub">Included features</h3>
      <div class="sa-feats">${d.catalog.map(([key,name,desc])=>`<label><input type="checkbox" name="features" value="${key}"${p.features.includes(key)?' checked':''}><span><strong>${esc(name)}</strong><small>${esc(desc)}</small></span></label>`).join('')}</div>
      <label class="sa-switch"><input type="checkbox" name="active"${p.active?' checked':''}><span></span><div><strong>Available to choose</strong><small>Hidden plans stay on existing companies but aren’t offered to new ones.</small></div></label>
      <div class="sa-formfoot"><a class="btn" href="#super/plans">Cancel</a><button class="btn primary">${p.id?'Save plan':'Create plan'}</button></div>
    </form>`;
}
function platformPage(d){
  const s=d.settings;
  const row=(key,title,desc,on)=>`<label class="sa-switch big"><input type="checkbox" data-acct-input="setting" data-id="${key}"${on?' checked':''}><span></span><div><strong>${title}</strong><small>${desc}</small></div></label>`;
  return head('Platform controls','Switches that apply to every company on HushHawk.')+
    `<section class="sa-card">${row('aiAvailable','AI features available','When off, AI-drafted replies are disabled for every company, whatever their plan.',s.aiAvailable)}
    ${row('signupsOpen','Accept new sign-ups','When off, the sign-up page tells visitors that new accounts are paused.',s.signupsOpen)}
    ${row('requireApproval','Require approval for new companies','When off, new companies are approved automatically and go straight to choosing a plan.',s.requireApproval)}
    ${row('requireMfaSuper','Require two-step sign-in for super admins','Strongly recommended. Super admins without it are asked to set it up at their next sign-in.',s.requireMfaSuper)}</section>
    <h2 class="sa-h2">Your account</h2>${mfaCard(sup.me||{user:{}})}${passwordCard()}`;
}
function leadsPage(d){
  const tone={new:'warn',contacted:'',won:'good',lost:'muted'};
  return head('Demo requests','Requests from the website’s demo form, newest first.')+
    `<section class="sa-card flush">${d.leads.length?`<table class="sa-table"><thead><tr><th>Who</th><th>Company</th><th>Message</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>${d.leads.map(l=>`<tr><td><strong>${esc(l.name)}</strong><small class="sa-sm"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>${l.phone?' · '+esc(l.phone):''}</small></td><td>${esc(l.company||'—')}${l.units?`<small class="sa-sm">${esc(l.units)} units</small>`:''}</td><td><small>${esc(l.message||'—')}</small></td><td><small>${dateTime(l.created_at)}</small></td><td><span class="ac-pill ${tone[l.status]||''}">${esc(l.status)}</span></td><td class="sa-right sa-btns">${['contacted','won','lost'].filter(s=>s!==l.status).map(s=>`<button class="btn sm" data-acct="leadStatus" data-op="${s}" data-id="${l.id}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</td></tr>`).join('')}</tbody></table>`:'<p class="ac-empty pad">No demo requests yet.</p>'}</section>`;
}
function auditRows(rows){
  return rows.length?`<ul class="sa-log">${rows.map(a=>`<li><span>${esc(a.actor[0]?.toUpperCase())}</span><div><strong>${esc(a.action)}</strong>${a.target?` · ${esc(a.target)}`:''}<small>${esc(a.actor)} · ${dateTime(a.at)}</small></div></li>`).join('')}</ul>`:'<p class="ac-empty">No activity yet.</p>';
}
function auditPage(d){return head('Activity log','Sign-ups, approvals, plan changes and platform settings, newest first.')+`<section class="sa-card">${auditRows(d.audit)}</section>`;}

/* ---------- Super admin: usage, providers, numbers, support, invoices ---------- */
const usd=micros=>'$'+(micros/1e6).toFixed(micros>=1e7?0:2);
const pct=(used,limit)=>limit?Math.min(100,Math.round(used/limit*100)):0;
const quotaText=(used,limit)=>limit?`${used.toLocaleString()} / ${limit.toLocaleString()}`:`${used.toLocaleString()} · unlimited`;
function alertsBlock(d){
  if(!d.alerts.length)return `<section class="sa-card sa-ok">${g.check}<div><strong>All clear</strong><small>Providers connected, no quotas near their limit, nothing waiting.</small></div></section>`;
  return `<section class="sa-card"><header><h2>Needs attention</h2><span class="ac-pill warn">${d.alerts.length}</span></header><ul class="sa-alerts">${d.alerts.map(a=>`<li class="${a.level}"><i></i><span>${esc(a.text)}</span><a href="#super/${esc(a.link)}">Open ${g.arrow}</a></li>`).join('')}</ul></section>`;
}
function usagePage(d){
  const active=d.companies.filter(c=>c.status==='active');
  const totals=active.reduce((t,c)=>{const m=c.usage.month;const price=d.plans.find(p=>p.id===c.planId)?.priceCents||0;return {sms:t.sms+m.sms,ai:t.ai+m.ai,cost:t.cost+m.costMicros,revenue:t.revenue+price*1e4};},{sms:0,ai:0,cost:0,revenue:0});
  const tiles=[['Texts this month',totals.sms.toLocaleString(),g.list],['AI replies this month',totals.ai.toLocaleString(),g.spark],['Provider cost',usd(totals.cost),g.layers],['Plan revenue',usd(totals.revenue),g.building]];
  return head('Usage & costs',`${new Date(d.period+'-01').toLocaleDateString(undefined,{month:'long',year:'numeric'})}, from the start of the month. Costs use the rates in Providers & AI.`)+
    `<div class="sa-tiles">${tiles.map(([l,v,i])=>`<div class="sa-tile">${i}<strong>${v}</strong><small>${l}</small></div>`).join('')}</div>
    <section class="sa-card flush">${active.length?`<table class="sa-table"><thead><tr><th>Company</th><th>Plan</th><th>Texts</th><th>AI replies</th><th>Cost</th><th>Margin</th></tr></thead><tbody>${active.map(c=>{
      const plan=d.plans.find(p=>p.id===c.planId),m=c.usage.month,q=plan?.quotas||{};
      const margin=(plan?.priceCents||0)*1e4-m.costMicros;
      const bar=(used,limit)=>`<div class="sa-q"><span>${quotaText(used,limit)}</span>${limit?`<i class="${pct(used,limit)>=100?'over':pct(used,limit)>=80?'near':''}"><b style="width:${pct(used,limit)}%"></b></i>`:''}</div>`;
      return `<tr data-acct="openCompany" data-id="${c.id}"><td><div class="sa-co"><span class="sa-av">${esc(c.name[0])}</span><div><strong>${esc(c.name)}</strong><small>${c.number?esc(c.number):'No number'}${m.errors?` · <em class="sa-err">${m.errors} error${m.errors===1?'':'s'}</em>`:''}</small></div></div></td><td>${esc(plan?.name||'—')}</td><td>${bar(m.sms,q.sms)}</td><td>${bar(m.ai,q.ai)}</td><td>${usd(m.costMicros)}</td><td class="${margin<0?'sa-neg':''}">${usd(margin)}</td></tr>`;}).join('')}</tbody></table>`:'<p class="ac-empty pad">No active companies yet.</p>'}</section>
    ${d.recentErrors.length?`<section class="sa-card"><header><h2>Provider errors · last 24 hours</h2></header><ul class="sa-log">${d.recentErrors.map(e=>`<li><span>!</span><div><strong>${esc(d.companies.find(c=>c.id===e.company_id)?.name||'Company')}</strong> · ${esc(e.kind==='ai'?'AI draft':'Text message')}<small>${esc(e.detail)} · ${dateTime(e.at)}</small></div></li>`).join('')}</ul></section>`:''}`;
}
function providersPage(d){
  const p=d.providers,c=p.costs;
  const keyState=k=>k?`<span class="ac-pill good">${g.check} Saved ${esc(k.hint)}</span>`:'<span class="ac-pill warn">Not set</span>';
  return head('Providers & AI','Keys are encrypted on the server and never shown to companies. Leave a key field empty to keep the saved one.')+
    (p.secretsReady?'':`<div class="ac-error">Provider keys can’t be saved until the server has an encryption secret (HUSHHAWK_SECRETS_KEY).</div>`)+
    `<form class="sa-card" data-acct-form="providers">
      <header><h2>${g.spark} AI provider · Anthropic</h2>${keyState(p.anthropicKey)}</header>
      <div class="sa-form">
        <label class="span2">API key<input name="anthropicKey" type="password" autocomplete="off" placeholder="${p.anthropicKey?'Saved · enter a new key to replace it':'sk-ant-…'}"></label>
        <label>Model<select name="aiModel">${p.models.map(m=>`<option${m===p.aiModel?' selected':''}>${m}</option>`).join('')}</select></label>
        <label>Effort <small>Higher is more careful and costs more</small><select name="aiEffort">${p.efforts.map(e=>`<option${e===p.aiEffort?' selected':''}>${e}</option>`).join('')}</select></label>
        <label class="span2">Base instructions <small>Applied to every company’s drafts, before their own knowledge and tone</small><textarea name="aiInstructions" rows="6" maxlength="6000">${esc(p.aiInstructions||'')}</textarea></label>
      </div>
      <div class="sa-formfoot">${p.anthropicKey?`<button type="button" class="btn danger" data-acct="clearKey" data-id="anthropic_api_key">Remove key</button><button type="button" class="btn" data-acct="aiTest">Test connection</button>`:''}<button class="btn primary">Save AI setup</button></div>
      <div class="sa-test" hidden></div>
    </form>
    <form class="sa-card" data-acct-form="providers">
      <header><h2>${g.list} Texting · Twilio</h2>${keyState(p.twilioToken)}</header>
      <div class="sa-form">
        <label>Account SID<input name="twilioSid" value="${esc(p.twilioSid)}" placeholder="AC…" autocomplete="off" spellcheck="false"></label>
        <label>Auth token<input name="twilioToken" type="password" autocomplete="off" placeholder="${p.twilioToken?'Saved · enter a new token to replace it':'32 characters'}"></label>
        <label class="span2">Public webhook base <small>Point each Twilio number’s messaging webhook to this address + /api/sms/inbound</small><input name="twilioWebhookBase" value="${esc(p.twilioWebhookBase)}" placeholder="https://your-hushhawk-domain"></label>
      </div>
      <div class="sa-formfoot">${p.twilioToken?`<button type="button" class="btn danger" data-acct="clearKey" data-id="twilio_auth_token">Remove token</button>`:''}<button class="btn primary">Save Twilio</button></div>
    </form>
    <form class="sa-card" data-acct-form="providers">
      <header><h2>${g.list} Email · Postmark</h2>${keyState(p.postmarkToken)}</header>
      <p class="sa-help">Used for the shared email inbox and for system emails (invites, password resets, approvals, invoices, support replies).</p>
      <div class="sa-form">
        <label>Server API token<input name="postmarkToken" type="password" autocomplete="off" placeholder="${p.postmarkToken?'Saved · enter a new token to replace it':'From Postmark → Servers → API Tokens'}"></label>
        <label>Sender address <small>A verified sender signature or domain in Postmark</small><input name="emailSender" type="email" value="${esc(p.emailSender)}" placeholder="notifications@yourdomain.com"></label>
        <label>Inbound address <small>Postmark inbound address or your inbound domain</small><input name="emailInbound" type="email" value="${esc(p.emailInbound)}" placeholder="abc123@inbound.postmarkapp.com"></label>
        <label>Message stream<input name="emailStream" value="${esc(p.emailStream||'outbound')}"></label>
        <label class="span2">Alerts go to <small>Optional. New sign-ups and support requests; defaults to every super admin</small><input name="alertEmail" type="email" value="${esc(p.alertEmail)}" placeholder="ops@yourdomain.com"></label>
      </div>
      ${p.emailWebhookToken?`<div class="sa-hooks"><p class="sa-help">Set these webhook addresses in Postmark (inbound stream → Inbound webhook; outbound stream → Delivery, Bounce and Spam complaint webhooks):</p>
        <label>Inbound webhook<code>${esc(location.origin)}/api/email/inbound?token=${esc(p.emailWebhookToken)}</code></label>
        <label>Delivery events webhook<code>${esc(location.origin)}/api/email/events?token=${esc(p.emailWebhookToken)}</code></label></div>`:''}
      <div class="sa-formfoot">${p.postmarkToken?`<button type="button" class="btn danger" data-acct="clearKey" data-id="postmark_token">Remove token</button><button type="button" class="btn" data-acct="rotateEmailSecret">New webhook token</button><button type="button" class="btn" data-acct="emailTest">Send test email</button>`:''}<button class="btn primary">Save email</button></div>
      <div class="sa-test" hidden></div>
    </form>
    <form class="sa-card" data-acct-form="costs">
      <header><h2>${g.layers} Costs & overage rates</h2></header>
      <p class="sa-help">What providers charge you, used for cost and margin, and what you charge companies on plans that allow overage.</p>
      <div class="sa-form">
        <label>Your cost per text (USD)<input name="smsMicros" type="number" min="0" step="0.0001" value="${(c.smsMicros/1e6).toFixed(4)}"></label>
        <label>AI input cost per 1M tokens (USD)<input name="aiInputMtokMicros" type="number" min="0" step="0.01" value="${(c.aiInputMtokMicros/1e6).toFixed(2)}"></label>
        <label>AI output cost per 1M tokens (USD)<input name="aiOutputMtokMicros" type="number" min="0" step="0.01" value="${(c.aiOutputMtokMicros/1e6).toFixed(2)}"></label>
        <label>Overage price per extra text (¢)<input name="overageSmsCents" type="number" min="0" step="1" value="${c.overageSmsCents}"></label>
        <label>Overage price per extra AI reply (¢)<input name="overageAiCents" type="number" min="0" step="1" value="${c.overageAiCents}"></label>
      </div>
      <div class="sa-formfoot"><button class="btn primary">Save rates</button></div>
    </form>
    <section class="sa-card"><header><h2>Not connected yet</h2></header><p class="sa-help">Voice calls aren’t integrated yet, so they can’t be configured or metered here.</p></section>`;
}
function numbersPage(d){
  const company=id=>d.companies.find(c=>c.id===id);
  const open=d.numberRequests.filter(r=>r.status==='open');
  const free=d.numbers.filter(n=>!n.companyId);
  const options=list=>list.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  return head('Phone numbers','Numbers you own in Twilio, and which company each one belongs to.')+
    (open.length?`<section class="sa-card"><header><h2>Requests</h2><span class="ac-pill warn">${open.length}</span></header>${open.map(r=>`<div class="sa-row"><span class="sa-av">${esc(company(r.companyId)?.name[0]||'?')}</span><div><strong>${esc(company(r.companyId)?.name||'Company')}</strong><small>${r.areaCode?'Area code '+esc(r.areaCode)+' · ':''}${esc(r.note||'No note')} · ${date(r.createdAt)}</small></div><form class="sa-btns" data-acct-form="assignRequest" data-id="${esc(r.companyId)}"><select name="number" aria-label="Number to assign">${free.length?free.map(n=>`<option>${esc(n.number)}</option>`).join(''):'<option value="">Add a number first</option>'}</select><button class="btn primary"${free.length?'':' disabled'}>Assign</button><button type="button" class="btn" data-acct="declineRequest" data-id="${r.id}">Decline</button></form></div>`).join('')}</section>`:'')+
    `<form class="sa-card sa-inline" data-acct-form="addNumber"><input name="number" placeholder="+15551234567" required aria-label="Phone number"><input name="label" placeholder="Label (optional)" aria-label="Label"><button class="btn primary">${g.plus} Add number</button></form>
    <section class="sa-card flush">${d.numbers.length?`<table class="sa-table"><thead><tr><th>Number</th><th>Company</th><th>Since</th><th></th></tr></thead><tbody>${d.numbers.map(n=>`<tr><td><strong>${esc(n.number)}</strong><small class="sa-sm">${esc(n.label)}</small></td><td>${n.companyId?esc(company(n.companyId)?.name||'—'):`<form class="sa-btns" data-acct-form="assignNumber" data-id="${esc(n.number)}"><select name="companyId" aria-label="Company">${options(d.companies.filter(c=>c.status==='active'))}</select><button class="btn">Assign</button></form>`}</td><td><small>${date(n.assignedAt||n.addedAt)}</small></td><td class="sa-right">${n.companyId?`<button class="btn" data-acct="numberOp" data-op="unassign" data-id="${esc(n.number)}">Unassign</button>`:`<button class="btn danger" data-acct="numberOp" data-op="remove" data-id="${esc(n.number)}">Remove</button>`}</td></tr>`).join('')}</tbody></table>`:'<p class="ac-empty pad">No numbers yet. Buy numbers in your Twilio console, then add them here.</p>'}</section>`;
}
function supportAdminPage(d,id){
  const company=cid=>d.companies.find(c=>c.id===cid);
  const rank={Dedicated:0,Priority:1,Standard:2},state={open:0,answered:1,closed:2};
  const list=[...d.support].sort((a,b)=>state[a.status]-state[b.status]||rank[a.priority]-rank[b.priority]||b.updatedAt.localeCompare(a.updatedAt));
  const current=d.support.find(s=>s.id===id);
  return head('Support','Requests from companies, sorted by status and by the support level their plan includes.')+
    `<div class="sa-split"><section class="sa-card flush sa-tickets">${list.length?list.map(s=>`<a href="#super/support/${s.id}" class="${s.id===id?'on':''}"><div><strong>${esc(s.subject)}</strong><small>${esc(company(s.companyId)?.name||'')} · ${dateTime(s.updatedAt)}</small></div><span class="ac-pill ${s.status==='open'?'warn':s.status==='answered'?'good':'muted'}">${s.status}</span>${s.priority!=='Standard'?`<span class="ac-pill">${s.priority}</span>`:''}</a>`).join(''):'<p class="ac-empty pad">No support requests yet.</p>'}</section>
    <section class="sa-card">${current?`<header><h2>${esc(current.subject)}</h2><div class="sa-btns">${current.status==='closed'?`<button class="btn" data-acct="supportOp" data-op="reopen" data-id="${current.id}">Reopen</button>`:`<button class="btn" data-acct="supportOp" data-op="close" data-id="${current.id}">Close</button>`}</div></header>
      <p class="sa-help">${esc(company(current.companyId)?.name||'')} · ${esc(current.userEmail)} · ${current.priority} support</p>
      <div class="sa-thread">${current.messages.map(m=>`<div class="${m.from}"><small>${esc(m.author)} · ${dateTime(m.at)}</small><p>${esc(m.body)}</p></div>`).join('')}</div>
      <form data-acct-form="supportReply" data-id="${current.id}" class="sa-replyform"><textarea name="body" rows="3" required placeholder="Write a reply to ${esc(company(current.companyId)?.name||'the company')}"></textarea><div class="sa-formfoot"><button class="btn primary">Send reply</button></div></form>`:'<p class="ac-empty">Choose a request to read and reply.</p>'}</section></div>`;
}
function snapshotBlock(id){
  const s=sup.snapshots[id];
  if(!s)return `<section class="sa-card"><header><h2>Workspace</h2><button class="btn" data-acct="snapshot" data-id="${id}">${g.eye} View workspace (read-only)</button></header><p class="sa-help">Opens a read-only summary of this company’s workspace for troubleshooting. Each view is recorded in the activity log.</p></section>`;
  if(s.empty)return `<section class="sa-card"><header><h2>Workspace</h2></header><p class="ac-empty">This company hasn’t saved anything yet.</p></section>`;
  return `<section class="sa-card"><header><h2>Workspace · read-only</h2><small class="sa-help">Viewing is recorded in the activity log</small></header>
    <div class="sa-counts">${Object.entries(s.counts).map(([k,v])=>`<div><strong>${v}</strong><small>${k}</small></div>`).join('')}</div>
    <h3 class="sa-sub">Recent conversations</h3>${s.threads.length?`<ul class="sa-log">${s.threads.map(t=>`<li><span>${esc(t.contact[0]||'?')}</span><div><strong>${esc(t.contact)}</strong> · ${esc(t.subject)} <span class="ac-pill">${esc(t.channel)}</span> <span class="ac-pill ${t.status==='Open'?'warn':'good'}">${esc(t.status)}</span><small>${esc(t.last)}</small></div></li>`).join('')}</ul>`:'<p class="ac-empty">No conversations.</p>'}
    <h3 class="sa-sub">Settings</h3><dl class="sa-dl">${Object.entries(s.settings).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd></div>`).join('')}</dl></section>`;
}

const PROFILE_LABELS=[['phone','Phone'],['website','Website'],['billingEmail','Billing email'],['address','Street address'],['city','City'],['region','State or region'],['postalCode','Postal code'],['country','Country'],['units','Units managed']];
const methodLabel={bank_transfer:'Bank transfer',card:'Card',cash:'Cash',check:'Check',other:'Other',free:'Free plan'};
function markPaidForm(i){
  return `<form class="mark-paid" data-acct-form="markPaid" data-id="${i.id}" data-company="${i.companyId}"><select name="method" aria-label="Payment method"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="other">Other</option></select><input name="reference" placeholder="Reference" maxlength="120" aria-label="Reference"><button class="btn primary">Mark paid</button></form>`;
}
function invoiceRows(d,list,{showCompany=true}={}){
  const company=id=>d.companies.find(c=>c.id===id);
  return list.length?`<table class="sa-table"><thead><tr><th>Invoice</th>${showCompany?'<th>Company</th>':''}<th>For</th><th>Total</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${list.map(i=>`<tr><td><a href="#super/invoice/${i.id}"><strong>${esc(i.number||'—')}</strong></a></td>${showCompany?`<td>${esc(company(i.companyId)?.name||'—')}</td>`:''}<td><small>${esc(kindLabel[i.kind]||i.kind)}<br>${i.lines.map(l=>esc(l.label)).join('<br>')}</small></td><td><strong>${money(i.totalCents)}</strong></td><td><small>${date(i.dueAt)}</small></td><td>${invPill(i)}${i.paidAt?`<br><small>${date(i.paidAt)}</small>`:''}</td>
    <td class="sa-right">${i.status==='sent'?`${markPaidForm(i)}<button class="btn danger sm" data-acct="sub" data-op="void-invoice" data-company="${i.companyId}" data-id="${i.id}">Void</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<p class="ac-empty pad">No invoices in this view.</p>';
}
function companyDetail(d,id,tab='overview'){
  const c=d.companies.find(x=>x.id===id);
  if(!c)return head('Company not found','It may have been removed.')+'<a class="btn" href="#super/companies">Back to companies</a>';
  const plan=d.plans.find(p=>p.id===c.planId),pending=d.plans.find(p=>p.id===c.subscription.pendingPlanId);
  const users=d.users.filter(u=>u.companyId===c.id),invites=d.invites.filter(i=>i.companyId===c.id);
  const invoices=d.invoices.filter(i=>i.companyId===c.id),payments=d.payments.filter(p=>p.companyId===c.id);
  const actions={pending:[['reject','Reject',''],['approve','Approve company','primary']],active:[['suspend','Suspend','danger']],suspended:[['reactivate','Reactivate','primary']],rejected:[['approve','Approve after all','primary']]}[c.status]||[];
  const tabs=[['overview','Profile'],['billing','Subscription & billing'],['team','Team'],['access','Access'],['workspace','Workspace'],['activity','Activity']];
  const s=c.subscription,p=c.profile||{};
  const planOptions=sel=>d.plans.map(x=>`<option value="${x.id}"${x.id===sel?' selected':''}>${esc(x.name)} · ${money(x.priceCents)}/mo${x.active?'':' (hidden)'}</option>`).join('');
  let body='';
  if(tab==='overview')body=`<div class="sa-cols">
      <section class="sa-card"><header><h2>Company profile</h2>${PROFILE_LABELS.some(([k])=>p[k])?'':'<span class="ac-pill warn">Not filled in yet</span>'}</header><dl class="sa-dl"><div><dt>Name</dt><dd>${esc(c.name)}</dd></div>${PROFILE_LABELS.map(([k,l])=>`<div><dt>${l}</dt><dd>${esc(p[k]||'—')}</dd></div>`).join('')}</dl></section>
      <div>
        <section class="sa-card"><header><h2>Owner</h2></header><dl class="sa-dl"><div><dt>Name</dt><dd>${esc(c.owner?.name||'—')}</dd></div><div><dt>Email</dt><dd>${esc(c.owner?.email||'—')}</dd></div><div><dt>Last sign-in</dt><dd>${dateTime(c.owner?.lastLogin)}</dd></div><div><dt>Team</dt><dd>${users.length} people · <a href="#super/companies/${c.id}/team">View</a></dd></div></dl></section>
        <section class="sa-card"><header><h2>Subscription</h2><a href="#super/companies/${c.id}/billing">Manage</a></header><dl class="sa-dl"><div><dt>Plan</dt><dd>${esc(plan?.name||'None')}</dd></div><div><dt>Status</dt><dd>${subPill(s.status)}</dd></div><div><dt>Current period</dt><dd>${s.periodEnd?`${date(s.periodStart)} – ${date(s.periodEnd)}`:'—'}</dd></div><div><dt>Open balance</dt><dd>${money(invoices.filter(i=>i.status==='sent').reduce((n,i)=>n+i.totalCents,0))}</dd></div></dl></section>
      </div></div>
    <section class="sa-card"><header><h2>Usage</h2></header><dl class="sa-dl"><div><dt>Properties</dt><dd>${c.usage.properties}${plan?.properties?` of ${plan.properties}`:''}</dd></div><div><dt>Conversations</dt><dd>${c.usage.threads}</dd></div><div><dt>Texts this month</dt><dd>${quotaText(c.usage.month.sms,plan?.quotas.sms||0)}</dd></div><div><dt>AI replies this month</dt><dd>${quotaText(c.usage.month.ai,plan?.quotas.ai||0)}</dd></div><div><dt>Phone number</dt><dd>${c.number?esc(c.number):`<a href="#super/numbers">Assign one</a>`}</dd></div><div><dt>Workspace last saved</dt><dd>${dateTime(c.usage.updatedAt)}</dd></div></dl></section>`;
  if(tab==='billing')body=`<section class="sa-card"><header><h2>Subscription</h2>${subPill(s.status)}</header>
      <dl class="sa-dl"><div><dt>Plan</dt><dd>${esc(plan?.name||'None')}${plan?` · ${money(plan.priceCents)}/mo`:''}</dd></div><div><dt>Period</dt><dd>${s.periodEnd?`${date(s.periodStart)} – ${date(s.periodEnd)}`:'—'}</dd></div><div><dt>Ends at period end</dt><dd>${s.cancelAtPeriodEnd?'Yes, canceled by the company':'No'}</dd></div><div><dt>Scheduled change</dt><dd>${pending?`To ${esc(pending.name)} at renewal`:'None'}</dd></div><div><dt>Trial used</dt><dd>${s.hadTrial?'Yes':'No'}</dd></div></dl>
      <div class="sub-tools">
        <form data-acct-form="subChangePlan" data-id="${c.id}"><label>Move to plan (no charge)<select name="planId">${planOptions(c.planId)}</select></label><button class="btn">Move</button></form>
        <form data-acct-form="subActivate" data-id="${c.id}"><label>Activate without payment<select name="planId">${planOptions(c.planId||d.plans[0]?.id)}</select></label><label>Months<input name="months" type="number" min="1" max="36" value="1"></label><label>Reason<input name="reason" maxlength="120" placeholder="e.g. pilot, partner"></label><button class="btn">Activate</button></form>
        <form data-acct-form="subExtend" data-id="${c.id}"><label>Extend current period<input name="days" type="number" min="1" max="365" value="14"></label><button class="btn">Add days</button></form>
        ${['trialing','active','past_due','unpaid','pending_payment'].includes(s.status)?`<div><button class="btn danger" data-acct="sub" data-op="cancel-now" data-company="${c.id}">Cancel subscription now</button><small class="sa-help">Ends access immediately and voids open invoices.</small></div>`:''}
        <div>${c.deletionRequestedAt?`<p class="sa-help"><strong>Deletion requested ${date(c.deletionRequestedAt)}</strong>; it runs automatically after 30 days.</p>`:''}<button class="btn danger" data-acct="deleteNow" data-id="${c.id}">Delete company data permanently</button><small class="sa-help">Removes the workspace, files, knowledge and team accounts now. Invoices are kept.</small></div>
      </div></section>
    <section class="sa-card flush"><header class="pad-h"><h2>Invoices</h2></header>${invoiceRows(d,invoices,{showCompany:false})}</section>
    <form class="sa-card sa-inline" data-acct-form="manualInvoice" data-id="${c.id}"><strong>New invoice</strong><input name="description" placeholder="Description" maxlength="160" required><input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount (USD)" required><label>Due in<input name="dueDays" type="number" min="0" max="90" value="7"> days</label><button class="btn primary">Create invoice</button></form>
    <section class="sa-card"><header><h2>Payments</h2></header>${payments.length?`<ul class="sa-log">${payments.map(x=>`<li><span>$</span><div><strong>${money(x.amountCents)}</strong> · ${esc(methodLabel[x.method]||x.method)}${x.reference?` · ${esc(x.reference)}`:''}<small>${dateTime(x.at)} · recorded by ${esc(x.recordedBy)}</small></div></li>`).join('')}</ul>`:'<p class="ac-empty">No payments yet.</p>'}</section>`;
  if(tab==='team')body=`${sup.lastLink?`<div class="link-box"><strong>Password reset link</strong><code>${esc(sup.lastLink)}</code><button type="button" class="btn" data-acct="copy" data-text="${esc(sup.lastLink)}">Copy link</button><small>Send it to the person yourself. It works once and expires in 2 days.</small></div>`:''}
    <section class="sa-card flush">${users.length?`<table class="sa-table"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small class="sa-sm">${esc(u.email)}</small></td><td>${ROLE_NAMES[u.role]||esc(u.role)}</td><td>${u.status==='active'?'<span class="ac-pill good">Active</span>':'<span class="ac-pill muted">Turned off</span>'}</td><td><small>${dateTime(u.lastLogin)}</small></td><td class="sa-right sa-btns"><button class="btn" data-acct="userOp" data-op="reset-link" data-company="${c.id}" data-id="${u.id}">Reset link</button><button class="btn" data-acct="userOp" data-op="reset-mfa" data-company="${c.id}" data-id="${u.id}" title="Turns off two-step sign-in so they can set it up again">Reset 2-step</button><button class="btn${u.status==='active'?' danger':''}" data-acct="userOp" data-op="${u.status==='active'?'disable':'enable'}" data-company="${c.id}" data-id="${u.id}">${u.status==='active'?'Turn off':'Turn on'}</button></td></tr>`).join('')}</tbody></table>`:'<p class="ac-empty pad">No users.</p>'}</section>
    ${invites.length?`<section class="sa-card"><header><h2>Open invites</h2></header><ul class="sa-log">${invites.map(i=>`<li><span>@</span><div><strong>${esc(i.email)}</strong> · ${i.role==='admin'?'Admin':'Team member'}<small>Invited by ${esc(i.createdBy)} · expires ${date(i.expiresAt)}</small></div></li>`).join('')}</ul></section>`:''}`;
  if(tab==='access')body=`<form class="sa-card" data-acct-form="companyUpdate" data-id="${c.id}"><header><h2>Access</h2></header>
      <div class="sa-form"><label class="span2">Company name<input name="name" value="${esc(c.name)}" maxlength="80" required></label></div>
      <h3 class="sa-sub">Feature access <small>Override the plan for this company only</small></h3>
      <div class="sa-access">${d.catalog.map(([key,name])=>{const v=c.overrides[key]||'';const inPlan=plan?.features.includes(key);return `<div><span><strong>${esc(name)}</strong><small>Plan: ${inPlan?'included':'not included'}${key==='ai'&&!d.settings.aiAvailable?' · AI is off platform-wide':''}</small></span><div class="seg">${[['','Plan default'],['on','On'],['off','Off']].map(([val,l])=>`<label><input type="radio" name="o-${key}" value="${val}"${v===val?' checked':''}><span>${l}</span></label>`).join('')}</div></div>`;}).join('')}</div>
      <label class="sa-notes">Internal notes<textarea name="notes" rows="3" maxlength="2000" placeholder="Only super admins can see these notes">${esc(c.notes)}</textarea></label>
      <div class="sa-formfoot"><button class="btn primary">Save changes</button></div></form>`;
  if(tab==='workspace')body=snapshotBlock(c.id);
  if(tab==='activity')body=`<section class="sa-card">${auditRows(d.audit.filter(a=>a.target===c.name||users.some(u=>u.email===a.actor)))}</section>`;
  return `<a class="sa-crumb" href="#super/companies">${g.back} Companies</a>`+
    head(`${esc(c.name)} ${pill(c.status)}`,`Signed up ${date(c.createdAt)}${c.reviewedBy?` · reviewed by ${esc(c.reviewedBy)} on ${date(c.reviewedAt)}`:''}`,actions.map(([op,label,tone])=>`<button class="btn ${tone}" data-acct="company" data-op="${op}" data-id="${c.id}">${label}</button>`).join(''))+
    `<nav class="sa-subtabs">${tabs.map(([k,l])=>`<a href="#super/companies/${c.id}/${k}" class="${tab===k?'on':''}">${l}</a>`).join('')}</nav>`+body;
}
function invoicesPage(d){
  const filters=[['open','Open'],['overdue','Overdue'],['paid','Paid'],['void','Void'],['all','All']];
  const f=sup.invoiceFilter||'open';
  const list=d.invoices.filter(i=>f==='all'||(f==='overdue'?overdue(i):f==='open'?i.status==='sent':i.status===f));
  const openTotal=d.invoices.filter(i=>i.status==='sent').reduce((n,i)=>n+i.totalCents,0);
  const overdueTotal=d.invoices.filter(overdue).reduce((n,i)=>n+i.totalCents,0);
  const monthStart=new Date().toISOString().slice(0,7);
  const collected=d.payments.filter(p=>p.at.startsWith(monthStart)).reduce((n,p)=>n+p.amountCents,0);
  const b=d.billing;
  const keyState=k=>k?`<span class="ac-pill good">${g.check} Saved ${esc(k)}</span>`:'<span class="ac-pill muted">Not set</span>';
  return head('Invoices & payments','Invoices are created automatically when a company subscribes, upgrades or renews. Record bank transfers here; card payments are recorded automatically.',`<button class="btn" data-acct="billingRun">Run billing cycle now</button>`)+
    `<div class="sa-tiles three"><div class="sa-tile">${g.clock}<strong>${money(openTotal)}</strong><small>Open</small></div><div class="sa-tile">${g.x}<strong>${money(overdueTotal)}</strong><small>Overdue</small></div><div class="sa-tile">${g.check}<strong>${money(collected)}</strong><small>Collected this month</small></div></div>
    <div class="sa-toolbar"><div class="sa-tabs">${filters.map(([k,l])=>`<button aria-selected="${f===k}" data-acct="invoiceFilter" data-id="${k}">${l}</button>`).join('')}</div></div>
    <section class="sa-card flush">${invoiceRows(d,list)}</section>
    <form class="sa-card" data-acct-form="billingSettings"><header><h2>Billing settings</h2></header>
      <div class="sa-form">
        <label>Your business name on invoices<input name="sellerName" value="${esc(b.sellerName)}" maxlength="120"></label>
        <label>Invoice number prefix<input name="invoicePrefix" value="${esc(b.invoicePrefix)}" maxlength="8"></label>
        <label class="span2">Business details on invoices <small>Address, tax ID</small><textarea name="sellerDetails" rows="2" maxlength="600">${esc(b.sellerDetails)}</textarea></label>
        <label class="span2">Bank transfer instructions <small>Shown on invoices and the payment page</small><textarea name="paymentInstructions" rows="3" maxlength="1200">${esc(b.paymentInstructions)}</textarea></label>
        <label>Grace period after a missed payment (days)<input name="graceDays" type="number" min="0" max="60" value="${b.graceDays}"></label>
      </div>
      <h3 class="sa-sub">Card payments · Stripe ${keyState(b.stripeKey)}</h3>
      <div class="sa-form">
        <label>Secret key<input name="stripeKey" type="password" autocomplete="off" placeholder="${b.stripeKey?'Saved · enter a new key to replace it':'sk_live_… or sk_test_…'}"></label>
        <label>Webhook signing secret ${b.stripeWebhookSecret?`<small>Saved ${esc(b.stripeWebhookSecret)}</small>`:''}<input name="stripeWebhookSecret" type="password" autocomplete="off" placeholder="whsec_…"></label>
        <p class="sa-help span2">In Stripe, add a webhook to <code>${esc(location.origin)}/api/stripe/webhook</code> for the event <code>checkout.session.completed</code>. Without a webhook, payments are still confirmed when the customer returns from Stripe.</p>
      </div>
      <div class="sa-formfoot">${b.stripeKey?'<button type="button" class="btn danger" data-acct="clearStripe">Remove Stripe keys</button>':''}<button class="btn primary">Save billing settings</button></div>
    </form>`;
}
function superInvoicePage(d,id){
  const inv=d.invoices.find(i=>i.id===id);
  if(!inv)return head('Invoice not found','')+'<a class="btn" href="#super/invoices">Back</a>';
  const c=d.companies.find(x=>x.id===inv.companyId);
  return invoiceDoc(inv,{seller:{name:d.billing.sellerName,details:d.billing.sellerDetails,instructions:d.billing.paymentInstructions},company:c?.name||'—',profile:c?.profile||{},back:'#super/invoices'})+
    (inv.status==='sent'?`<section class="sa-card no-print"><header><h2>Record payment</h2></header>${markPaidForm(inv)}</section>`:'');
}

/* ---------- Company: usage, number, invoices, support ---------- */
const co={data:null,loading:false,error:''};
export function companyData(rerender,force=false){
  if((force||!co.data)&&!co.loading){
    co.loading=true;
    api('/api/company/overview').then(d=>{co.data=d;co.error='';}).catch(e=>{co.error=e.message;}).finally(()=>{co.loading=false;rerender();});
  }
  return co.data;
}
export function supportPage(me,id,rerender){
  const d=companyData(rerender);
  const current=d?.support.find(s=>s.id===id);
  const level=/dedicated/i.test(me.plan.support)?'Dedicated':/priority/i.test(me.plan.support)?'Priority':'Standard';
  return `<div class="heading"><div><h1>Support</h1><p>Ask HushHawk for help. Your plan includes: <strong>${esc(me.plan.support||'standard support')}</strong>.</p></div></div>
    <div class="sup-grid">
      <section class="card"><div class="cardhead"><h2>Your requests</h2></div>${!d?`<p class="ac-empty pad">${co.error?esc(co.error):'Loading…'}</p>`:d.support.length?`<div class="sup-list">${d.support.map(s=>`<a href="#support/${s.id}" class="${s.id===id?'on':''}"><div><strong>${esc(s.subject)}</strong><small>${dateTime(s.updatedAt)}</small></div><span class="ac-pill ${s.status==='answered'?'good':s.status==='closed'?'muted':'warn'}">${s.status==='answered'?'Reply waiting':s.status}</span></a>`).join('')}</div>`:'<p class="ac-empty pad">No requests yet.</p>'}</section>
      <section class="card pad">${current?`<div class="cardhead"><h2>${esc(current.subject)}</h2><a class="btn" href="#support">New request</a></div><div class="sa-thread">${current.messages.map(m=>`<div class="${m.from==='hushhawk'?'company':'hushhawk'}"><small>${esc(m.author)} · ${dateTime(m.at)}</small><p>${esc(m.body)}</p></div>`).join('')}</div>${current.status==='closed'?'<p class="ac-empty">This request is closed.</p>':`<form data-acct-form="companySupportReply" data-id="${current.id}" class="sa-replyform"><textarea name="body" rows="3" required placeholder="Add a reply"></textarea><div class="actions"><button class="btn primary">Send</button></div></form>`}`
        :`<h2>New request</h2><p class="muted">${level} support · we reply by email and here.</p><form data-acct-form="companySupport" class="sup-form"><label>Subject<input name="subject" maxlength="140" required placeholder="What do you need help with?"></label><label>Details<textarea name="body" rows="6" maxlength="4000" required placeholder="Tell us what happened and what you expected."></textarea></label><div class="actions"><button class="btn primary">Send request</button></div></form>`}</section>
    </div>`;
}

/* ---------- Events ---------- */
export function mountAccounts({app,notify,rerender,getMe}){
  const showError=(form,message)=>{const box=form.querySelector('.admin-login-error');if(box){box.hidden=false;box.style.display='flex';box.textContent=message;}else notify(message);};
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('form[data-acct-form]');
    if(!form)return;
    event.preventDefault();
    const kind=form.dataset.acctForm,fd=new FormData(form),v=name=>String(fd.get(name)||'').trim();
    const submit=form.querySelector('button:not([type="button"])');
    try{
      if(kind==='signin'){
        if(!v('email')||!fd.get('password'))throw new Error('Enter your email and password.');
        submit.disabled=true;
        const me=await api('/api/auth/login',{email:v('email'),password:String(fd.get('password')),remember:fd.get('remember')==='on'});
        if(me.mfaRequired){
          form.outerHTML=`<form class="signin-form" data-acct-form="mfaCode" data-challenge="${esc(me.challenge)}" novalidate><p class="signin-lede">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p><label class="field" for="mfa-code"><span>Code</span><input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required autofocus></label><div class="admin-login-error" role="alert" hidden></div><button type="submit" class="signin-submit">Verify and sign in</button></form>`;
          document.querySelector('#mfa-code')?.focus();return;
        }
        return go(homeRoute(me));
      }
      if(kind==='mfaCode'){submit.disabled=true;const me=await api('/api/auth/mfa',{challenge:form.dataset.challenge,code:v('code')});return go(homeRoute(me));}
      if(kind==='mfaEnable'){submit.disabled=true;const r=await api('/api/auth/mfa-enable',{code:v('code')});mfaSetup=null;recoveryCodes=r.recoveryCodes;notify('Two-step sign-in is on.');return rerender();}
      if(kind==='mfaDisable'){submit.disabled=true;await api('/api/auth/mfa-disable',{password:String(fd.get('password'))});notify('Two-step sign-in turned off.');return setTimeout(()=>location.reload(),500);}
      if(kind==='security'){submit.disabled=true;await api('/api/company/security',{requireMfa:fd.get('requireMfa')==='on',retentionMonths:Number(v('retentionMonths'))});notify('Security settings saved.');return setTimeout(()=>location.reload(),500);}
      if(kind==='requestDeletion'){if(!confirm('Schedule this company for permanent deletion in 30 days?'))return;submit.disabled=true;await api('/api/company/security',{action:'request-deletion',confirm:v('confirm')});sessionStorage.setItem('hushhawk.flash','Deletion scheduled. You can cancel it in Settings within 30 days.');return location.reload();}
      if(kind==='superMfaToggle'){return;}
      if(kind==='signupCompany'){
        if(v('company').length<2)throw new Error('Enter your company name.');
        if(!v('name'))throw new Error('Enter your name.');
        Object.assign(signupData,{company:v('company'),name:v('name')});signupStep=2;return rerender();
      }
      if(kind==='signupAccount'){
        signupData.email=v('email');
        if(!/^\S+@\S+\.\S+$/.test(v('email')))throw new Error('Enter a valid work email.');
        if(String(fd.get('password')).length<10)throw new Error('Use a password of at least 10 characters.');
        submit.disabled=true;
        if(fd.get('acceptTerms')!=='on')throw new Error('Please accept the terms to continue.');
        const me=await api('/api/auth/signup',{...signupData,password:String(fd.get('password')),acceptTerms:true});
        if(me.company?.status==='active')return go(homeRoute(me));
        signupStep=3;return rerender();
      }
      if(kind==='companyUpdate'){
        const overrides={};
        for(const [key] of sup.data.catalog){const val=fd.get('o-'+key);if(val)overrides[key]=val;}
        submit.disabled=true;
        sup.data=await api('/api/super/company',{id:form.dataset.id,action:'update',name:v('name'),overrides,notes:v('notes')});
        notify('Company saved.');return rerender();
      }
      const superCall=async(path,body,message)=>{submit&&(submit.disabled=true);sup.data=await api(path,body);notify(message);rerender();};
      const companyCall=async(path,body,message)=>{submit&&(submit.disabled=true);co.data=await api(path,body);notify(message);rerender();};
      if(kind==='providers'){
        const body={};
        for(const name of ['aiModel','aiEffort','aiInstructions','twilioSid','twilioWebhookBase','emailSender','emailInbound','emailStream','alertEmail'])if(fd.has(name))body[name]=String(fd.get(name));
        for(const name of ['anthropicKey','twilioToken','postmarkToken'])if(v(name))body[name]=v(name);
        return superCall('/api/super/providers',body,'Saved.');
      }
      if(kind==='costs')return superCall('/api/super/providers',{costs:{smsMicros:Number(v('smsMicros'))*1e6,aiInputMtokMicros:Number(v('aiInputMtokMicros'))*1e6,aiOutputMtokMicros:Number(v('aiOutputMtokMicros'))*1e6,overageSmsCents:Number(v('overageSmsCents')),overageAiCents:Number(v('overageAiCents'))}},'Rates saved.');
      if(kind==='addNumber')return superCall('/api/super/number',{action:'add',number:v('number'),label:v('label')},'Number added.');
      if(kind==='assignNumber')return superCall('/api/super/number',{action:'assign',number:form.dataset.id,companyId:v('companyId')},'Number assigned.');
      if(kind==='assignRequest')return superCall('/api/super/number',{action:'assign',number:v('number'),companyId:form.dataset.id},'Number assigned.');
      if(kind==='supportReply')return superCall('/api/super/support',{id:form.dataset.id,action:'reply',body:v('body')},'Reply sent.');
      const subCall=(body,message)=>superCall('/api/super/subscription',body,message);
      if(kind==='markPaid')return subCall({companyId:form.dataset.company,action:'mark-paid',invoiceId:form.dataset.id,method:v('method'),reference:v('reference')},'Payment recorded.');
      if(kind==='subChangePlan')return subCall({companyId:form.dataset.id,action:'change-plan',planId:v('planId')},'Plan changed.');
      if(kind==='subActivate')return subCall({companyId:form.dataset.id,action:'activate',planId:v('planId'),months:Number(v('months')),reason:v('reason')},'Subscription activated.');
      if(kind==='subExtend')return subCall({companyId:form.dataset.id,action:'extend',days:Number(v('days'))},'Period extended.');
      if(kind==='manualInvoice')return subCall({companyId:form.dataset.id,action:'invoice',description:v('description'),amountCents:Math.round(Number(v('amount'))*100),dueDays:Number(v('dueDays'))},'Invoice created.');
      if(kind==='billingSettings'){
        const body={sellerName:v('sellerName'),sellerDetails:v('sellerDetails'),paymentInstructions:v('paymentInstructions'),invoicePrefix:v('invoicePrefix'),graceDays:Number(v('graceDays'))};
        if(v('stripeKey'))body.stripeKey=v('stripeKey');
        if(v('stripeWebhookSecret'))body.stripeWebhookSecret=v('stripeWebhookSecret');
        return superCall('/api/super/billing-settings',body,'Billing settings saved.');
      }
      if(kind==='password'){submit.disabled=true;await api('/api/auth/change-password',{current:String(fd.get('current')),next:String(fd.get('next'))});form.reset();submit.disabled=false;return notify('Password changed. Other sessions were signed out.');}
      if(kind==='profile'){
        submit.disabled=true;const body={};for(const [k] of fd)body[k]=v(k);
        await api('/api/company/profile',body);notify('Company profile saved.');setTimeout(()=>location.reload(),600);return;
      }
      if(kind==='invite'){
        submit.disabled=true;const r=await api('/api/company/invite',{email:v('email'),role:v('role')});
        lastLink=r.link;if(co.data)co.data.team=r.team;notify(r.emailed?'Invite emailed. The link below works too.':'Invite link created. Copy it and send it to your teammate.');return rerender();
      }
      if(kind==='acceptInvite'){submit.disabled=true;if(fd.get('acceptTerms')!=='on')throw new Error('Please accept the terms to continue.');const me=await api('/api/auth/accept-invite',{token:pub.token,name:v('name'),password:String(fd.get('password')),acceptTerms:true});return go(homeRoute(me));}
      if(kind==='resetPassword'){submit.disabled=true;const me=await api('/api/auth/reset',{token:pub.token,password:String(fd.get('password'))});return go(homeRoute(me));}
      if(kind==='numberRequest')return companyCall('/api/company/number-request',{areaCode:v('areaCode'),note:v('note')},'Number requested.');
      if(kind==='companySupport'){await companyCall('/api/company/support',{subject:v('subject'),body:v('body')},'Request sent. We’ll reply here.');location.hash='support/'+co.data.support[0].id;return;}
      if(kind==='companySupportReply')return companyCall('/api/company/support-reply',{id:form.dataset.id,body:v('body')},'Reply sent.');
      if(kind==='plan'){
        submit.disabled=true;
        sup.data=await api('/api/super/plan',{id:form.dataset.id||undefined,name:v('name'),priceCents:Math.round(Number(v('price'))*100),description:v('description'),support:v('support'),
          seats:Number(v('seats')),properties:Number(v('properties')),features:fd.getAll('features'),active:fd.get('active')==='on',quotas:{sms:Number(v('quotaSms')),ai:Number(v('quotaAi'))},overage:v('overage'),trialDays:Number(v('trialDays'))});
        notify(form.dataset.id?'Plan saved.':'Plan created.');location.hash='super/plans';return;
      }
    }catch(error){if(submit)submit.disabled=false;showError(form,error.message);}
  });
  document.addEventListener('click',async event=>{
    const el=event.target.closest('[data-acct]');
    if(!el)return;
    const {acct:action,id,op}=el.dataset;
    try{
      if(action==='reveal'){const input=el.parentElement.querySelector('input');const show=input.type==='password';input.type=show?'text':'password';el.setAttribute('aria-pressed',String(show));el.setAttribute('aria-label',show?'Hide password':'Show password');}
      if(action==='signupBack'){signupStep=1;rerender();}
      if(action==='toAccount')go('account');
      if(action==='logout'){await api('/api/auth/logout',{}).catch(()=>{});go('login');}
      if(action==='refresh'){const me=await fetchMe();if(me&&homeRoute(me)!=='account')go(homeRoute(me));else notify(me?.company?.status==='active'?'Not yet. Ask your company owner to check Billing.':'Still under review. We’ll open your workspace as soon as it’s approved.');}
      if(action==='choosePlan'){
        const inBilling=location.hash.startsWith('#billing');
        if(inBilling&&!confirm(el.textContent.startsWith('Upgrade')?'Upgrade now? You’ll get an invoice for the difference for the rest of this period.':'Change your plan?'))return;
        el.disabled=true;const r=await api('/api/company/plan',{planId:id});
        const msg={trial:`Your free trial of ${r.plan.name} has started.`,payment:'Plan chosen. Pay the first invoice to open your workspace.',active:`You’re on ${r.plan.name}.`,switched:`Switched to ${r.plan.name}.`,upgraded:`Upgraded to ${r.plan.name}.`,scheduled:`You’ll move to ${r.pendingPlan?.name} at your next renewal.`,kept:'Scheduled change canceled.'}[r.result];
        sessionStorage.setItem('hushhawk.flash',msg||'Saved.');
        return go(r.result==='payment'?'pay':inBilling?'billing':'dashboard');
      }
      if(action==='payCard'){el.disabled=true;el.textContent='Opening secure payment…';const r=await api('/api/billing/checkout',{invoiceId:id});location.href=r.url;return;}
      if(action==='refreshPay'){const me=await fetchMe();if(me?.access){sessionStorage.setItem('hushhawk.flash','Payment received. Welcome to your workspace.');go('dashboard');}else notify('We haven’t recorded a payment yet. Bank transfers can take a day or two.');}
      if(action==='subscription'){
        if(op==='cancel'&&!confirm('Cancel your subscription? You keep access until the end of this period, and you can resume before then.'))return;
        el.disabled=true;await api('/api/company/subscription',{action:op});
        sessionStorage.setItem('hushhawk.flash',{cancel:'Subscription will end at the end of this period.',resume:'Subscription resumed.','keep-plan':'Scheduled plan change canceled.'}[op]);return go('billing');
      }
      if(action==='print')window.print();
      if(action==='copy'){try{await navigator.clipboard.writeText(el.dataset.text);notify('Link copied.');}catch{notify('Select the link and copy it.');}}
      if(action==='member'){
        if(op==='remove'&&!confirm('Remove this person? They lose access right away.'))return;
        el.disabled=true;const r=await api('/api/company/member',{id,action:op});
        if(co.data)co.data.team=r.team;lastLink=r.link||'';
        notify({'reset-link':'Reset link created. Copy it and send it.',disable:'Turned off.',enable:'Turned on.',remove:'Removed.','revoke-invite':'Invite revoked.'}[op]);return rerender();
      }
      const subOp=async(body,message)=>{el.disabled=true;sup.data=await api('/api/super/subscription',body);notify(message);rerender();};
      if(action==='sub'){
        if(op==='cancel-now'&&!confirm('Cancel this subscription now? Access ends immediately and open invoices are voided.'))return;
        if(op==='void-invoice'&&!confirm('Void this invoice?'))return;
        await subOp({companyId:el.dataset.company,action:op,invoiceId:id},op==='cancel-now'?'Subscription canceled.':'Invoice voided.');
      }
      if(action==='userOp'){
        if(op==='disable'&&!confirm('Turn off this user? They’re signed out right away.'))return;
        if(op==='reset-mfa'&&!confirm('Reset two-step sign-in for this person? Only do this after confirming who they are.'))return;
        el.disabled=true;const r=await api('/api/super/subscription',{companyId:el.dataset.company,action:'user',userId:id,op});
        sup.data=r;sup.lastLink=r.link||'';notify({'reset-link':'Reset link created (also emailed if email is connected).',disable:'User turned off.',enable:'User turned on.','reset-mfa':'Two-step sign-in reset. They’ll set it up again.'}[op]);rerender();
      }
      if(action==='billingRun'){el.disabled=true;sup.data=await api('/api/super/billing-run',{});notify('Billing cycle finished.');rerender();}
      if(action==='invoiceFilter'){sup.invoiceFilter=id;rerender();}
      if(action==='clearStripe'&&confirm('Remove the Stripe keys? Card payments stop until new keys are saved.')){el.disabled=true;sup.data=await api('/api/super/billing-settings',{clear:['stripe_secret_key','stripe_webhook_secret']});notify('Stripe keys removed.');rerender();}
      if(action==='superReload'){sup.error='';rerender();}
      if(action==='mfaStart'){el.disabled=true;mfaSetup=await api('/api/auth/mfa-setup',{});return rerender();}
      if(action==='mfaCancel'){mfaSetup=null;return rerender();}
      if(action==='codesSaved'){recoveryCodes=null;return location.reload();}
      if(action==='signoutAll'){if(!confirm('Sign out on every device, including this one?'))return;await api('/api/auth/signout-all',{});return go('login');}
      if(action==='cancelDeletion'){el.disabled=true;await api('/api/company/security',{action:'cancel-deletion'});sessionStorage.setItem('hushhawk.flash','Deletion canceled.');return location.reload();}
      if(action==='leadStatus'){el.disabled=true;sup.data=await api('/api/super/lead',{id,status:op,notes:''});notify('Demo request updated.');return rerender();}
      if(action==='deleteNow'){const name=prompt('This permanently deletes the company’s workspace, files and team accounts. Type the company name to confirm.');if(!name)return;el.disabled=true;sup.data=await api('/api/super/subscription',{companyId:id,action:'delete-now',confirm:name});notify('Company data deleted.');location.hash='super/companies';return;}
      const superOp=async(path,body,message)=>{el.disabled=true;sup.data=await api(path,body);notify(message);rerender();};
      if(action==='clearKey'&&confirm('Remove this key? Features that need it stop working until a new one is saved.'))await superOp('/api/super/providers',{clear:[id]},'Key removed.');
      if(action==='aiTest'){
        el.disabled=true;const out=el.closest('form').querySelector('.sa-test');out.hidden=false;out.className='sa-test';out.textContent='Testing…';
        try{const r=await api('/api/super/ai-test',{});out.className='sa-test ok';out.textContent=`Connected to ${r.model} in ${(r.ms/1000).toFixed(1)}s. Reply: “${r.reply}”`;}
        catch(error){out.className='sa-test bad';out.textContent=error.message;}
        el.disabled=false;
      }
      if(action==='rotateEmailSecret'&&confirm('Create a new webhook token? Update both webhook addresses in Postmark afterwards, or incoming email stops.'))await superOp('/api/super/providers',{rotateEmailSecret:true},'New webhook token created. Update Postmark.');
      if(action==='emailTest'){
        el.disabled=true;const out=el.closest('form').querySelector('.sa-test');out.hidden=false;out.className='sa-test';out.textContent='Sending…';
        try{await api('/api/super/email-test',{});out.className='sa-test ok';out.textContent='Test email sent to your super admin address. Check the inbox.';}
        catch(error){out.className='sa-test bad';out.textContent=error.message;}
        el.disabled=false;
      }
      if(action==='declineRequest')await superOp('/api/super/number',{action:'decline',requestId:id},'Request declined.');
      if(action==='numberOp'&&(op!=='remove'||confirm('Remove this number from HushHawk? It stays in your Twilio account.')))await superOp('/api/super/number',{action:op,number:id},op==='remove'?'Number removed.':'Number unassigned.');
      if(action==='supportOp')await superOp('/api/super/support',{id,action:op},op==='close'?'Request closed.':'Request reopened.');
      if(action==='snapshot'){el.disabled=true;sup.snapshots[id]=await api('/api/super/workspace',{id});rerender();}
      if(action==='tab'){sup.tab=id;rerender();}
      if(action==='openCompany')location.hash='super/companies/'+id;
      if(action==='company'){
        if(['reject','suspend'].includes(op)&&!confirm(op==='reject'?'Reject this company? They will be signed out and can’t use HushHawk.':'Suspend this company? Everyone on it will be signed out until you reactivate it.'))return;
        el.disabled=true;
        sup.data=await api('/api/super/company',{id,action:op});
        notify({approve:'Company approved.',reject:'Company rejected.',suspend:'Company suspended.',reactivate:'Company reactivated.'}[op]);rerender();
      }
    }catch(error){el.disabled=false;notify(error.message);}
  });
  document.addEventListener('input',event=>{
    const el=event.target.closest('[data-acct-input]');
    if(!el)return;
    if(el.dataset.acctInput==='search'){sup.q=el.value;const pos=el.selectionStart;rerender();const again=app.querySelector('[data-acct-input="search"]');again?.focus();again?.setSelectionRange(pos,pos);}
    if(el.dataset.acctInput==='strength'){
      const p=el.value;const score=p.length<10?(p.length?1:0):1+(p.length>=14)+(/[A-Z]/.test(p)&&/[a-z]/.test(p))+(/\d|[^A-Za-z]/.test(p));
      const meter=app.querySelector('.pw-meter');if(meter)meter.dataset.score=String(Math.min(score,4));
      const hint=app.querySelector('.pw-hint');if(hint)hint.textContent=['Use 10 or more characters. A short phrase works well.','Too short. Use at least 10 characters.','Okay. Longer is stronger.','Good password.','Strong password.'][Math.min(score,4)];
    }
  });
  document.addEventListener('change',async event=>{
    const role=event.target.closest('[data-acct-input="memberRole"]');
    if(role){try{const r=await api('/api/company/member',{id:role.dataset.id,action:'role',role:role.value});if(co.data)co.data.team=r.team;notify('Role updated.');rerender();}catch(error){notify(error.message);rerender();}return;}
    const el=event.target.closest('[data-acct-input="setting"]');
    if(!el)return;
    try{sup.data=await api('/api/super/settings',{[el.dataset.id]:el.checked});notify('Platform setting saved.');rerender();}
    catch(error){el.checked=!el.checked;notify(error.message);}
  });
}
