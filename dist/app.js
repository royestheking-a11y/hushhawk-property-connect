import {marketing,login,mountHome,legalPage} from './front.js';
import {api,fetchMe,homeRoute,signupPage,statusPage,planPage,payPage,invoicePage,billingPage,lockedPage,superConsole,mountAccounts,supportPage,companyData,teamPage,accountSettings,invitePage,resetPage,forgotPage,confirmPayment,mfaRequiredPage} from './accounts.js';
import {upgrade,createJob,runDueJobs} from './workspace.js';
import {seed,uid,now,channels,statuses,priorities,ticketStatuses,triggers,ruleActions,inbound,classify,suggest,runRules} from './model.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const key = 'hushhawk.demo.v1';
const adminKey = 'hushhawk.admin.v1';
const adminSessionKey = 'hushhawk.admin.login';
let isWorkerAdmin = /^\/admin\/?$/.test(location.pathname);
// Signed-in HushHawk account (company owner or super admin), loaded from /api/me.
let account = null;
let wsApi = '/api/admin/workspace';
const isAdminSession = () => false;
const pageFeature = {inbox:'inbox',outbox:'inbox',voice:'voice',assistant:'ai',automations:'automations',maintenance:'maintenance',tasks:'maintenance',calendar:'maintenance',templates:'templates',analytics:'analytics',integrations:'integrations'};
const allowed = page => !account?.entitlements || !pageFeature[page] || account.entitlements.features[pageFeature[page]];
let isAdmin = Boolean(isAdminSession() || isWorkerAdmin);
function updateAdminFlag() {
  isAdmin = Boolean(isAdminSession() || isWorkerAdmin);
}
let state;
let adminEmail='';
let adminSms={configured:false};
let wsEmailInbox={configured:false,address:''};
let loadingSms=false;
const replyIds=new Map();
let adminRevision=0;
let adminError='';
let savePending=Promise.resolve();
let saveBlocked=false;
let walkTimer;
let walkIndex=0;
let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const marketingPages=['home','features','solutions','pricing','faq'];
function getAdminState() {
  try {
    const saved = localStorage.getItem(adminKey);
    if (saved) return upgrade(JSON.parse(saved));
  } catch {}
  const initial = upgrade(seed());
  initial.team[0] = {id:'u1', name:'Super Admin', email:'admin@hushhawk.com', role:'Company Owner', status:'Active'};
  initial.audit.unshift({id:uid(), activity:'Administrator workspace initialized', date:now(), actor:'admin@hushhawk.com'});
  try { localStorage.setItem(adminKey, JSON.stringify(initial)); } catch {}
  return initial;
}
function emptyAdmin(email) {
  const initial=seed();
  for(const [key,value] of Object.entries(initial))if(Array.isArray(value))initial[key]=[];
  initial.settings.company='My property workspace';
  initial.settings.mode='Off';
  initial.billing.plan='';
  initial.team.push({id:'u1',name:email.split('@')[0],email,role:'Company Owner',status:'Active'});
  return upgrade(initial);
}
const currentActorName = () => account ? account.user.name : isAdminSession() ? 'Super Admin' : (isWorkerAdmin ? (adminEmail.split('@')[0] || 'Admin') : 'Alex Morgan');
const currentActorEmail = () => account ? account.user.email : isAdminSession() ? (sessionStorage.getItem('hushhawk.admin.email') || 'admin@hushhawk.com') : (isWorkerAdmin ? adminEmail : 'alex@example.test');
const currentRoleLabel = () => account ? account.company?.name || 'Company owner' : isAdminSession() ? 'Super Admin' : (isWorkerAdmin ? 'Workspace owner' : 'Demo workspace');
if (isAdminSession()) {
  state = getAdminState();
} else if (!isWorkerAdmin) {
  try { state = upgrade(JSON.parse(localStorage.getItem(key)) || seed()); }
  catch { state = upgrade(seed()); }
}
let installPrompt;
let mobileThread = false;
let scope = '';
let menu = false;
let selected = '';
let filter = {q:'',channel:'',status:''};
let period = 7;
let timeout;
const icons = {
  brand:'M3 5l9 3 9-3-4 8-5 6-5-6z M7 9l5 4 5-4',dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  inbox:'M4 4h16l2 10v6H2v-6z M2 14h6l2 3h4l2-3h6',phone:'M6 3h4l2 5-3 2a12 12 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 014 5a2 2 0 012-2z',
  ai:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',flow:'M6 5h12M6 19h12M12 5v14 M3 3h4v4H3z M17 17h4v4h-4z',
  people:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M22 21v-2a4 4 0 00-3-4 M16 3a4 4 0 010 8',
  building:'M5 21V3h14v18 M2 21h20 M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-3 6v-3',tool:'M14 6l4 4 3-3a6 6 0 01-7 8l-6 6-4-4 6-6a6 6 0 018-7z',
  tasks:'M8 4h13M8 12h13M8 20h13M2 4l1 1 2-2M2 12l1 1 2-2M2 20l1 1 2-2',calendar:'M3 5h18v16H3z M7 2v6m10-6v6M3 10h18',
  file:'M5 2h9l5 5v15H5z M14 2v6h5M8 12h8m-8 4h8',chart:'M3 3v18h18M8 16v-4m5 4V7m5 9V4',plug:'M8 3v5m8-5v5M5 8h14v3a7 7 0 01-14 0zM12 18v4',
  settings:'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M19 5l-2 2M7 17l-2 2 M12 18a6 6 0 100-12 6 6 0 000 12z',
  billing:'M2 5h20v14H2z M2 10h20m-16 5h4',plus:'M12 5v14M5 12h14',menu:'M3 6h18M3 12h18M3 18h18',
  bell:'M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',out:'M10 3H4v18h6m4-5l4-4-4-4m-5 4h12',
  play:'M8 5l12 7-12 7z',lock:'M5 10h14v11H5z M8 10V6a4 4 0 018 0v4',search:'M20 20l-4-4M17 10a7 7 0 11-14 0 7 7 0 0114 0z',check:'M4 12l5 5L20 6',send:'M2 3l20 9-20 9 4-9z M6 12h16'
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]||icons.file}"/></svg>`;
const esc = value => String(value??'').replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const by = (list,id) => state[list].find(item=>item.id===id);
const contact = id => by('contacts',id);
const property = id => by('properties',id);
const person = id => by('team',id);
const initials = name => String(name||'?').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
const avatar = name => `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;
const when = time => time ? new Date(time).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '—';
const dateTime = time => new Date(time).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const badge = (name,tone='') => `<span class="badge ${tone}">${esc(name)}</span>`;
const statusBadge = name => badge(name,['Emergency','High','Missed','Blocked'].includes(name)?'urgent':['Resolved','Closed','Done','Approved','Completed','Active'].includes(name)?'good':'');
const button = (label, action, {id='',primary=false,glyph='',title=''}={}) => `<button type="button" class="btn${primary?' primary':''}" data-action="${action}" data-id="${esc(id)}"${title?` title="${esc(title)}"`:''}>${glyph?icon(glyph):''}${esc(label)}</button>`;
const link = (label, route, primary=false) => `<a class="btn${primary?' primary':''}" href="#${esc(route)}">${esc(label)}</a>`;
const options = (values,current) => values.map(value=>{
  const [id,label] = Array.isArray(value)?value:[value,value];
  return `<option value="${esc(id)}"${id===current?' selected':''}>${esc(label)}</option>`;
}).join('');
const propertyOptions = label => [['',label],...state.properties.map(item=>[item.id,item.name])];
const contactOptions = label => [['',label],...state.contacts.map(item=>[item.id,item.name])];
const teamOptions = () => [['','Unassigned'],...state.team.filter(item=>item.status==='Active').map(item=>[item.id,item.name])];
const inScope = propertyId => !scope || propertyId===scope;
const threadScope = thread => inScope(contact(thread.contact)?.property);
const notify = msg => {
  const target = dialog.open ? dialog.querySelector('.dialog-status') || toast : toast;
  target.textContent=msg;
  clearTimeout(timeout);
  timeout=setTimeout(()=>target.textContent='',4200);
};
const save = (activity='') => {
  const actor = currentActorEmail();
  if(activity) state.audit.unshift({id:uid(),activity,date:now(),actor});
  if(isWorkerAdmin && !isAdminSession()){pushChanges();return;}
  const storageKey = isAdminSession() ? adminKey : key;
  try { localStorage.setItem(storageKey,JSON.stringify(state)); }
  catch { notify('Browser storage is unavailable. Changes will last for this session.'); }
};
// ---- Server sync: only changed records are sent, each with the version it was based on.
const SYNC_LISTS=['properties','contacts','threads','tickets','tasks','events','calls','approvals','rules','runs','templates','knowledge','team','audit','leads','providerEvents','scheduled'];
const SYNC_META=['settings','billing','integrations'];
let synced=new Map(), revs={};
function syncRecords(st){
  const map=new Map();
  for(const c of SYNC_LISTS)(Array.isArray(st[c])?st[c]:[]).forEach((item,i)=>{
    if(c==='providerEvents'){map.set(c+'/'+item,{c,id:String(item),json:JSON.stringify({id:item})});return;}
    const id=String(item?.id??`${c}-${i}`);map.set(c+'/'+id,{c,id,json:JSON.stringify(item)});
  });
  for(const k of SYNC_META)map.set('_meta/'+k,{c:'_meta',id:k,json:JSON.stringify(st[k]||{})});
  return map;
}
const markSynced=()=>{synced=syncRecords(state);};
function pushChanges(){
  savePending=savePending.then(async()=>{
    if(saveBlocked||!state)return;
    const current=syncRecords(state),changes=[],removes=[];
    for(const [k,v] of current)if(synced.get(k)?.json!==v.json)changes.push({c:v.c,id:v.id,data:JSON.parse(v.json),rev:revs[k]});
    for(const [k,v] of synced)if(!current.has(k))removes.push({c:v.c,id:v.id,rev:revs[k]});
    if(!changes.length&&!removes.length)return;
    try{
      for(let i=0;i<Math.max(changes.length,removes.length);i+=500){
        const batch={changes:changes.slice(i,i+500),removes:removes.slice(i,i+500)};
        const response=await fetch(wsApi+'/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error||'Workspace changes could not be saved.');
        adminRevision=result.revision;
        if(result.conflicts?.length){applyConflicts(result.conflicts);return;}
        for(const ch of batch.changes){const k=ch.c+'/'+ch.id;synced.set(k,current.get(k));revs[k]=result.revs[k];}
        for(const rm of batch.removes){const k=rm.c+'/'+rm.id;synced.delete(k);delete revs[k];}
      }
    }catch(error){
      if(/plan includes/.test(error.message)){notify(error.message);await reloadWorkspace();return;}
      saveBlocked=true;
      adminError=error.message+' Reload to continue.';
      render();
    }
  });
}
// Someone else saved the same record first: take their version, keep any messages we added, then resend.
function applyConflicts(conflicts){
  for(const cf of conflicts){
    const k=cf.c+'/'+cf.id;
    if(cf.c==='_meta'){if(cf.data)state[cf.id]=cf.data;}
    else if(cf.c!=='providerEvents'){
      const list=state[cf.c],idx=list.findIndex(item=>String(item.id)===cf.id);
      if(!cf.data){if(idx>=0)list.splice(idx,1);}
      else{
        let data=cf.data;
        if(cf.c==='threads'&&idx>=0){
          const known=new Set(data.messages.map(m=>m.id));
          data={...data,messages:[...data.messages,...list[idx].messages.filter(m=>!known.has(m.id))].sort((a,b)=>String(a.time).localeCompare(String(b.time)))};
        }
        if(idx>=0)list[idx]=data;else list.push(data);
      }
    }
    if(cf.data){synced.set(k,{c:cf.c,id:cf.id,json:JSON.stringify(cf.c==='providerEvents'?{id:cf.id}:cf.data)});revs[k]=cf.rev;}
    else{synced.delete(k);delete revs[k];}
  }
  notify('A teammate changed something you were editing. You’re now seeing their latest version.');
  render();
  pushChanges();
}
async function reloadWorkspace(){
  const response=await fetch(wsApi,{cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Unable to refresh.');
  const drafts=state?.draft||{};
  state=result.state?upgrade(result.state):state;
  state.draft={...state.draft,...drafts};
  revs=result.revs||{};adminRevision=result.revision;
  markSynced();render();
  return result;
}
const route = () => (location.hash.slice(1)||(isWorkerAdmin?'dashboard':'home')).split('/')[0];
const logged = () => isAdminSession() || (isWorkerAdmin ? Boolean(adminEmail) : sessionStorage.getItem('hushhawk.demo.login')==='yes');
const head = (title,description,actions='') => `<div class="heading"><div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;
const card = (title,content,action='') => `<section class="card"><div class="cardhead"><h2>${title}</h2>${action}</div>${content}</section>`;
const empty = text => `<p class="empty">${esc(text)}</p>`;
const table = (headings, rows) => rows.length ? `<div class="tablewrap"><table><thead><tr>${headings.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('No records in this view.');
const brand = () => `<a class="brand" href="#home"><span class="mark">${icon('brand')}</span><span>HushHawk<small>PROPERTY MANAGEMENT</small></span></a>`;
const nav = [
  ['Workspace',[['dashboard','Overview','dashboard'],['inbox','Unified Inbox','inbox'],['voice','Voice Center','phone'],['outbox','Outbox & Reminders','calendar'],['assistant','AI Assistant','ai'],['automations','Automations','flow']]],
  ['Portfolio',[['contacts','Contacts','people'],['properties','Properties & Units','building'],['maintenance','Maintenance','tool'],['tasks','Tasks','tasks'],['calendar','Calendar','calendar']]],
  ['Administration',[['templates','Templates','file'],['analytics','Analytics','chart'],['integrations','Integrations','plug'],['team','Team','people'],['billing','Billing','billing'],['settings','Settings','settings'],['admin','Super Admin','settings']]]
];
const roleHides = id => account && ((id==='billing'&&!['owner','finance'].includes(account.user.role))||(id==='team'&&!['owner','admin'].includes(account.user.role)));
const navFor = () => nav.map(([group,items])=>[group,account&&group==='Administration'?[...items.filter(([id])=>id!=='admin'&&!roleHides(id)),['support','Support','people']]:items.filter(([id])=>!(account&&id==='admin')&&!roleHides(id))]);
const accountBanner = () => {
  const s=account?.subscription;
  if(!s)return '';
  const owner=account.user.role==='owner';
  if(s.status==='past_due')return `<div class="banner acct-banner warn"><span><strong>Payment overdue.</strong> ${owner?'Pay the open invoice to keep your workspace running.':'Ask your company owner to pay the open invoice.'}</span>${owner?link('Pay now','billing',true):''}</div>`;
  const days=Math.ceil((new Date(s.periodEnd)-Date.now())/864e5);
  if(s.status==='trialing'&&days<=5)return `<div class="banner acct-banner"><span><strong>Your free trial ends in ${days} day${days===1?'':'s'}.</strong> ${owner?'Your first invoice arrives then.':'Your company owner will be invoiced then.'}</span>${owner?link('See billing','billing'):''}</div>`;
  if(s.cancelAtPeriodEnd&&days<=14)return `<div class="banner acct-banner"><span><strong>Your subscription ends ${when(s.periodEnd)}.</strong></span>${owner?link('Resume','billing'):''}</div>`;
  return '';
};
const quickRoutes = [['dashboard','Overview','dashboard'],['inbox','Inbox','inbox'],['maintenance','Maintenance','tool'],['tasks','Tasks','tasks']];
function shell(page, html) {
  const label = navFor().flatMap(group=>group[1]).find(([id])=>id===page)?.[1]||'Overview';
  const stateBadgeHtml = account ? `<a class="workspace-state admin-workspace-pill" href="#billing" title="Your plan">${esc(account.plan?.name||'')}</a>` : isAdminSession()
    ? '<span class="workspace-state admin-workspace-pill" title="Administrator Session">Super Admin</span>'
    : (isWorkerAdmin ? '<span class="workspace-state admin-workspace-pill" title="Authenticated workspace">Admin</span>' : `<span class="workspace-state" title="Browser-local demo workspace">${navigator.onLine?'Demo':'Offline'}</span>`);
  const readOnly=account&&['viewer','finance'].includes(account.user.role)?`<div class="banner acct-banner"><span><strong>Read-only access.</strong> Your role (${esc(account.user.roleLabel)}) can view the workspace but not change it.</span></div>`:'';
  return `<div class="shell workspace-v2"><aside class="sidebar${menu?' open':''}" id="navigation">${brand()}<button class="btn menu-close" data-action="menu">Close navigation</button><nav aria-label="Workspace">${navFor().map(([group,items])=>`<div class="navgroup">${group}</div>${items.map(([id,name,glyph])=>`<a href="#${id}" class="navlink${page===id?' active':''}${allowed(id)?'':' locked'}"${page===id?' aria-current="page"':''}${allowed(id)?'':' title="Not included in your plan"'}>${icon(glyph)}${name}${allowed(id)?'':icon('lock')}</a>`).join('')}`).join('')}</nav><div class="sidebar-foot"><span class="avatar">${esc(initials(currentActorName()))}</span><div><strong>${esc(currentActorName())}</strong><small>${esc(currentRoleLabel())}</small></div></div></aside><div><header class="top"><div class="left"><button class="btn icon menu" data-action="menu" aria-label="Toggle navigation" aria-controls="navigation" aria-expanded="${menu}">${icon('menu')}</button><strong class="mobilehidden">${label}</strong>${stateBadgeHtml}</div><div class="right"><button class="btn icon" data-action="quick" aria-label="Quick search" title="Quick search">${icon('search')}</button><select aria-label="Filter workspace by property" data-change="scope">${options(propertyOptions('All properties'),scope)}</select><button class="btn icon mobilehidden" data-action="notifications" aria-label="Notifications">${icon('bell')}</button><button class="btn icon" data-action="logout" aria-label="Sign out" title="Sign out">${icon('out')}</button>${avatar(currentActorName())}</div></header><main class="content" id="main">${accountBanner()}${readOnly}${html}</main><nav class="mobile-tabs" aria-label="Quick navigation">${quickRoutes.map(([id,label,glyph])=>`<a href="#${id}" ${page===id?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav></div></div>`;
}
function chart(threads,days) {
  const buckets = Array.from({length:days},(_,i)=>{
    const date=new Date();
    date.setDate(date.getDate()-days+i+1);
    const label=date.toLocaleDateString(undefined,{weekday:'short',day:days>7?'numeric':undefined});
    const values=['SMS','Email','Voice'].map(group=>threads.flatMap(thread=>thread.messages.map(message=>({channel:thread.channel,...message}))).filter(message=>message.kind!=='note' && new Date(message.time).toDateString()===date.toDateString() && (group==='Voice'?['Call','Voicemail'].includes(message.channel):message.channel===group)).length);
    return {label,values};
  });
  const max=Math.max(1,...buckets.flatMap(bucket=>bucket.values));
  return `<div class="pad"><div class="chart" role="img" aria-label="${esc(buckets.map(b=>`${b.label}, SMS ${b.values[0]}, email ${b.values[1]}, voice ${b.values[2]}`).join('; '))}">${buckets.map(bucket=>`<div class="barset">${bucket.values.map((value,i)=>`<div class="bar" title="${esc(bucket.label)} · ${['SMS','Email','Voice'][i]} · ${value}" style="height:${value/max*100}%"></div>`).join('')}</div>`).join('')}</div><div class="chartlabels" aria-hidden="true">${buckets.map(bucket=>`<small>${esc(bucket.label)}</small>`).join('')}</div><div class="legend">${['SMS','Email','Voice'].map((label,i)=>`<small><i style="background:${['#2765cc','#62b5f8','#80d0c1'][i]}"></i>${label}</small>`).join('')}</div></div>`;
}
const sorted = threads => [...threads].sort((a,b)=>b.updated.localeCompare(a.updated));
const scopedThreads = () => sorted(state.threads.filter(threadScope));
const scopedTickets = () => state.tickets.filter(item=>inScope(item.property));
const scopedCalls = () => state.calls.filter(item=>inScope(contact(item.contact)?.property));
const scopedApprovals = () => state.approvals.filter(item=>{const thread=by('threads',item.thread);return thread&&threadScope(thread);});
function recent(threads, lookup=contact, destination=thread=>'inbox/'+thread.id) {
  return threads.length ? threads.map(thread=>{
    const tenant=lookup(thread.contact);
    return `<a class="item" href="#${destination(thread)}">${avatar(tenant?.name)}<div class="grow"><strong>${esc(tenant?.name)}</strong><small>${esc(thread.subject)}</small></div>${badge(thread.channel)}<small>${when(thread.updated)}</small></a>`;
  }).join('') : empty('No conversations for this property.');
}
function dashboard() {
  const threads=scopedThreads(), tickets=scopedTickets().filter(t=>!['Resolved','Closed'].includes(t.status));
  const metrics=[
    ['Conversations',threads.length,'inbox','inbox'],
    ['Unread',threads.filter(t=>t.unread).length,'inbox/unread','inbox'],
    ['Pending approvals',scopedApprovals().filter(a=>a.status==='Pending').length,'assistant','ai'],
    ['Open maintenance',tickets.length,'maintenance','tool'],
    ['Missed calls',scopedCalls().filter(c=>c.status==='Missed').length,'voice/missed','phone'],
    ['Emergency conversations',threads.filter(t=>t.priority==='Emergency'&&t.status==='Open').length,'inbox/emergency','bell'],
    ['Resolved with assisted reply',threads.filter(t=>t.status==='Resolved'&&t.messages.some(m=>m.approval)).length,'analytics','check'],
    ['Open team tasks',state.tasks.filter(t=>t.status==='Open'&&taskScope(t)).length,'tasks','tasks']
  ];
  if(isAdmin&&!state.properties.length&&!scope&&!state.threads.length&&!state.tickets.length){
    return head('Overview','Set up your portfolio and start tracking work.',button('Add property','edit',{id:'properties',primary:true,glyph:'plus'}))+
      `<section class="workspace-start"><div><span class="start-icon">${icon('building')}</span><h2>Start with your first property</h2><p>Add a building and its units. Then you can link contacts and track maintenance against the right address.</p>${button('Add first property','edit',{id:'properties',primary:true,glyph:'plus'})}</div><aside><h3>Portfolio setup</h3><a href="#properties">${icon('building')} Add properties and units</a><a href="#contacts">${icon('people')} Organize contacts</a><a href="#maintenance">${icon('tool')} Track maintenance requests</a></aside></section>`+
      `<div class="columns">${card('Recent conversations',empty('Conversations will appear when communication providers are connected.'),link('Integrations','integrations'))}${card('Maintenance queue',tickets.length?table(['Request','Status'],tickets.map(t=>[esc(t.title),statusBadge(t.status)])):empty('No open maintenance requests.'),link('Maintenance','maintenance'))}</div>`;
  }
  return `<section class="overview-hero"><div><div class="eyebrow">${esc(scope?property(scope)?.name:state.settings.company)}</div><h1>Property overview</h1><p>Manage conversations, approvals, and maintenance across your portfolio.</p></div><div class="actions">${link('Open inbox','inbox')}${isAdmin?button('Add property','edit',{id:'properties',primary:true,glyph:'plus'}):button('Simulate incoming event','simulate',{primary:true,glyph:'plus'})}</div></section>`+
    `<div class="tiles">${metrics.map(([label,count,url,glyph])=>`<a class="card metric" href="#${url}">${icon(glyph)}<strong>${count}</strong><small>${label}</small></a>`).join('')}</div><div class="columns">${card('Communication activity',chart(threads,7),badge('Last 7 days'))}${card('Recent conversations',recent(threads.slice(0,5)),link('Open inbox','inbox'))}</div>`+
    card('Maintenance queue',table(['Request','Property','Priority','Status'],tickets.slice(0,5).map(t=>[`<a href="#maintenance/${t.id}">${esc(t.title)}</a>`,esc(property(t.property)?.name||'Unverified'),statusBadge(t.priority),statusBadge(t.status)])),link('View maintenance','maintenance'));
}
function matchingThreads() {
  const query=filter.q.trim().toLowerCase();
  return scopedThreads().filter(thread=>{
    const tenant=contact(thread.contact);
    const searchable=[tenant?.name,tenant?.phone,tenant?.email,thread.subject,thread.category,...(thread.labels||[]),...thread.messages.map(m=>m.body)].join(' ').toLowerCase();
    return (!query||searchable.includes(query))&&(!filter.channel||thread.channel===filter.channel)&&
      (!filter.status||(filter.status==='Unread'?thread.unread:filter.status==='Emergency'?thread.priority==='Emergency'&&thread.status==='Open':filter.status==='Assigned to me'?thread.assigned==='u1':thread.status===filter.status));
  });
}
function inbox() {
  const threads=matchingThreads();
  const thread=threads.find(item=>item.id===selected)||threads[0];
  if(thread) selected=thread.id;
  const tenant=contact(thread?.contact);
  const draft=thread?state.draft[thread.id]||{}:{};
  const canSend=!!thread&&canReply(thread)&&!(thread.channel==='Email'&&contact(thread.contact)?.emailBounced)&&(!isWorkerAdmin||isAdminSession()||(adminSms.configured&&thread.channel==='SMS')||(account&&wsEmailInbox.configured&&thread.channel==='Email'));
  const choices=state.templates.filter(t=>t.channel===thread?.channel);
  return head('Unified Inbox','Search tenant conversations and manage replies, assignments, and notes.',isWorkerAdmin&&!isAdminSession()?button('Refresh inbox','refreshLive',{glyph:'inbox'}):button('Simulate inbound','simulate',{glyph:'plus'})+button('New conversation','compose',{primary:true,glyph:'send'}))+
  `<div class="filters"><input data-input="search" aria-label="Search conversations" placeholder="Search names, subjects or messages…" value="${esc(filter.q)}"><select data-change="channel" aria-label="Channel">${options([['','All channels'],...channels],filter.channel)}</select><select data-change="status" aria-label="Conversation status">${options([['','All statuses'],'Unread','Assigned to me','Emergency',...statuses],filter.status)}</select>${button('Export CSV','export',{id:'inbox'})}</div>
  <div class="inbox card${mobileThread&&thread?' mobile-thread':''}"><section class="threads" aria-label="Conversation list"><div class="cardhead"><h2>Conversations</h2>${badge(threads.length)}</div>${threads.length?threads.map(item=>{
    const c=contact(item.contact);
    return `<button type="button" class="item${thread?.id===item.id?' selected':''}" data-action="thread" data-id="${item.id}" aria-pressed="${thread?.id===item.id}">${avatar(c?.name)}<span class="grow"><strong>${esc(c?.name||'Unknown sender')}${item.unread?' •':''}</strong><small>${esc(item.subject)}</small></span><small>${esc(item.channel)}</small></button>`;
  }).join(''):empty('No matching conversations.')}</section>
  <section class="thread" aria-label="Message thread">${thread?`<div class="mobile-conversation-nav">${button('All conversations','conversationList')}${button('Contact details','contactDetails')}</div><div class="cardhead"><div><h2>${esc(thread.subject)}</h2><small>${esc(tenant?.name)} · ${esc(thread.channel)}${thread.category?' · '+esc(thread.category):''}</small></div>${statusBadge(thread.priority)}</div>
  <div class="messages">${thread.messages.map(message=>`<div class="bubble ${message.kind}">${esc(message.body)}${message.ai?`<span class="ai-chip">${message.kind==='in'?`AI: ${esc(message.ai.category)} · ${esc(message.ai.urgency)}${message.ai.sentiment&&message.ai.sentiment!=='neutral'?' · '+esc(message.ai.sentiment):''} · ${pct(message.ai.confidence)}`:`Sent by AI · ${pct(message.ai.confidence)}${message.ai.citations?.length?' · '+message.ai.citations.map(c=>esc(c.title)).join(', '):''}`}</span>`:''}${(message.attachments||[]).length?`<span class="attachments">${message.attachments.map(a=>/^image\//.test(a.type)?`<a href="/api/files/${esc(a.id)}" target="_blank" rel="noopener"><img src="/api/files/${esc(a.id)}" alt="${esc(a.name)}" loading="lazy"></a>`:`<a class="file-chip" href="/api/files/${esc(a.id)}">${icon('file')} ${esc(a.name)}</a>`).join('')}</span>`:''}<small>${({in:thread.channel==='Call'?'Call event':'Received',out:isAdmin?`${message.actor||'Staff'} · ${message.delivery||'recorded'}`:'Simulated • saved',note:'Internal note'})[message.kind]} · ${dateTime(message.time)}</small></div>`).join('')}</div>
  <div class="composer"><form data-form="reply" data-id="${thread.id}"><label>${canSend?'Reply or add a note':'Internal note'}<textarea name="body" data-input="draft" data-id="${thread.id}" maxlength="5000" placeholder="${canSend?'Write a reply…':'Write an internal note…'}" required>${esc(draft.body)}</textarea></label><div class="actions">${canSend?`<button class="btn primary" name="intent" value="send">${icon('send')} ${isWorkerAdmin&&!isAdminSession()?(thread.channel==='Email'?'Send email':'Send SMS'):'Send message'}</button>`:''}<button class="btn" name="intent" value="note">Add note</button>${canSend||(account&&allowed('assistant')&&!tenant?.optout)?button('Draft with AI','suggest',{id:thread.id,glyph:'ai'}):''}${canSend?button('Schedule','schedule',{id:thread.id}):''}</div></form>
  ${choices.length&&canSend?`<select aria-label="Insert template" data-change="insert" data-id="${thread.id}">${options([['','Insert a template'],...choices.map(t=>[t.id,t.name])],'')}</select>`:''}
  ${tenant?.optout?'<small>Contact opted out. Sending is blocked.</small>':''}</div>`:empty('Select a conversation to see its timeline.')}</section>
  <section aria-label="Conversation details" id="thread-details" tabindex="-1"><div class="cardhead"><h2>Contact details</h2></div>${thread?`<div class="details">${thread.aiSummary?`<div class="ai-summary"><strong>AI summary</strong><p>${esc(thread.aiSummary.summary)}</p>${thread.aiSummary.next_step?`<small>Next: ${esc(thread.aiSummary.next_step)}</small>`:''}</div>`:''}<div class="row">${avatar(tenant?.name)}<strong>${esc(tenant?.name||'Unknown sender')}</strong></div><small>${esc(property(tenant?.property)?.name||'Unverified property')}${tenant?.unit?' · Unit '+esc(tenant.unit):''}</small>${badge(tenant?.verified?'Verified':'Unverified',tenant?.verified?'good':'')}<hr>
  <label>Status<select data-change="threadStatus" data-id="${thread.id}">${options(statuses,thread.status)}</select></label><label>Priority<select data-change="priority" data-id="${thread.id}">${options(priorities,thread.priority)}</select></label>
  <label>Assigned to<select data-change="assign" data-id="${thread.id}">${options(teamOptions(),thread.assigned)}</select></label>
  ${button(thread.unread?'Mark read':'Mark unread','unread',{id:thread.id})}${button('Create ticket','ticket',{id:thread.id})}${isAdmin?state.tickets.filter(t=>t.thread===thread.id).map(t=>link('Issue · '+t.status,'maintenance/'+t.id)).join(''):''}${button('Add follow-up','task',{id:thread.id})}${tenant?link('Contact history','contacts/'+tenant.id):''}${button('Summarize timeline','summary',{id:thread.id})}${button('Edit labels','labels',{id:thread.id})}<div class="row">${(thread.labels||[]).map(label=>badge(label)).join('')}</div>${button('Set reminder','reminder',{id:thread.id})}${thread.followUp?`<small>Reminder · ${dateTime(thread.followUp)}</small>`:''}${button(thread.automationPaused?'Resume rules':'Pause rules','pauseThread',{id:thread.id})}</div>`:''}</section></div>`;
}
function voice() {
  const calls=scopedCalls().filter(c=>!location.hash.endsWith('/missed')||c.status==='Missed');
  return head('Voice Center',account?'Voice calls aren’t available yet. Call history and voicemail will appear here when HushHawk switches them on.':isWorkerAdmin&&!isAdminSession()?'Connect a voice provider to receive calls and voicemail.':'Review call activity, read voicemail transcripts, and create callback tasks.',isWorkerAdmin&&!isAdminSession()?link('Integrations','integrations'):button('Simulate call','simulate',{id:'Call',primary:true,glyph:'phone'}))+
  card('Call history',table(['Caller','Disposition','Time','Duration','Actions'],calls.map(c=>[esc(contact(c.contact)?.name),statusBadge(c.status),dateTime(c.date),esc(c.duration),`<div class="actions">${link('Timeline','inbox/'+c.thread)}${button('Call details','call',{id:c.id})}${button('Create callback','task',{id:c.thread})}</div>`])),link(location.hash.endsWith('/missed')?'All calls':'Missed calls',location.hash.endsWith('/missed')?'voice':'voice/missed'));
}
const field = (label,name,value='',type='text',required=true) => `<label>${label}<input type="${type}" name="${name}" value="${esc(value)}"${required?' required':''} maxlength="240"></label>`;
const select = (label,name,values,value='',required=false) => `<label>${label}<select name="${name}"${required?' required':''}>${options(values,value)}</select></label>`;
const area = (label,name,value='',required=true) => `<label>${label}<textarea name="${name}" maxlength="5000"${required?' required':''}>${esc(value)}</textarea></label>`;
// ---- CSV import for contacts and properties
const CSV_FIELDS={
  contacts:[['name','Name',true,/^(full ?)?name|tenant|contact$/i],['email','Email',false,/e-?mail/i],['phone','Phone',false,/phone|mobile|cell|tel/i],['type','Type (Tenant, Owner, Vendor, Other)',false,/type|role|category/i],['property','Property name',false,/property|building/i],['unit','Unit',false,/unit|apt|apartment|suite/i]],
  properties:[['name','Property name',true,/^(property|building)?\s*name$|^property$|^building$/i],['address','Address',false,/address|street|location/i],['units','Units (separate with , or ;)',false,/units?|apartments?/i]]
};
let csvDraft=null;
function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
    else if(ch==='"')quoted=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()))rows.push(row);row=[];}
    else field+=ch;
  }
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
const normalizePhone=value=>{const digits=String(value||'').replace(/[^\d+]/g,'');if(!digits)return '';if(digits.startsWith('+'))return '+'+digits.slice(1).replace(/\D/g,'');const d=digits.replace(/\D/g,'');return d.length===10?'+1'+d:d.length===11&&d.startsWith('1')?'+'+d:d;};
function csvStepOne(type){
  csvDraft={type};
  formModal(`Import ${type} from CSV`,'csvUpload',`<label class="wide">CSV file<input type="file" name="file" accept=".csv,text/csv"></label><label class="wide">Or paste CSV<textarea name="text" rows="6" placeholder="${type==='contacts'?'name,email,phone,property,unit':'name,address,units'}"></textarea></label><p class="muted wide">The first row should be column headings. You’ll match columns to fields next. Exports from RentRedi or a spreadsheet work.</p>`,type,'Next');
}
function csvPlan(){
  const {type,headers,rows,map}=csvDraft,fields=CSV_FIELDS[type];
  const value=(row,key)=>map[key]===''||map[key]===undefined?'':String(row[Number(map[key])]??'').trim();
  const add=[],skipped=[];
  const seenEmail=new Set(state.contacts.map(c=>String(c.email||'').toLowerCase()).filter(Boolean));
  const seenPhone=new Set(state.contacts.map(c=>normalizePhone(c.phone)).filter(Boolean));
  const seenName=new Set(state.properties.map(p=>p.name.trim().toLowerCase()));
  rows.forEach((row,i)=>{
    const line=i+2;
    const name=value(row,'name');
    if(!name){skipped.push(`Row ${line}: no name`);return;}
    if(type==='properties'){
      if(seenName.has(name.toLowerCase())){skipped.push(`Row ${line}: ${name} already exists`);return;}
      seenName.add(name.toLowerCase());
      add.push({id:uid(),name,address:value(row,'address'),units:value(row,'units').split(/[;,]/).map(u=>u.trim()).filter(Boolean).join(', ')});
    }else{
      const email=value(row,'email').toLowerCase(),phone=normalizePhone(value(row,'phone'));
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){skipped.push(`Row ${line}: invalid email ${email}`);return;}
      if((email&&seenEmail.has(email))||(phone&&seenPhone.has(phone))){skipped.push(`Row ${line}: ${name} already exists`);return;}
      if(email)seenEmail.add(email);if(phone)seenPhone.add(phone);
      const typeValue=['Tenant','Owner','Vendor','Other'].find(t=>t.toLowerCase()===value(row,'type').toLowerCase())||'Tenant';
      const prop=state.properties.find(p=>p.name.trim().toLowerCase()===value(row,'property').toLowerCase());
      add.push({id:uid(),name,type:typeValue,email,phone,property:prop?.id||'',unit:prop?value(row,'unit'):'',verified:false,optout:false});
    }
  });
  return {add,skipped,fields};
}
function csvStepTwo(){
  const {type,headers,rows}=csvDraft,fields=CSV_FIELDS[type];
  csvDraft.map??=Object.fromEntries(fields.map(([key,,,guess])=>{const i=headers.findIndex(h=>guess.test(h.trim()));return [key,i>=0?String(i):''];}));
  const plan=csvPlan();
  const limit=account?.entitlements?.properties;
  const over=type==='properties'&&limit&&state.properties.length+plan.add.length>limit;
  if(dialog.open)dialog.close();
  dialog.innerHTML=`<h2 id="dialog-title">Match your columns</h2><form data-form="csvMap"><div class="formgrid">${fields.map(([key,label,required])=>`<label>${esc(label)}${required?' *':''}<select name="map-${key}" data-change="csvMap">${options([['','Not in my file'],...headers.map((h,i)=>[String(i),h||`Column ${i+1}`])],csvDraft.map[key])}</select></label>`).join('')}</div>
    <div class="csv-preview"><strong>${plan.add.length} ${esc(type)} ready to import</strong>${plan.skipped.length?` · ${plan.skipped.length} skipped`:''}${over?`<p class="csv-warn">Your ${esc(account.plan.name)} plan allows ${limit} properties. Remove rows or upgrade first.</p>`:''}
    ${plan.add.length?`<div class="tablewrap"><table><thead><tr>${fields.map(([,label])=>`<th>${esc(label.split(' (')[0])}</th>`).join('')}</tr></thead><tbody>${plan.add.slice(0,5).map(r=>`<tr>${fields.map(([key])=>`<td>${esc(key==='property'?(property(r.property)?.name||''):r[key]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}
    ${plan.skipped.length?`<details><summary>Skipped rows</summary><ul>${plan.skipped.slice(0,50).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}</div>
    <p class="dialog-status" role="status"></p><div class="actions"><button class="btn primary"${plan.add.length&&!over?'':' disabled'}>Import ${plan.add.length}</button>${button('Back','csvImport',{id:type})}${button('Cancel','close')}</div></form>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.showModal();
}
function formModal(title,kind,fields,id='',submit='Save') {
  if(dialog.open) dialog.close();
  dialog.innerHTML=`<h2 id="dialog-title">${esc(title)}</h2><form data-form="${kind}" data-id="${esc(id)}"><div class="formgrid">${fields}</div><p class="dialog-status" role="status"></p><div class="actions"><button class="btn primary">${esc(submit)}</button>${button('Cancel','close')}</div></form>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.showModal();
}
function info(title,html) {
  if(dialog.open) dialog.close();
  dialog.innerHTML=`<h2 id="dialog-title">${esc(title)}</h2><div class="detail-list">${html}</div><div class="actions">${button('Close','close')}</div>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.showModal();
}
const collections = {
  contacts:{title:'Contacts',singular:'Contact',icon:'people',description:'Manage tenants, owners, vendors, and other contacts.',columns:['Name','Type','Property / Unit','Verification','Consent'],
    cells:r=>[esc(r.name),esc(r.type),esc([property(r.property)?.name,r.unit&&'Unit '+r.unit].filter(Boolean).join(' · ')||'—'),badge(r.verified?'Verified':'Unverified'),badge(r.optout?'Opted out':'Available')],
    fields:r=>field('Name','name',r.name)+select('Type','type',['Tenant','Owner','Vendor','Other'],r.type)+field('Email','email',r.email,'email',false)+field('Telephone','phone',r.phone,'tel',false)+select('Property','property',propertyOptions('No property'),r.property||scope)+field('Unit','unit',r.unit,'text',false)+select('Verification','verified',[['false','Unverified'],['true','Verified']],String(!!r.verified))+select('Communication consent','optout',[['false','Available'],['true','Opted out']],String(!!r.optout))},
  properties:{title:'Properties & Units',singular:'Property',icon:'building',description:'Manage buildings, unit identifiers, and tenant relationships.',columns:['Property','Address','Units','Contacts'],
    cells:r=>[esc(r.name),esc(r.address),esc(r.units),state.contacts.filter(c=>c.property===r.id).length],
    fields:r=>field('Property name','name',r.name)+field('Address','address',r.address)+field('Unit IDs, comma separated','units',r.units,'text',false)},
  tickets:{title:'Maintenance',singular:'Ticket',icon:'tool',description:'Triage tenant requests and track assignments through resolution.',columns:['Request','Property','Priority','Status','Assigned'],
    cells:r=>[esc(r.title),esc(property(r.property)?.name||'Unverified'),statusBadge(r.priority),statusBadge(r.status),esc(person(r.assigned)?.name||'Unassigned')],
    fields:r=>field('Request title','title',r.title)+select('Property','property',propertyOptions('Unverified'),r.property||scope)+select('Contact','contact',contactOptions('Unverified'),r.contact)+select('Priority','priority',priorities,r.priority||'Normal')+select('Status','status',ticketStatuses,r.status)+select('Assigned to','assigned',teamOptions(),r.assigned)+area('Description','description',r.description)},
  tasks:{title:'Tasks',singular:'Task',icon:'tasks',description:'Assign follow-ups, callbacks, and operational work.',columns:['Task','Assigned','Due','Status'],
    cells:r=>[esc(r.title),esc(person(r.assigned)?.name||'Unassigned'),esc(r.due||'—'),statusBadge(r.status)],
    fields:r=>field('Task title','title',r.title)+select('Assigned to','assigned',teamOptions(),r.assigned)+field('Due date','due',r.due,'date',false)+select('Status','status',['Open','Done'],r.status)},
  events:{title:'Calendar',singular:'Appointment',icon:'calendar',description:'Schedule service visits, follow-ups, and appointments.',columns:['Appointment','Date','Time','Property'],
    cells:r=>[esc(r.title),esc(r.date),esc(r.time),esc(property(r.property)?.name||'All properties')],
    fields:r=>field('Appointment title','title',r.title)+field('Date','date',r.date,'date')+field('Time','time',r.time,'time')+select('Property','property',propertyOptions('All properties'),r.property||scope)+area('Notes','notes',r.notes,false)},
  templates:{title:'Templates',singular:'Template',icon:'file',description:'Create reusable replies for the inbox.',columns:['Name','Channel','Preview'],
    cells:r=>[esc(r.name),badge(r.channel),esc(r.body.slice(0,105))],
    fields:r=>field('Template name','name',r.name)+select('Channel','channel',['SMS','Email'],r.channel)+area('Message','body',r.body)},
  knowledge:{title:'Knowledge base',singular:'Knowledge entry',icon:'ai',description:'Maintain approved text for assisted replies.',columns:['Title','Topic','Approved text'],
    cells:r=>[esc(r.title),badge(r.topic),esc(r.body)],
    fields:r=>field('Title','title',r.title)+select('Topic','topic',['Office hours',...triggers.filter(topic=>!['Emergency','Missed call'].includes(topic))],r.topic)+area('Approved text','body',r.body)},
  team:{title:'Team',singular:'Team member',icon:'people',description:'Review team roles and simulate membership invitations.',columns:['Name','Email','Role','Status'],
    cells:r=>[esc(r.name),esc(r.email),esc(r.role),statusBadge(r.status)],
    fields:r=>field('Name','name',r.name)+field('Email','email',r.email,'email')+select('Role','role',['Company Owner','Property Manager','Communication Agent','Maintenance Coordinator','Finance Staff','Viewer / Auditor'],r.role||'Communication Agent')+select('Status','status',['Invited','Active','Inactive'],r.status||'Invited')},
  rules:{title:'Workflow rules',singular:'Rule',icon:'flow',description:'Create event-based workflows and inspect their results.',columns:['Rule','Trigger','Action','Status','Channel'],
    cells:r=>[esc(r.name),badge(r.trigger),esc(r.action),statusBadge(r.enabled?'Active':'Paused'),esc(r.channel||'Any')],
    fields:r=>field('Rule name','name',r.name)+select('When this happens','trigger',triggers,r.trigger)+select('Do this','action',ruleActions,r.action)+select('Status','enabled',[['true','Active'],['false','Paused']],String(r.enabled??true))+select('Channel condition','channel',[['','Any channel'],...channels],r.channel)+select('Property condition','property',propertyOptions('Any property'),r.property)+select('Priority condition','priority',[['','Any priority'],...priorities],r.priority)+field('Execution order (1–999)','order',r.order??50,'number')}
};
const taskScope = t => !scope||inScope(contact(by('threads',t.thread)?.contact)?.property);
const listScope = (name,r) => name==='properties'?inScope(r.id):['contacts','tickets','events'].includes(name)?inScope(r.property):name==='tasks'?taskScope(r):true;
function records(name) {
  const config=collections[name];
  const rows=state[name].filter(r=>listScope(name,r)).sort((a,b)=>name==='events'?a.date.localeCompare(b.date)||a.time.localeCompare(b.time):0);
  return table([...config.columns,'Actions'],rows.map(r=>[...config.cells(r),`<div class="actions">${button('Edit','edit',{id:name+'/'+r.id})}${name==='contacts'?link('History','contacts/'+r.id):''}${name==='properties'?button('View units','units',{id:r.id}):''}${r.thread?link('Conversation','inbox/'+r.thread):''}${name==='rules'?button('Test on event','testRule',{id:r.id})+(r.history?.length?button('Restore version','restoreRule',{id:r.id}):''):''}${name==='tasks'&&r.status==='Open'?button('Complete','complete',{id:r.id}):''}</div>`]));
}
function collectionPage(name,detail,extra='') {
  const config=collections[name];
  const item=by(name,detail);
  const history=name==='contacts'&&item?card(esc(item.name)+' · history',recent(sorted(state.threads.filter(t=>t.contact===item.id)))):'';
  const ticket=name==='tickets'&&item?card(esc(item.title),`<div class="pad"><p>${esc(item.description)}</p><p>${esc(contact(item.contact)?.name||'Unverified contact')} · ${when(item.date)}</p>${item.resolution?`<p><strong>Resolution</strong> · ${esc(item.resolution)} · ${when(item.resolvedOn)}</p>`:''}<div class="actions">${resolutionAction(item)}${item.thread?link('Open conversation','inbox/'+item.thread):''}</div></div>`):'';
  const canImport=['contacts','properties'].includes(name)&&(!account||['owner','admin'].includes(account.user.role));
  return head(config.title,config.description,extra+(canImport?button('Import CSV','csvImport',{id:name,glyph:'file'}):'')+button(name==='team'?'Simulate invitation':'Add '+config.singular.toLowerCase(),'edit',{id:name,primary:true,glyph:'plus'}))+
    history+ticket+card(config.title,records(name));
}
const AI_CATEGORY_LIST=['Maintenance','Missed call','Rent','Lease','Access','Noise','Appointment','Complaint','Vendor','General'];
const aiData={docs:null,runs:null,search:null,test:null,loading:false,error:''};
function loadAiData(force=false){
  if((aiData.docs&&!force)||aiData.loading)return;
  aiData.loading=true;
  Promise.all([api('/api/ai/knowledge'),api('/api/ai/history')]).then(([k,h])=>{aiData.docs=k.docs;aiData.runs=h.runs;aiData.error='';})
    .catch(error=>{aiData.error=error.message;}).finally(()=>{aiData.loading=false;if(route()==='assistant')render();});
}
const pct=n=>Math.round((Number(n)||0)*100)+'%';
const MODE_HELP={'Human approval':'The AI classifies every message and drafts a reply into the approval queue. Nothing is sent until a person approves it.',
  'Controlled automation':'The AI answers automatically only when it’s confident, the topic is one you allow, and the answer comes from your knowledge. Everything else waits for approval. Emergencies always go to staff.',
  'Suggestion only':'The AI classifies messages. Replies are drafted only when someone clicks “Draft with AI”.','Off':'No AI. Replies and triage are manual.'};
function accountAssistant(){
  loadAiData();
  const s=state.settings,mode=s.mode||'Human approval',manage=['owner','admin'].includes(account.user.role);
  const approvals=scopedApprovals();
  const autoCats=Array.isArray(s.aiAutoCategories)?s.aiAutoCategories:['General','Access','Appointment','Maintenance'];
  const docs=aiData.docs||[],runs=aiData.runs||[];
  const kindLabel={classify:'Classified',draft:'Drafted reply',auto_reply:'Automatic reply',summary:'Summary',sandbox:'Sandbox test',index:'Read document'};
  return head('AI Assistant','How the AI handles your messages, what it knows, and everything it has done.',link('Open inbox','inbox',true))+
    `<div class="banner"><span><strong>${esc(mode)}.</strong> ${esc(MODE_HELP[mode]||'')}</span>${badge(mode,mode==='Off'?'':'good')}</div>`+
    card('Approval queue',table(['Conversation','Suggested reply','AI confidence','Status','Actions'],approvals.map(a=>[
      `<a href="#inbox/${a.thread}">${esc(by('threads',a.thread)?.subject)}</a>`,`${esc(a.body)}${a.ai?.citations?.length?`<br><small>Based on: ${a.ai.citations.map(c=>esc(c.title)).join(', ')}</small>`:a.ai&&!a.ai.canAnswer?'<br><small>Not covered by your knowledge base · holding reply</small>':''}`,
      a.ai?badge(pct(a.ai.confidence),a.ai.confidence>=0.85?'good':''):'—',statusBadge(a.status),
      a.status==='Pending'?`<div class="actions">${button('Review and send','review',{id:a.id,primary:true})}${button('Reject','reject',{id:a.id})}</div>`:'—'])))+
    `<div class="ai-grid">`+
    card('Knowledge documents',`<div class="pad">${aiData.error?`<p class="muted">${esc(aiData.error)}</p>`:''}${docs.length?`<ul class="kb-list">${docs.map(d=>`<li><div><strong>${esc(d.title)}</strong><small>${esc(d.fileName||'Pasted text')} · version ${d.version} · ${d.chunks} passage${d.chunks===1?'':'s'} · ${when(d.updatedAt)}</small></div>${manage?button('Delete','kbDelete',{id:d.id}):''}</li>`).join('')}</ul>`:`<p class="muted">${aiData.loading?'Loading…':'No documents yet. Upload resident guides, policies and FAQs so answers come from your own information.'}</p>`}
      ${manage?`<form data-form="kbUpload" class="kb-upload"><label>Title<input name="title" required maxlength="120" placeholder="e.g. Resident handbook"></label><label>File (PDF, text, Markdown, CSV or HTML)<input type="file" name="file" accept=".pdf,.txt,.md,.csv,.html,.htm"></label><label>Or paste text<textarea name="text" rows="3"></textarea></label>${docs.length?select('Replace an existing document','replaceId',[['','No, add a new document'],...docs.map(d=>[d.id,`${d.title} (new version)`])]):''}<div class="actions"><button class="btn primary">Upload</button></div></form>`:''}</div>`)+
    card('Ask your knowledge base',`<form data-form="kbSearch" class="pad kb-search"><input name="query" required placeholder="e.g. When is trash pickup?"><button class="btn">Search</button></form>${aiData.search?`<div class="pad kb-results">${aiData.search.length?aiData.search.map(r=>`<div><strong>${esc(r.title)}</strong><p>${esc(r.text)}</p></div>`).join(''):'<p class="muted">Nothing found. Add a document that covers this.</p>'}</div>`:''}`)+
    `</div>`+
    card('Test the assistant',`<form data-form="aiTest" class="pad"><div class="formgrid"><label class="wide">Sample tenant message<textarea name="message" rows="3" required placeholder="e.g. Hi, what day is trash collected?"></textarea></label>${select('Channel','channel',['SMS','Email'])}${select('Sender','verified',[['true','Verified tenant'],['false','Unknown sender']])}</div><div class="actions"><button class="btn primary">Run test</button><small class="muted">Nothing is sent or saved to conversations.</small></div></form>${aiData.test?`<div class="pad ai-test"><div class="ai-test-tags">${badge(aiData.test.classification.category)}${badge(aiData.test.classification.urgency,aiData.test.classification.urgency==='emergency'?'urgent':'')}${badge(aiData.test.classification.sentiment)}${badge('Classification '+pct(aiData.test.classification.confidence))}${badge('Answer '+pct(aiData.test.draft.confidence),aiData.test.draft.confidence>=(Number(s.aiThreshold)||0.85)?'good':'')}</div><p><strong>Draft reply:</strong> ${esc(aiData.test.draft.reply)}</p>${aiData.test.draft.citations?.length?`<p><small>Based on: ${aiData.test.draft.citations.map(c=>esc(c.title)).join(', ')}</small></p>`:`<p><small>${esc(aiData.test.draft.can_answer?'Answered from company notes or templates.':'Not covered by your knowledge base.')}</small></p>`}<p class="ai-decision">${esc(aiData.test.decision)}</p></div>`:''}`)+
    (manage?card('Assistant settings',`<form data-form="aiSettings" class="pad"><div class="formgrid">
      ${select('Mode','mode',['Human approval','Controlled automation','Suggestion only','Off'],mode)}
      ${select('Classify every incoming message','aiClassify',[['true','On'],['false','Off']],String(s.aiClassify!==false))}
      <label>Answer automatically at or above (confidence)<input name="aiThreshold" type="number" min="0.5" max="0.99" step="0.01" value="${Number(s.aiThreshold)||0.85}"></label>
      ${select('Reply language','aiLanguage',['Match the tenant','English'],s.aiLanguage||'Match the tenant')}
      <label>Maximum reply length (characters)<input name="aiMaxLength" type="number" min="160" max="2000" step="10" value="${Number(s.aiMaxLength)||600}"></label>
      <fieldset class="wide ai-cats"><legend>Topics the AI may answer automatically (Controlled automation)</legend>${AI_CATEGORY_LIST.map(c=>`<label><input type="checkbox" name="aiAutoCategories" value="${c}"${autoCats.includes(c)?' checked':''}> ${c}</label>`).join('')}<small class="muted">Emergencies are never answered automatically. Unverified senders only get answers to general questions.</small></fieldset>
      <label class="wide">Topics the AI must never discuss<textarea name="aiBlockedTopics" rows="2" placeholder="e.g. evictions, security deposit disputes, legal advice">${esc(s.aiBlockedTopics||'')}</textarea></label>
      <label class="wide">Emergency instructions to include<textarea name="aiEmergencyText" rows="2" placeholder="e.g. Call 911, then our 24/7 line at 555-0100.">${esc(s.aiEmergencyText||'')}</textarea></label>
      </div><div class="actions"><button class="btn primary">Save assistant settings</button></div></form>`):'')+
    card('Company notes',records('knowledge'),button('Add note','edit',{id:'knowledge'}))+
    card('AI activity',runs.length?table(['When','What','Result','Conversation','By'],runs.slice(0,40).map(r=>[dateTime(r.at),esc(kindLabel[r.kind]||r.kind),r.status==='ok'?esc(r.summary):badge('Failed','urgent')+' '+esc(r.summary),r.thread&&by('threads',r.thread)?`<a href="#inbox/${r.thread}">${esc(by('threads',r.thread).subject)}</a>`:'—',esc(r.actor||'Automation')])):empty(aiData.loading?'Loading…':'No AI activity yet.'),button('Refresh','aiRefresh'));
}
function assistant() {
  if(account)return accountAssistant();
  const approvals=scopedApprovals();
  return head('AI Assistant','Review suggested replies and maintain the knowledge used to draft them.',link('Open inbox','inbox',true))+
    `<div class="banner"><span>${account?'“Draft with AI” in the inbox writes replies from your knowledge, templates and tone. A person reviews and sends every reply.':'Drafts use local rules and approved knowledge text. Outbound suggestions require approval.'}</span>${badge(state.settings.mode)}</div>`+
    card('Approval queue',table(['Conversation','Suggested reply','Status','Actions'],approvals.map(a=>[
    `<a href="#inbox/${a.thread}">${esc(by('threads',a.thread)?.subject)}</a>`,esc(a.body),statusBadge(a.status),a.status==='Pending'?`<div class="actions">${button('Review reply','review',{id:a.id,primary:true})}${button('Reject','reject',{id:a.id})}</div>`:'—'])))+
    '<div style="height:14px"></div>'+card('Knowledge base',records('knowledge'),button('Add entry','edit',{id:'knowledge'}));
}
function automations() {
  const rulesCard = card('Workflow rules',records('rules'),button(state.settings.automationPaused?'Resume active rules':'Pause all rules','pauseRules'));
  const runsCard = card('Execution history',table(['Rule','Conversation','Result','Executed'],state.runs.filter(r=>by('threads',r.thread)&&threadScope(by('threads',r.thread))).map(r=>[esc(r.name),`<a href="#inbox/${r.thread}">${esc(by('threads',r.thread)?.subject)}</a>`,statusBadge(r.result),dateTime(r.date)])));

  if(isWorkerAdmin && !isAdminSession() && !account) return head('Live SMS automation','See which tenant messages need staff attention and what the system sent back.',link('SMS settings','integrations'))+
    card('Inbound workflow',`<div class="pad detail-list"><div>${badge(adminSms.configured?'SMS configured':'SMS setup pending')}${badge(state.settings.liveSmsReplies&&!state.settings.automationPaused?'Auto-replies enabled':'Auto-replies off')}</div><p>Incoming SMS is saved in the inbox. Maintenance reports create tickets. Urgent reports create high-priority tickets and staff tasks. Replies acknowledge receipt, and staff record the actual resolution.</p><div class="actions">${link('Open issues','maintenance',true)}${link('Review tasks','tasks')}${button('Refresh activity','refreshLive')}</div></div>`)+
    '<div style="height:14px"></div>'+runsCard;

  const adminBanner = isAdminSession() ? `<div class="banner"><span><strong>Super Admin Rule Engine:</strong> Configured event triggers process incoming tenant inquiries, auto-label conversations, and route maintenance.</span>${badge(state.settings.automationPaused?'Rules paused':'Rules active',state.settings.automationPaused?'urgent':'good')}</div>` : '';

  return head('Automations','Build event rules for maintenance, callbacks, and the approval queue.',button('Simulate event','simulate')+button('Create rule','edit',{id:'rules',primary:true,glyph:'plus'}))+
    adminBanner + rulesCard + '<div style="height:14px"></div>' + runsCard;
}
function analytics() {
  const threads=scopedThreads();
  const cutoff = new Date();
  cutoff.setHours(0,0,0,0);
  cutoff.setDate(cutoff.getDate()-period+1);
  const records = channels.map(channel=>{
    const scoped=threads.filter(t=>t.channel===channel).flatMap(t=>t.messages).filter(m=>new Date(m.time)>=cutoff);
    return [channel,scoped.filter(m=>m.kind==='in').length,scoped.filter(m=>m.kind==='out').length,scoped.filter(m=>m.approval).length];
  });
  return head('Analytics','Review communication volume, assisted replies, and maintenance activity.',`<select aria-label="Analytics date range" data-change="period">${options([['7','Last 7 days'],['14','Last 14 days']],String(period))}</select>`+button('Export CSV','export',{id:'analytics'}))+
    card('Communication activity',chart(threads,period))+'<div style="height:14px"></div>'+card('Channel performance',table(['Channel','Inbound','Simulated outbound','Approved replies'],records))+
    '<div style="height:14px"></div>'+card('Maintenance status · all dates',table(['Status','Requests'],ticketStatuses.map(status=>[status,scopedTickets().filter(t=>t.status===status).length])));
}
const providers=[
  ['SMS & Voice','Twilio / managed telephony','Simulate inbound texts, calls, and voicemail.'],
  ['Shared Email','Mailbox or dedicated email service','Simulate inbound email and thread replies.'],
  ['RentRedi','Property and tenant data','Import a portfolio snapshot as JSON.'],
  ['AI Assistant','Local simulation','Draft with workspace knowledge and require approval.'],
  ['Calendar','Workspace calendar','Manage local appointments and service visits.']
];
function integrations() {
  const providerCards = `<div class="cards">${providers.map(([name,provider,description],i)=>`<div class="card pad"><div class="row">${icon('plug')}<h2>${name}</h2></div><small>${provider}</small><p>${description}</p>${badge(i>2?'Workspace connected':'Connected / Ready in workspace','good')}<div>${i<2?button('Simulate event','simulate',{id:i===1?'Email':'SMS'}):i===2?button('Import portfolio snapshot','import'):link('Open workspace',i===3?'assistant':'calendar')}</div></div>`).join('')}</div>`;

  if(isAdminSession() || isWorkerAdmin) {
    const twilioCard = account ? card('Texting & calls',`<div class="pad detail-list">${badge(adminSms.configured?'Texting on':adminSms.number?'Number assigned':'No number yet',adminSms.configured?'good':'')}<p>${adminSms.configured?`Tenants text <strong>${esc(adminSms.number)}</strong>. Replies you send from the inbox go out from this number.`:adminSms.number?`Your number is <strong>${esc(adminSms.number)}</strong>. HushHawk is finishing the provider setup, then texting switches on here.`:'HushHawk provides your texting number. Request one from Billing and it appears here once assigned.'}</p><p>${wsEmailInbox.configured?`Tenants can email <strong>${esc(wsEmailInbox.address)}</strong>. Their emails land in your inbox, and your replies go out from HushHawk with answers routed back here.`:'Email isn’t switched on yet. HushHawk will connect it.'}</p><p class="muted">Voice calls aren’t available yet. They’ll be switched on here when ready.</p><div class="actions">${account.user.role==='owner'?link('Request or view your number','billing'):''}${button('Refresh status','refreshLive')}</div></div>`) : card('Twilio SMS & Telephony Integration',`<div class="pad detail-list">${badge(adminSms.configured?'Provider active':'Provider ready in admin',adminSms.configured?'good':'')}<p>${adminSms.configured?`Configured sending number: ${esc(adminSms.number)}. Inbound webhook: ${esc(adminSms.webhookBase)}/api/sms/inbound`:'Dedicated communications channel active. Configure production Twilio number, SID, and auth token when deploying live.'}</p><label>Owner workspace ID<input value="${esc(adminSms.workspaceId||'hushhawk-admin-owner')}" readonly></label>${adminSms.configured?`<label>Inbound webhook URL<input value="${esc(adminSms.webhookBase)}/api/sms/inbound" readonly></label>`:''}<div class="actions">${button('Refresh status','refreshLive')}</div></div>`);
    const acknowledgmentsCard = card('Automatic acknowledgments & Intake routing',`<form class="pad detail-list" data-form="liveSmsSettings"><p>Send an immediate acknowledgment reply when tenants contact the property line. Staff triage, assignment, and resolution tracking continue automatically.</p>${select('Automatic acknowledgments','active',[['true','On - Automatic acknowledgment replies active'],['false','Off - Log and triage only']],String(state.settings.liveSmsReplies??true))}${account?select('Automatic email acknowledgments','emailActive',[['true','On - Reply to new emails automatically'],['false','Off - Log and triage only']],String(state.settings.liveEmailReplies??false)):''}<div class="actions"><button class="btn primary">Save acknowledgment settings</button></div></form>`);
    return head('Integrations','Manage messaging numbers, data connectors, and external communication providers.')+
      twilioCard + '<div style="height:14px"></div>' + acknowledgmentsCard + '<div style="height:14px"></div>' +
      card('Connected portfolio & workspace integrations', providerCards);
  }

  return head('Integrations','Review demo capabilities and the connection requirements for live service.') + providerCards;
}
function settings() {
  const s=state.settings;
  const extra=account?accountSettings(account):'';
  return head('Workspace settings','Manage company information, assistant preferences, and device access.',button('Install app','install',{primary:true}))+
    card(account?'Workspace preferences':'Company profile',`<form class="pad" data-form="settings"><div class="formgrid">${field(account?'Name used in replies':'Company name','company',s.company)+field('Timezone','timezone',s.timezone)+field('Business hours','hours',s.hours)+field('Assistant name','assistant',s.assistant)+select('AI mode','mode',account?['Human approval','Controlled automation','Suggestion only','Off']:['Human approval','Suggestion only','Off'],s.mode)+select('Reply tone','tone',['Professional','Friendly','Concise'],s.tone)}</div><div class="actions" style="margin-top:14px"><button class="btn primary">Save settings</button></div></form>`)+extra;
}
const plans=[
  ['Essential','$49 / month','Shared inbox, contacts, and maintenance tracking.'],
  ['Professional','$129 / month','Adds assisted replies, approvals, and workflow rules.'],
  ['Business','$299 / month','Adds multi-company administration and advanced portfolio reporting.']
];
function billing() {
  if(account&&!['owner','finance'].includes(account.user.role)) return head('Billing','Only your company owner or finance can see billing.')+empty('Ask the owner if you need an invoice or a plan change.');
  if(account?.plan) return billingPage(account,{properties:state.properties.length,team:state.team.length},render);
  state.billing ??= {plan:'Professional'};
  const currentPlan = state.billing.plan || 'Professional';
  const outCount = state.threads.flatMap(t=>t.messages).filter(m=>m.kind==='out').length;
  const activeRulesCount = state.rules.filter(r=>r.enabled).length;

  return head('Billing & Subscriptions','Manage workspace plan tier, payment details, and resource entitlements.',isAdmin?button('Download audit receipt','export',{id:'audit'}):'')+
    `<div class="banner"><span><strong>Active Subscription:</strong> Your workspace is currently on the <strong>${esc(currentPlan)}</strong> plan.</span>${badge(isAdminSession()?'Super Admin Session':'Active Workspace','good')}</div>`+
    `<div class="cards">${plans.map(([name,price,desc])=>`<div class="card pad" style="${currentPlan===name?'border-color:#1e58d4;box-shadow:0 0 0 2px #dce8fd;':''}">
      <div class="row" style="justify-content:space-between">
        <h2>${name}</h2>
        ${currentPlan===name?badge('Current Plan','good'):''}
      </div>
      <strong style="font-size:1.35rem;color:#0b254a;margin:6px 0 2px;">${price}</strong>
      <p style="color:#50627d;font-size:0.89rem;margin-bottom:12px;">${desc}</p>
      <div>${currentPlan===name?button('Current Plan','plan',{id:name,primary:true}):button('Select '+name,'plan',{id:name})}</div>
    </div>`).join('')}</div><div style="height:14px"></div>`+
    card('Workspace Usage & Entitlements',table(['Resource / Metric','Recorded Usage','Plan Entitlement'],[
      ['Properties managed', `${state.properties.length} properties`, 'Unlimited'],
      ['Contacts (Tenants & Owners)', `${state.contacts.length} contacts`, 'Unlimited'],
      ['Active conversation threads', `${state.threads.length} conversations`, 'Unlimited'],
      [isAdmin?'Live outbound messages':'Simulated outbound replies', `${outCount} messages`, 'Included in tier'],
      ['Automations & workflow rules', `${activeRulesCount} active rules`, 'Unlimited'],
      ['Team members & seats', `${state.team.length} active seats`, '10 included seats']
    ]))+
    '<div style="height:14px"></div>'+
    card('Payment Method & Invoicing',`<div class="pad detail-list">
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <span class="avatar" style="background:#eaf2fe;color:#184cc1;">💳</span>
          <div>
            <strong>Visa ending in 4242</strong>
            <small style="color:#556682;">Expires 12/28 · Default billing card</small>
          </div>
        </div>
        ${badge('Active · Auto-renew','good')}
      </div>
      <p style="color:#4a5c78;font-size:0.9rem;margin-top:6px;">Next billing renewal scheduled on the 1st of next month. All plan upgrades and changes are recorded in your workspace audit trail.</p>
    </div>`);
}
function admin() {
  const isAdminActive = isAdminSession() || isWorkerAdmin;
  return head(isAdminActive?'Super Admin Control & Audit':'Super Admin preview',isAdminActive?'Review organization overview, security access logs, and demo inquiries.':'View the demo organization, activity history, and captured demo requests.',button('Export audit CSV','export',{id:'audit'}))+
    card('Organization Overview',table(['Company','Admin Account','Team Members','Current Plan'],[[esc(state.settings.company),esc(currentActorEmail()),state.team.length,esc(state.billing.plan||'Professional')]]))+
    '<div style="height:14px"></div>'+card('Security & Activity Audit History',table(['Activity','Actor','Time'],state.audit.map(a=>[esc(a.activity),badge(a.actor,a.actor.includes('admin')?'good':''),dateTime(a.date)])))+
    '<div style="height:14px"></div>'+card('Inbound Demo Requests & Leads',table(['Name','Email','Company'],state.leads.length?state.leads.map(l=>[esc(l.name),esc(l.email),esc(l.company)]):[['No inquiries recorded yet.','—','—']]));
}
function canReply(thread) {
  const recipient=contact(thread?.contact);
  return !!recipient && !recipient.optout && Boolean(thread.channel==='SMS'?recipient.phone:thread.channel==='Email'?recipient.email:'');
}
function processJobs() {
  // Signed-in workspaces have scheduled items sent by the server, even when nobody has the app open.
  if(isWorkerAdmin||!logged()||saveBlocked)return 0;
  const jobs=runDueJobs(state,send);
  if(jobs.length){
    save(`Processed ${jobs.length} scheduled item${jobs.length===1?'':'s'}`);
    if(!dialog.open&&!app.querySelector('.composer textarea:focus'))render();
  }
  return jobs.length;
}
function outbox() {
  const jobs=state.scheduled.filter(job=>{const t=by('threads',job.thread);return t&&threadScope(t);}).sort((a,b)=>b.date.localeCompare(a.date));
  return head('Outbox & Reminders','Review scheduled replies, reopen conversations, and recover failed items.',button(isWorkerAdmin?'Check for updates':'Process due items','runJobs',{primary:true,glyph:'calendar'}))+
    `<div class="banner">${isWorkerAdmin?'Scheduled texts and reminders are handled by the server within a minute of their time, even when nobody has the app open. Scheduled emails can’t be sent until email is connected.':'Reminders run while the signed-in app is open. Items due while closed are processed on return.'}</div>`+
    card('Scheduled activity',table(['Conversation','Item','Due','Status','Actions'],jobs.map(job=>[
      `<a href="#inbox/${job.thread}">${esc(by('threads',job.thread)?.subject)}</a>`,`<strong>${esc(job.kind)}</strong><br><small>${esc(job.value.slice(0,160))}</small>`,dateTime(job.date),
      statusBadge(job.status)+(job.error?`<br><small>${esc(job.error)}</small>`:''),
      job.status==='Scheduled'?button('Cancel item','cancelJob',{id:job.id}):job.status==='Failed'?button('Reschedule','retryJob',{id:job.id}):'—'
    ])));
}
function updateQuick(value) {
  const query = value.trim().toLowerCase();
  const items = nav.flatMap(group=>group[1]).map(([id,label,glyph])=>({label,glyph,url:id,note:'Workspace'}));
  if (query) {
    items.push(...state.threads.filter(threadScope).map(thread=>({label:thread.subject,note:contact(thread.contact)?.name||thread.channel,glyph:'inbox',url:'inbox/'+thread.id})));
    items.push(...state.contacts.filter(item=>inScope(item.property)).map(item=>({label:item.name,note:item.type,glyph:'people',url:'contacts/'+item.id})));
    items.push(...scopedTickets().map(item=>({label:item.title,note:'Maintenance',glyph:'tool',url:'maintenance/'+item.id})));
  }
  const results=items.filter(item=>[item.label,item.note].join(' ').toLowerCase().includes(query)).slice(0,10);
  dialog.querySelector('.quick-results').innerHTML=results.length?results.map(item=>`<a class="item" href="#${item.url}">${icon(item.glyph)}<span class="grow"><strong>${esc(item.label)}</strong><small>${esc(item.note)}</small></span></a>`).join(''):empty('No matching results.');
}
function quickSearch() {
  info('Find in workspace','<label>Search pages, conversations, contacts, or tickets<input data-input="quick" type="search" placeholder="Search workspace…"></label><div class="quick-results"></div>');
  updateQuick('');
  const input=dialog.querySelector('[data-input="quick"]');
  input.focus();
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();dialog.querySelector('.quick-results a')?.click();}
    if(event.key==='ArrowDown'){event.preventDefault();dialog.querySelector('.quick-results a')?.focus();}
  });
}
async function installApp() {
  try {
    if(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone){notify('HushHawk is already open as an installed app.');return;}
    if(installPrompt){
      const prompt=installPrompt;
      installPrompt=undefined;
      await prompt.prompt();
      return;
    }
    info('Install HushHawk','<p><strong>iPhone and iPad</strong><br>Open the site in Safari, then choose Share and Add to Home Screen.</p><p><strong>Android and desktop</strong><br>Open the site in a supported browser and use Install app or Add to Home Screen from the browser menu.</p><p class="muted">If the in-app browser does not offer installation, use your device’s regular browser.</p>');
  }catch(error){notify(error.message);}
}

let maintenanceView='Board';
let calendarMonth=new Date();
calendarMonth.setDate(1);
function resolutionAction(ticket){
  return isAdmin&&!['Resolved','Closed'].includes(ticket.status)?button('Record resolution','resolveIssue',{id:ticket.id}):'';
}
function maintenancePage(detail) {
  if(detail||maintenanceView==='Table'){
    return collectionPage('tickets',detail,button('Board view','maintenanceView'));
  }
  const tickets=scopedTickets();
  const lanes = [
    ['Intake',['New','Triaged']],['Assigned',['Assigned','Scheduled']],['In progress',['In progress']],['Completed',['Resolved','Closed']]
  ];
  return head('Maintenance','Triage requests, assign work, and track progress across your portfolio.',
    button('Table view','maintenanceView')+button('Add ticket','edit',{id:'tickets',primary:true,glyph:'plus'}))+
    `<div class="maintenance-board">${lanes.map(([label,states])=>{
      const items=tickets.filter(ticket=>states.includes(ticket.status));
      return `<section class="board-lane" aria-label="${label}"><div class="row"><h2>${label}</h2>${badge(items.length)}</div>${items.length?items.map(t=>`<article class="card pad ticket-card"><h3>${esc(t.title)}</h3><small>${esc(property(t.property)?.name||'Unverified property')}</small><div class="row">${statusBadge(t.priority)}${statusBadge(t.status)}</div><small>${esc(person(t.assigned)?.name||'Unassigned')}</small><div class="actions">${button('Edit ticket','edit',{id:'tickets/'+t.id})}${resolutionAction(t)}${t.thread?link('Conversation','inbox/'+t.thread):''}</div></article>`).join(''):'<small>No requests</small>'}</section>`;
    }).join('')}</div>`;
}
function calendar() {
  const iso = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const periodLabel=calendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const offset=(calendarMonth.getDay()+6)%7;
  const count=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0).getDate();
  const scoped=state.events.filter(event=>inScope(event.property));
  const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,index)=>{
    const day=index-offset+1;
    if(day<1||day>count)return '<div class="day outside" aria-hidden="true"></div>';
    const date=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),day);
    const isoDay=iso(date);
    const entries=scoped.filter(event=>event.date===isoDay).sort((a,b)=>a.time.localeCompare(b.time));
    const title=date.toLocaleDateString(undefined,{dateStyle:'full'});
    return `<div class="day${isoDay===iso(new Date())?' today':''}"><button type="button" class="day-number" data-action="calendarDay" data-id="${isoDay}" aria-label="Add appointment on ${esc(title)}">${day}</button>${entries.map(event=>`<button class="calendar-event" data-action="edit" data-id="events/${event.id}" title="${esc(event.title)}">${esc(event.time)} ${esc(event.title)}</button>`).join('')}</div>`;
  });
  return head('Calendar','Schedule service visits, follow-ups, and appointments.',button('Add appointment','edit',{id:'events',primary:true,glyph:'plus'}))+
    `<section class="card calendar-card"><div class="cardhead"><h2>${esc(periodLabel)}</h2><div class="actions">${button('Previous','calendarMonth',{id:'-1'})}${button('Today','calendarMonth',{id:'0'})}${button('Next','calendarMonth',{id:'1'})}</div></div><div class="month-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<strong class="calendar-weekday">${day}</strong>`).join('')}${cells.join('')}</div></section><div class="calendar-agenda">${card('Appointment list',records('events'))}</div>`;
}

const pages={
  dashboard,inbox,voice,assistant,automations,analytics,integrations,settings,billing,admin,outbox,
  contacts:id=>collectionPage('contacts',id),properties:id=>collectionPage('properties',id),maintenance:maintenancePage,
  tasks:id=>collectionPage('tasks',id),calendar,support:id=>account?supportPage(account,id,render):dashboard(),invoice:id=>account?invoicePage(account,id,render):dashboard(),templates:id=>collectionPage('templates',id),team:id=>account?(account.user.role==='agent'?head('Team','Only the owner or an admin can manage the team.'):teamPage(account,render)):collectionPage('team',id)
};
function setWalk(index) {
  walkIndex=index;
  app.querySelectorAll('[data-scene]').forEach(scene=>scene.hidden=Number(scene.dataset.scene)!==index);
  app.querySelectorAll('[data-action="walkStep"]').forEach(step=>step.setAttribute('aria-pressed',String(Number(step.dataset.id)===index)));
  const progress=app.querySelector('.walk-progress span');
  if(progress)progress.style.width=((index+1)/3*100)+'%';
  const control=app.querySelector('[data-action="toggleWalk"]');
  if(control)control.textContent=playing?'Pause':'Play';
  clearTimeout(walkTimer);
  if(progress&&playing)walkTimer=setTimeout(()=>{
    if(walkIndex===2){playing=false;setWalk(walkIndex);}
    else setWalk(walkIndex+1);
  },4200);
}
function render() {
  updateAdminFlag();
  clearTimeout(walkTimer);
  const page=route(), detail=location.hash.split('/')[1]||'';
  const sessionId=location.hash.match(/session=(cs_[A-Za-z0-9_]+)/)?.[1];
  if(sessionId&&account){
    history.replaceState(null,'','#billing');
    app.innerHTML='<main class="ac-center"><section class="ac-card status-card"><h1>Confirming your payment…</h1></section></main>';
    confirmPayment(sessionId).then(r=>{sessionStorage.setItem('hushhawk.flash',r.paid?'Payment received. Thank you!':'Payment not finished yet. If you completed it, check again in a minute.');})
      .catch(error=>sessionStorage.setItem('hushhawk.flash',error.message)).finally(()=>location.reload());
    return;
  }
  if(['terms','privacy','sms-terms'].includes(page)){app.innerHTML=legalPage(page,{brand});window.scrollTo(0,0);return;}
  if(page==='invite'){app.innerHTML=invitePage(detail,{brand},render,account);return;}
  if(page==='reset'){app.innerHTML=resetPage(detail,{brand},render);return;}
  if(page==='forgot'){app.innerHTML=forgotPage({brand});return;}
  if(account?.user.mfaRequired&&!account.user.mfaEnabled&&!marketingPages.includes(page)){app.innerHTML=mfaRequiredPage(account,{brand});return;}
  if(page==='signup'){
    if(account){location.replace('#'+homeRoute(account));return;}
    app.innerHTML=signupPage({brand});return;
  }
  if(account&&page==='login'){location.replace('#'+homeRoute(account));return;}
  if(account?.user.role==='super_admin'&&!marketingPages.includes(page)){
    if(page!=='super'){location.replace('#super');return;}
    app.innerHTML=superConsole(account,{brand},render);return;
  }
  if(account&&!marketingPages.includes(page)&&['account','plans','pay'].includes(homeRoute(account))){
    const home=homeRoute(account);
    let target=home==='account'?'account':['plans','pay','invoice'].includes(page)?page:home;
    if(target==='pay'&&!account.openInvoices.length)target='plans';
    app.innerHTML=target==='account'?statusPage(account,{brand}):target==='plans'?planPage(account,{brand}):target==='pay'?payPage(account,{brand},render)
      :`<main class="ac-center wide" id="main"><div class="inv-wrap">${invoicePage(account,detail,render)}</div></main>`;
    return;
  }
  if(account?.access&&['plans','pay','account'].includes(page)){location.replace(account.user.role==='owner'?'#billing':'#dashboard');return;}
  if(account&&state&&!allowed(page)&&!marketingPages.includes(page)){
    const label=nav.flatMap(group=>group[1]).find(([id])=>id===page)?.[1]||'This feature';
    app.innerHTML=shell(page,lockedPage(label,account));return;
  }
  if(isWorkerAdmin && !isAdminSession() && (!state||adminError)){
    app.innerHTML=`<main class="access-form" id="main">${brand().replace('href="#home"','href="/#home"')}<div class="access-content"><h1>${adminError?'Workspace unavailable':'Opening your workspace'}</h1><p role="status">${esc(adminError||'Checking your account and loading records…')}</p>${adminError?`<a class="market-primary" href="${account?'/':'/admin/'}">Reload workspace</a>`:''}</div></main>`;
    return;
  }
  if(page==='login'){
    if(isAdminSession()){location.replace('#dashboard');return;}
    app.innerHTML=login({brand,icon});
    return;
  }
  if(!isAdminSession()&&(!isWorkerAdmin||account)&&marketingPages.includes(page)&&!(account&&!location.hash)){
    app.innerHTML=marketing({brand,icon,button});mountHome(app);return;
  }
  if(!logged()){
    if(page==='demo'){
      sessionStorage.setItem('hushhawk.demo.login','yes');
      history.replaceState(null,'','#dashboard');
    } else {
      location.replace('#home');
      return;
    }
  }
  const workspacePage=page==='demo'?'dashboard':page;
  app.innerHTML=shell(workspacePage,(Object.hasOwn(pages,workspacePage)?pages[workspacePage]:dashboard)(detail));
  if(isWorkerAdmin && !isAdminSession()){
    for(const action of ['simulate','compose',...(account?[]:['schedule','testRule']),...(account&&allowed('assistant')?[]:['suggest']),'plan','import','lead']){
      app.querySelectorAll(`[data-action="${action}"]`).forEach(control=>control.remove());
    }
  }
  const messages=app.querySelector('.messages');
  if(messages) messages.scrollTop=messages.scrollHeight;
}
async function refreshAdmin({quiet=false}={}){
  if(!logged()||loadingSms||saveBlocked)return;
  if(quiet&&(dialog.open||document.hidden||document.activeElement?.matches('input,select,textarea')))return;
  loadingSms=true;
  try {
    await savePending;
    if(saveBlocked)return;
    const base=adminRevision,pending=savePending;
    const response=await fetch(wsApi,{cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Unable to refresh.');
    if(base!==adminRevision||pending!==savePending)return;
    const changed=result.revision!==adminRevision||result.sms?.configured!==adminSms.configured||result.sms?.number!==adminSms.number;
    adminSms=result.sms||{configured:false};
    wsEmailInbox=result.emailInbox||{configured:false,address:''};
    if(result.state&&result.revision!==adminRevision){
      const drafts=state.draft;
      state=upgrade(result.state);
      state.draft={...state.draft,...drafts};
      adminRevision=result.revision;
      revs=result.revs||{};
      markSynced();
    }
    if(!quiet||changed)render();
  }catch(error){if(!quiet)notify(error.message);}
  finally{loadingSms=false;}
}
async function liveSmsReply(thread,body) {
  if(loadingSms)throw new Error('The inbox is refreshing. Try again shortly.');
  const email=thread.channel==='Email';
  if(!body||body.length>(email?20000:1600))throw new Error(email?'Enter a reply of up to 20,000 characters.':'Enter a reply of up to 1,600 characters.');
  await savePending;
  if(saveBlocked)throw new Error('Reload the workspace before sending.');
  if(!(email?wsEmailInbox.configured:adminSms.configured)||!canReply(thread))throw new Error(email?'Email is unavailable for this conversation.':'SMS is unavailable for this conversation.');
  const previous=replyIds.get(thread.id);
  const requestId=previous?.body===body?previous.id:uid();
  replyIds.set(thread.id,{id:requestId,body});
  const response=await fetch(email?'/api/company/email':account?'/api/company/sms':'/api/admin/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:requestId,thread:thread.id,body})});
  const result=await response.json();
  if(['queued','accepted','sending','sent','delivered'].includes(result.status)) {
    replyIds.delete(thread.id);
    delete state.draft[thread.id];
  }
  await refreshAdmin();
  if(!response.ok||!['queued','accepted','sending','sent','delivered'].includes(result.status)){
    throw new Error(result.error||(email?'The email could not be sent.':'SMS delivery failed or could not be confirmed. Check the timeline and delivery review task.'));
  }
  return email?'Email sent.':result.status==='delivered'?'SMS delivered.':'SMS accepted by the provider.';
}
async function loadAdmin(){
  render();
  try{
    const response=await fetch(wsApi,{cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Unable to open the admin workspace.');
    adminEmail=result.email;
    adminSms=result.sms||{configured:false};
    wsEmailInbox=result.emailInbox||{configured:false,address:''};
    adminRevision=result.revision;
    state=result.state?upgrade(result.state):emptyAdmin(adminEmail);
    revs=result.revs||{};
    if(result.state)markSynced();else synced=new Map();
    if(!result.state&&account){state.settings.company=account.company.name;state.team=[];}
    // Keep the assignable team in step with the people who can sign in.
    for(const m of result.members||[]){
      const row=state.team.find(t=>t.id===m.id||t.email===m.email);
      const next={id:m.id,name:m.name,email:m.email,role:{owner:'Company Owner',admin:'Admin',agent:'Team member'}[m.role]||m.role,status:m.status==='active'?'Active':'Inactive'};
      if(row)Object.assign(row,next);else state.team.push(next);
    }
    pushChanges();
    routeChange();
  }catch(error){adminError=error.message;render();}
}
function routeChange() {
  updateAdminFlag();
  menu=false;
  if(!isWorkerAdmin&&route()==='demo'){
    sessionStorage.setItem('hushhawk.demo.login','yes');
    history.replaceState(null,'','#dashboard');
  }
  if(!state){
    if(isAdminSession()) state = getAdminState();
    else if(!isWorkerAdmin){
      try { state = upgrade(JSON.parse(localStorage.getItem(key)) || seed()); }
      catch { state = upgrade(seed()); }
    } else {
      render();
      return;
    }
  }
  if(route()==='inbox') {
    const detail=location.hash.split('/')[1]||'';
    filter={q:'',channel:'',status:detail==='unread'?'Unread':detail==='emergency'?'Emergency':''};
    selected=by('threads',detail)?.id||'';
    mobileThread=!!selected;
  }
  render();
  const section=!isAdminSession()&&!isWorkerAdmin&&['features','solutions','faq'].includes(route())&&document.getElementById(route());
  if(section) section.scrollIntoView();
  else window.scrollTo(0,0);
}
function send(thread,body,approval) {
  const c=contact(thread.contact), destination=thread.channel==='Email'?c?.email:thread.channel==='SMS'?c?.phone:'';
  if(!destination||c.optout) throw new Error('This contact or channel cannot receive replies.');
  if(approval) {
    if(state.settings.mode!=='Human approval') throw new Error('Set AI mode to Human approval to approve this draft.');
    if(classify(thread.messages.filter(m=>m.kind==='in').at(-1)?.body||'',thread.channel)==='Emergency') throw new Error('Handle this emergency directly.');
    if(approval.status!=='Pending') throw new Error('This reply has already been reviewed.');
    const lastIncoming=thread.messages.filter(m=>m.kind==='in').at(-1);
    if(lastIncoming && lastIncoming.time>approval.date) throw new Error('A newer message arrived. Reject this draft and generate an updated reply.');
  }
  thread.messages.push({id:uid(),kind:'out',body,time:now(),...(approval?{approval:approval.id}:{})});
  thread.updated=now();
  thread.status='Pending';
  if(approval) {approval.body=body;approval.status='Approved';}
}
function download(name, rows) {
  const csv=rows.map(row=>row.map(cell=>`"${String(cell??'').replace(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/,value=>"'"+value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=name+'.csv';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportData(kind) {
  const rows=kind==='audit'? [['Time','Actor','Activity'],...state.audit.map(a=>[a.date,a.actor,a.activity])] :
    [['Conversation','Contact','Property','Channel','Direction','Time',...(kind==='inbox'?['Message']:[])],
    ...(kind==='inbox'?matchingThreads():scopedThreads()).flatMap(t=>t.messages.filter(m=>kind==='inbox'||m.kind!=='note').filter(m=>{
      if(kind==='analytics'){const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-period+1);return new Date(m.time)>=start;}
      return true;
    }).map(m=>[t.subject,contact(t.contact)?.name,property(contact(t.contact)?.property)?.name,t.channel,m.kind,m.time,...(kind==='inbox'?[m.body]:[])]))];
  download('hushhawk-'+kind,rows);
}
function simulateModal(channel) {
  formModal('Simulate incoming event','simulate',
    select('Channel','channel',channels,channels.includes(channel)?channel:'SMS')+
    field('Sender email or phone','sender',channel==='Email'?'michael@example.test':'+15125550104')+
    field('Subject','subject',channel==='Email'?'HVAC maintenance update':'Kitchen sink leak')+
    field('Event ID','eventId',uid())+
    area('Message or call notes','body',channel==='Call'?'Missed incoming call.':channel==='Voicemail'?'Please call me back.':'The kitchen sink is leaking.'),'','Process simulated event');
}
function importSnapshot(raw) {
  let data;
  try { data=JSON.parse(raw); } catch { throw new Error('Enter valid JSON for the snapshot.'); }
  if(!data||typeof data!=='object'||Array.isArray(data)||(!Array.isArray(data.properties)&&!Array.isArray(data.contacts))) throw new Error('Provide a properties or contacts array.');
  const newProperties=[], newContacts=[], propertyMap=new Map();
  const props=Array.isArray(data.properties)?data.properties:[];
  const people=Array.isArray(data.contacts)?data.contacts:[];
  if(props.length+people.length>200) throw new Error('Import up to 200 demo records at a time.');
  for(const item of props) {
    if(typeof item?.name!=='string'||!item.name.trim()||typeof item.address!=='string'||!item.address.trim()) throw new Error('Every imported property needs a name and address.');
    const id=uid();
    if(item.id!==undefined) {
      if(propertyMap.has(item.id)) throw new Error('Property IDs in the snapshot must be unique.');
      propertyMap.set(item.id,id);
    }
    newProperties.push({id,name:item.name.trim(),address:item.address.trim(),units:Array.isArray(item.units)?item.units.map(String).join(', '):String(item.units??'')});
  }
  for(const item of people) {
    if(typeof item?.name!=='string'||!item.name.trim()) throw new Error('Every imported contact needs a name.');
    const propertyId=propertyMap.get(item.property)||property(item.property)?.id||'';
    if(item.property&&!propertyId) throw new Error('Each contact property must refer to an imported or existing property ID.');
    newContacts.push({id:uid(),name:item.name.trim(),type:['Tenant','Owner','Vendor','Other'].includes(item.type)?item.type:'Other',property:propertyId,unit:String(item.unit??''),email:String(item.email??''),phone:String(item.phone??''),verified:false,optout:item.optout===true});
  }
  state.properties.push(...newProperties);state.contacts.push(...newContacts);
  return newProperties.length+newContacts.length;
}
document.addEventListener('click',async event=>{
  if(event.target.closest('.skip')){
    event.preventDefault();
    const main=document.querySelector('main');
    main?.setAttribute('tabindex','-1');
    main?.focus();
    return;
  }
  const control=event.target.closest('[data-action]');
  if(!control) return;
  const {action,id}=control.dataset;
  if(action==='replay'||action==='toggleWalk'||action==='walkStep'){
    if(action==='replay'){
      playing=true;setWalk(0);app.querySelector('.walkthrough')?.scrollIntoView({block:'nearest'});
    }else if(action==='walkStep'){playing=false;setWalk(Number(id));}
    else{playing=!playing;setWalk(playing&&walkIndex===2?0:walkIndex);}
    return;
  }
  if(!state)return;
  const thread=by('threads',id);
  try {
    if(action==='menu'){menu=!menu;render();app.querySelector(menu?'.menu-close':'.menu')?.focus();}
    if(action==='close')dialog.close();
    if(action==='quick')quickSearch();
    if(action==='refreshLive')refreshAdmin();
    if(action==='resolveIssue'){
      formModal('Record issue resolution','resolveIssue',area('What fixed the issue?','resolution'),id,'Mark resolved');
    }
    if(action==='maintenanceView'){
      if(location.hash.includes('/')){maintenanceView='Board';location.hash='maintenance';}
      else{maintenanceView=maintenanceView==='Board'?'Table':'Board';render();}
    }
    if(action==='calendarMonth'){
      if(id==='0'){calendarMonth=new Date();calendarMonth.setDate(1);}
      else calendarMonth.setMonth(calendarMonth.getMonth()+Number(id));
      render();
    }
    if(action==='calendarDay')formModal('Add appointment','record',collections.events.fields({date:id}),'events');
    if(action==='install')installApp();
    if(action==='schedule'||action==='reminder'){
      const reminder=action==='reminder';
      formModal(reminder?'Schedule reminder':'Schedule simulated reply','job',
        `<input type="hidden" name="kind" value="${reminder?'Reminder':'Message'}">`+
        field('Local date and time','date','','datetime-local')+
        area(reminder?'Reminder title':'Reply to send', 'value',reminder?thread.subject:state.draft[id]?.body||''),
        id,'Schedule');
    }
    if(action==='cancelJob'){
      const job=by('scheduled',id);
      if(job.status==='Scheduled'){
        job.status='Canceled';
        const target=by('threads',job.thread);
        if(job.kind==='Reminder'&&target?.followUp===job.date)target.followUp='';
        save('Canceled a scheduled item');render();notify('Scheduled item canceled.');
      }
    }
    if(action==='retryJob')formModal('Reschedule item','retryJob',field('New local date and time','date','','datetime-local'),id,'Reschedule');
    if(action==='csvImport'){csvStepOne(id);return;}
    if(action==='runJobs'){if(isWorkerAdmin){notify('Scheduled items are sent automatically by the server within a minute of their time.');await refreshAdmin();return;}const count=processJobs();notify(count?`Processed ${count} due items.`:'No items are due.');}
    if(action==='labels')formModal('Conversation labels','labels',field('Labels, separated by commas','labels',(thread.labels||[]).join(', '),'text',false),id);
    if(action==='pauseThread'){thread.automationPaused=!thread.automationPaused;save('Updated conversation automation status');render();}
    if(action==='pauseRules'){state.settings.automationPaused=!state.settings.automationPaused;save('Updated workspace automation status');render();}
    if(action==='restoreRule'){
      const r=by('rules',id);
      formModal('Restore workflow version','restoreRule',select('Saved rule version','version',r.history.map((entry,i)=>[String(i),`${entry.name} · ${entry.trigger} · ${entry.action}`]),'0',true),id,'Restore version');
    }
    if(action==='logout'){
      if(account){savePending.then(()=>fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).finally(()=>{location.replace('/#login');location.reload();});return;}
      if(isAdminSession()){
        sessionStorage.removeItem(adminSessionKey);
        sessionStorage.removeItem('hushhawk.admin.email');
        sessionStorage.removeItem('hushhawk.admin.name');
        notify('Signed out of administrator workspace.');
        location.hash='login';
        render();
        return;
      }
      if(isWorkerAdmin){savePending.then(()=>location.assign('/signout-with-chatgpt?return_to=%2F%23login'));return;}
      sessionStorage.removeItem('hushhawk.demo.login');location.hash='home';
      render();
      return;
    }
    if(action==='thread'){selected=id;mobileThread=true;render();requestAnimationFrame(()=>app.querySelector('.thread')?.scrollIntoView({block:'nearest'}));}
    if(action==='conversationList'){mobileThread=false;render();}
    if(action==='contactDetails')app.querySelector('#thread-details')?.focus();
    if(action==='simulate')simulateModal(id);
    if(action==='lead')formModal('Request a demo','lead',field('Name','name')+field('Work email','email','','email')+field('Company','company')+'<p class="muted">This preview saves the request in this browser.</p>','','Save demo request');
    if(action==='compose')formModal('New simulated conversation','compose',select('Contact','contact',contactOptions('Choose contact'),'',true)+select('Channel','channel',['SMS','Email'])+field('Subject','subject')+area('Message','body'),'','Simulate send');
    if(action==='edit'){
      const [name,recordId]=id.split('/');
      const config=collections[name];
      formModal((recordId?'Edit ':'Add ')+config.singular.toLowerCase(),'record',config.fields(by(name,recordId)||{}),id);
    }
    if(action==='ticket'){
      const input={title:thread?.subject,contact:thread?.contact,property:contact(thread?.contact)?.property,priority:thread?.priority,description:thread?.messages.filter(m=>m.kind==='in').at(-1)?.body};
      formModal('Create maintenance ticket','record',collections.tickets.fields(input),'tickets//'+(id||''));
    }
    if(action==='task')formModal('Create follow-up task','record',collections.tasks.fields({title:thread?'Follow up: '+thread.subject:'',assigned:thread?.assigned}),'tasks//'+(id||''));
    if(action==='complete'){by('tasks',id).status='Done';save('Completed a task');render();notify('Task completed.');}
    if(action==='unread'){thread.unread=!thread.unread;if(!thread.unread&&filter.status==='Unread')selected='';save('Updated conversation read status');render();}
    if(action==='kbDelete'){if(!confirm('Delete this document from the knowledge base?'))return;aiData.docs=(await api('/api/ai/knowledge-delete',{id})).docs;render();notify('Document deleted.');return;}
    if(action==='aiRefresh'){loadAiData(true);return;}
    if(action==='summary'&&account&&allowed('assistant')){
      control.disabled=true;notify('Summarizing…');
      try{
        await savePending;
        const r=(await api('/api/ai/summary',{threadId:id})).summary;
        info('Conversation summary',`<p>${esc(r.summary)}</p>${r.open_items.length?`<p><strong>Open items</strong></p><ul>${r.open_items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<p><strong>Next step:</strong> ${esc(r.next_step)}</p>`);
        refreshAdmin({quiet:true});
      }finally{control.disabled=false;}
      return;
    }
    if(action==='summary'){
      const incoming=thread.messages.filter(m=>m.kind==='in');
      const outbound=thread.messages.filter(m=>m.kind==='out');
      info('Timeline summary',`<p>${incoming.length} incoming events · ${outbound.length} simulated replies · ${thread.messages.length-incoming.length-outbound.length} internal notes</p><p><strong>Latest inbound</strong><br>${esc(incoming.at(-1)?.body||'No inbound events yet.')}</p><p><strong>Status</strong> ${esc(thread.status)} · ${esc(thread.priority)} priority</p>`);
    }
    if(action==='suggest'&&account){
      const c=contact(thread.contact);
      if(c?.optout) throw new Error('Contact opted out.');
      control.disabled=true;notify('Drafting a reply…');
      try{
        await savePending;
        const result=await api('/api/ai/draft',{threadId:id});
        state.draft[id]={body:result.text};render();notify(result.citations?.length?`AI draft added, based on ${result.citations.map(c=>c.title).join(', ')}. Review it before sending.`:result.canAnswer===false?'AI holding reply added: your knowledge base doesn’t cover this yet. Review it before sending.':'AI draft added to the reply box. Review and edit it before sending.');
        companyData(render,true);
      }finally{control.disabled=false;}
      return;
    }
    if(action==='suggest'){
      const c=contact(thread.contact);
      if(state.settings.mode==='Off') throw new Error('Assisted replies are paused in Settings.');
      if(c?.optout) throw new Error('Contact opted out.');
      if(state.approvals.some(a=>a.thread===id&&a.status==='Pending')) throw new Error('A reply for this conversation is already awaiting review.');
      const reply=suggest(thread,c,state.knowledge,state.settings.tone);
      if(state.settings.mode==='Suggestion only'){state.draft[id]={body:reply};save('Drafted a local suggestion');render();notify('Suggestion added to the composer.');return;}
      formModal('Review simulated AI draft','suggest',area('Suggested reply','body',reply),id,'Queue for approval');
    }
    if(action==='review'){
      const approval=by('approvals',id);
      formModal(account?'Review AI reply':'Approve simulated reply','approve',area('Reply to send','body',approval.body)+(approval.ai?`<p class="muted wide">Confidence ${pct(approval.ai.confidence)}${approval.ai.citations?.length?` · Based on ${approval.ai.citations.map(c=>esc(c.title)).join(', ')}`:''}</p>`:''),id,account?'Approve and send':'Approve and simulate send');
    }
    if(action==='reject'){
      const approval=by('approvals',id);
      if(approval.status==='Pending'){approval.status='Rejected';save('Rejected assisted reply');render();notify('Suggested reply rejected.');}
    }
    if(action==='testRule'){
      const rule=by('rules',id);
      formModal('Test workflow on a conversation','testRule',`<p class="muted">Run ${esc(rule.name)} on a selected demo conversation if the latest inbound event matches the configured trigger.</p>`+select('Conversation','thread',[['','Choose conversation'],...scopedThreads().map(t=>[t.id,t.subject])],'',true),id,'Run test');
    }
    if(action==='units'){
      const p=property(id);
      info('Units at '+p.name,table(['Unit','Contacts'],p.units.split(',').map(u=>u.trim()).filter(Boolean).map(unit=>[esc(unit),esc(state.contacts.filter(c=>c.property===id&&c.unit===unit).map(c=>c.name).join(', ')||'Unassigned')])));
    }
    if(action==='call'){
      const c=by('calls',id);
      formModal('Call details','call',select('Disposition','status',['Missed','Voicemail','Answered','Callback complete'],c.status)+area(c.status==='Voicemail'?'Transcript and notes':'Call notes','notes',c.notes,false),id);
    }
    if(action==='plan'){state.billing.plan=id;save(`Changed workspace subscription to ${id} plan`);render();notify(`Workspace plan switched to ${id}.`);}
    if(action==='export')exportData(id);
    if(action==='notifications'){
      const approvals=scopedApprovals().filter(a=>a.status==='Pending').length;
      const urgent=scopedThreads().filter(t=>t.priority==='Emergency'&&t.status==='Open').length;
      const missed=scopedCalls().filter(c=>c.status==='Missed').length;
      info('Notifications',`<div class="actions">${link(approvals+' pending approvals','assistant')}${link(urgent+' emergency conversations','inbox/emergency')}${link(missed+' missed calls','voice/missed')}</div>`);
    }
    if(action==='import')formModal('Import fictional portfolio snapshot','import',area('JSON snapshot','json',JSON.stringify({properties:[{id:'sample',name:'Demo Building',address:'100 Test Street',units:['101']}],contacts:[{name:'Fictional Tenant',type:'Tenant',property:'sample',unit:'101',email:'tenant@example.test'}]},null,2)),'','Import demo data');
  }catch(error){notify(error.message);}
});
dialog.addEventListener('click',event=>{
  if(event.target.closest('a[href^="#"]'))dialog.close();
});
document.addEventListener('change',event=>{
  const el=event.target.closest('[data-change="csvMap"]');
  if(el&&csvDraft){csvDraft.map[el.name.slice(4)]=el.value;csvStepTwo();}
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.dataset.input==='quick')updateQuick(input.value);
  if(input.dataset.input==='draft'){state.draft[input.dataset.id]={body:input.value};save();}
  if(input.dataset.input==='search'){
    const start=input.selectionStart,end=input.selectionEnd;
    filter.q=input.value;render();
    const replacement=app.querySelector('[data-input="search"]');
    replacement.focus();replacement.setSelectionRange(start,end);
  }
});
document.addEventListener('change',event=>{
  const input=event.target;
  const {change,id}=input.dataset;
  const value=input.value;
  if(!change){
    if(input.name==='channel'&&input.form?.dataset.form==='simulate') {
      input.form.elements.sender.value=value==='Email'?'michael@example.test':'+15125550104';
    }
    return;
  }
  const thread=by('threads',id);
  if(change==='scope'){scope=value;selected='';mobileThread=false;}
  if(change==='period')period=Number(value);
  if(change==='channel'||change==='status'){filter[change]=value;selected='';mobileThread=false;}
  if(change==='threadStatus'){thread.status=value;save('Updated conversation status');}
  if(change==='priority'){thread.priority=value;save('Updated conversation priority');}
  if(change==='assign'){thread.assigned=value;save('Updated conversation assignment');notify('Assignment saved.');}
  if(change==='insert'&&value){state.draft[id]={body:by('templates',value).body};save();}
  render();
  const replacement=[...app.querySelectorAll('[data-change]')].find(element=>element.dataset.change===change&&element.dataset.id===id);
  replacement?.focus();
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!form.dataset.form)return;
  event.preventDefault();
  const {form:kind,id}=form.dataset;
  const data=Object.fromEntries([...new FormData(form)].map(([name,value])=>[name,typeof value==='string'?value.trim():value]));
  try {
    for(const element of form.querySelectorAll('[required][name]')) {
      if(!data[element.name])throw new Error('Complete each required field.');
    }
    let message='Saved.';
    if(kind==='csvUpload'){
      const file=form.querySelector('[name=file]').files[0];
      const text=file?await file.text():data.text;
      if(!text)throw new Error('Choose a CSV file or paste CSV text.');
      if(text.length>5e6)throw new Error('That file is too large. Split it into files under 5 MB.');
      const parsed=parseCsv(text);
      if(parsed.length<2)throw new Error('The file needs a heading row and at least one record.');
      if(parsed.length>5001)throw new Error('Import up to 5,000 rows at a time.');
      csvDraft={type:id,headers:parsed[0],rows:parsed.slice(1)};
      csvStepTwo();return;
    }
    if(kind==='csvMap'){
      const {add}=csvPlan(),type=csvDraft.type;
      if(!add.length)throw new Error('Nothing to import.');
      state[type].push(...add);
      save(`Imported ${add.length} ${type} from CSV`);
      csvDraft=null;dialog.close();render();notify(`Imported ${add.length} ${type}.`);return;
    }
    if(kind==='record'){
      const [name,recordId,threadId]=id.split('/');
      const existing=by(name,recordId);
      const cap=account?.entitlements&&{properties:account.entitlements.properties,team:account.entitlements.seats}[name];
      if(cap&&!existing&&state[name].length>=cap)throw new Error(`Your ${account.plan.name} plan includes ${cap} ${name==='team'?'team seats':'properties'}. Upgrade in Billing to add more.`);
      for(const keyName of ['verified','optout','enabled'])if(keyName in data)data[keyName]=data[keyName]==='true';
      if(name==='contacts'&&data.property&&data.unit&&!property(data.property)?.units.split(',').map(u=>u.trim()).includes(data.unit))throw new Error('Choose a unit that exists at the selected property.');
      if(name==='properties'&&existing){
        const units=data.units.split(',').map(unit=>unit.trim());
        if(state.contacts.some(c=>c.property===existing.id&&c.unit&&!units.includes(c.unit)))throw new Error('Reassign contacts before removing their units.');
      }
      if(name==='tickets'&&data.contact){
        const c=contact(data.contact);
        if(data.property&&c.property&&data.property!==c.property)throw new Error('The contact belongs to a different property.');
        if(!data.property)data.property=c.property;
      }
      if(name==='rules'){
        data.order=Number(data.order);
        if(!Number.isInteger(data.order)||data.order<1||data.order>999)throw new Error('Enter an execution order from 1 to 999.');
        if(existing){
          const {history,...snapshot}=existing;
          history.unshift(snapshot);
          history.splice(10);
        }else data.history=[];
      }
      if(isAdmin&&name==='tickets'&&['Resolved','Closed'].includes(data.status)&&!existing?.resolution){
        throw new Error('Use Record resolution to document what fixed the issue before closing it.');
      }
      if(existing)Object.assign(existing,data);
      else state[name].push({id:uid(),...data,...(threadId?{thread:threadId}:{}),...(name==='tickets'?{date:now()}: {})});
      save(`${existing?'Edited':'Created'} ${collections[name].singular.toLowerCase()}`);
      message=name==='team'&&!existing?'Demo membership recorded.':'Saved.';
    }
    if(kind==='reply'){
      const thread=by('threads',id);
      if(event.submitter?.value==='note'){thread.messages.push({id:uid(),kind:'note',body:data.body,time:now()});message='Internal note added.';}
      else if(isWorkerAdmin && !isAdminSession()){
        const trigger=event.submitter;
        if(trigger)trigger.disabled=true;
        try{notify(await liveSmsReply(thread,data.body));}
        catch(error){notify(error.message);}
        finally{if(trigger)trigger.disabled=false;}
        return;
      }else {send(thread,data.body);message=isAdminSession()?'Admin reply recorded.':'Simulated reply saved.';}
      delete state.draft[id];save(message);
    }
    if(kind==='liveSmsSettings'){
      if(data.active==='true'&&state.settings.liveSmsReplies===false&&!adminSms.configured&&isWorkerAdmin)throw new Error('Texting isn’t set up yet, so text acknowledgments can’t be switched on.');
      if(data.emailActive==='true'&&!state.settings.liveEmailReplies&&!wsEmailInbox.configured)throw new Error('Email isn’t set up yet, so email acknowledgments can’t be switched on.');
      state.settings.liveSmsReplies=data.active==='true';
      if(account&&data.emailActive)state.settings.liveEmailReplies=data.emailActive==='true';
      save('Updated live SMS acknowledgments');
    }
    if(kind==='resolveIssue'){
      const ticket=by('tickets',id);
      ticket.status='Resolved';
      ticket.resolution=data.resolution;
      ticket.resolvedOn=now();
      ticket.resolvedBy=currentActorEmail();
      save('Recorded a maintenance resolution');
      message='Issue marked resolved. Open the linked conversation to notify the tenant.';
    }
    if(kind==='compose'){
      const c=contact(data.contact);
      const thread={id:uid(),contact:c.id,channel:data.channel,subject:data.subject,priority:'Normal',status:'Open',assigned:'u1',unread:false,updated:now(),messages:[]};
      send(thread,data.body);
      state.threads.push(thread);save('Created simulated conversation');
      if(!threadScope(thread))scope='';
      location.hash='inbox/'+thread.id;
      message='Simulated conversation created.';
    }
    if(kind==='simulate'){
      if(data.channel==='Email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.sender))throw new Error('Enter a valid sender email.');
      if(data.channel!=='Email'&&data.sender.replace(/\D/g,'').length<7)throw new Error('Enter a sender phone number.');
      const result=inbound(state,data);
      if(result.duplicate)message='Duplicate event ignored.';
      else{
        save('Processed simulated '+data.channel+' event');
        message=result.optOut?'Opt-out saved.':result.category==='Emergency'?'Emergency flagged for staff review.':'Simulated event added to inbox.';
        if(!threadScope(result.thread))scope='';
        location.hash='inbox/'+result.thread.id;
      }
    }
    if(kind==='suggest'){state.approvals.unshift({id:uid(),thread:id,body:data.body,status:'Pending',date:now()});save('Queued assisted reply for approval');location.hash='assistant';message='Reply queued for approval.';}
    if(kind==='approve'&&account){
      const approval=by('approvals',id),thread=by('threads',approval?.thread);
      if(!approval||!thread)throw new Error('This reply is no longer available.');
      const result=await liveSmsReply(thread,data.body);
      const fresh=by('approvals',id);
      if(fresh){fresh.status='Approved';fresh.approvedBy=currentActorEmail();fresh.approvedAt=now();save('Approved and sent an AI reply');}
      if(dialog.open)dialog.close();render();notify(result);return;
    }
    if(kind==='approve'){const approval=by('approvals',id);send(by('threads',approval.thread),data.body,approval);save('Approved and simulated assisted reply');message='Approved reply saved to the timeline.';}
    if(kind==='kbUpload'){
      const file=form.querySelector('[name=file]').files[0];
      const body={title:data.title,replaceId:data.replaceId||undefined};
      if(file){
        if(file.size>10*1024*1024)throw new Error('Files can be up to 10 MB.');
        const type=file.type||({pdf:'application/pdf',md:'text/markdown',csv:'text/csv',html:'text/html',htm:'text/html'}[file.name.split('.').pop().toLowerCase()]||'text/plain');
        Object.assign(body,{fileName:file.name,type});
        if(type==='application/pdf')body.content=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
        else body.text=await file.text();
      }else if(data.text){Object.assign(body,{fileName:'',type:'text/plain',text:data.text});}
      else throw new Error('Choose a file or paste text.');
      notify(file?.type==='application/pdf'?'Reading the PDF… this can take a minute.':'Indexing…');
      const r=await api('/api/ai/knowledge',body);aiData.docs=r.docs;render();notify('Document added to your knowledge base.');return;
    }
    if(kind==='kbSearch'){aiData.search=(await api('/api/ai/search',{query:data.query})).results;render();return;}
    if(kind==='aiTest'){notify('Testing…');aiData.test=await api('/api/ai/test',{message:data.message,channel:data.channel,verified:data.verified==='true'});render();loadAiData(true);return;}
    if(kind==='aiSettings'){
      Object.assign(state.settings,{mode:data.mode,aiClassify:data.aiClassify==='true',aiThreshold:Math.min(0.99,Math.max(0.5,Number(data.aiThreshold)||0.85)),aiLanguage:data.aiLanguage,
        aiMaxLength:Math.min(2000,Math.max(160,Number(data.aiMaxLength)||600)),aiAutoCategories:[...new FormData(form).getAll('aiAutoCategories')],aiBlockedTopics:data.aiBlockedTopics,aiEmergencyText:data.aiEmergencyText});
      save('Updated assistant settings');message='Assistant settings saved.';
    }
    if(kind==='testRule'){
      const thread=by('threads',data.thread),rule=by('rules',id);
      const last=thread.messages.filter(m=>m.kind==='in').at(-1);
      if(!last||classify(last.body,thread.channel)!==rule.trigger)throw new Error('Choose a conversation with a matching inbound event.');
      runRules(state,thread,rule.trigger,rule);save('Ran a demo workflow test');message=state.runs[0].result;
    }
    if(kind==='job'){
      const target=by('threads',id);
      if(data.kind==='Message'&&!canReply(target))throw new Error('This contact or channel cannot receive replies.');
      if(data.kind==='Reminder'&&state.scheduled.some(job=>job.thread===id&&job.kind==='Reminder'&&job.status==='Scheduled'))throw new Error('Cancel the current reminder in Outbox before replacing it.');
      createJob(state,target,data.kind,data.value,data.date);
      save('Scheduled a simulated '+data.kind.toLowerCase());
      message='Scheduled. View it in Outbox & Reminders.';
    }
    if(kind==='labels'){
      by('threads',id).labels=[...new Set(data.labels.split(',').map(label=>label.trim().slice(0,32)).filter(Boolean))].slice(0,12);
      save('Updated conversation labels');
    }
    if(kind==='retryJob'){
      const job=by('scheduled',id);
      createJob(state,by('threads',job.thread),job.kind,job.value,data.date);
      job.status='Rescheduled';
      save('Rescheduled a failed item');
    }
    if(kind==='restoreRule'){
      const rule=by('rules',id),index=Number(data.version);
      const snapshot=rule.history[index];
      if(!snapshot)throw new Error('Select an available version.');
      const {history,...current}=rule;
      history.splice(index,1);
      history.unshift(current);
      Object.assign(rule,snapshot);
      save('Restored a workflow rule version');
    }
    if(kind==='call'){Object.assign(by('calls',id),data);save('Updated call details');}
    if(kind==='lead'){state.leads.push({id:uid(),...data,date:now()});save('Recorded a local demo request');message='Demo request saved in this browser.';}
    if(kind==='import'){const count=importSnapshot(data.json);save('Imported fictional portfolio snapshot');message=`Imported ${count} demo records.`;}
    if(kind==='settings'){
      try{new Intl.DateTimeFormat('en',{timeZone:data.timezone});}catch{throw new Error('Enter a valid IANA timezone, such as America/Chicago.');}
      state.settings={...state.settings,...data};save('Updated company settings');
    }
    if(dialog.open)dialog.close();
    render();notify(message);
  }catch(error){notify(error.message);}
});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&logged()&&!dialog.open){event.preventDefault();quickSearch();}
  if(event.key==='Escape'&&menu&&!dialog.open){menu=false;render();app.querySelector('.menu')?.focus();}
});
window.addEventListener('hashchange',routeChange);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
for(const change of ['online','offline'])window.addEventListener(change,()=>{if(!dialog.open)render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)processJobs();});
setInterval(processJobs,15000);
if(!isAdminSession()&&!isWorkerAdmin&&'serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
mountAccounts({app,notify,rerender:()=>render()});
async function boot(){
  if(!isWorkerAdmin){
    app.innerHTML='';
    account=await fetchMe();
    if(account?.company&&account.access){
      isWorkerAdmin=true;wsApi='/api/workspace';state=undefined;
      if(['','#demo','#login'].includes(location.hash))history.replaceState(null,'','#dashboard');
    }
  }
  const flash=sessionStorage.getItem('hushhawk.flash');
  if(flash){sessionStorage.removeItem('hushhawk.flash');setTimeout(()=>notify(flash),400);}
  if(isWorkerAdmin){loadAdmin();setInterval(()=>refreshAdmin({quiet:true}),12000);return;}
  routeChange();
  processJobs();
}
boot();
