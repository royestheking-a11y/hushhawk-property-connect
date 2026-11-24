const svg=(d,cls='ico')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ex={
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  playFill:'<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  replay:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  shield:'<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  spark:'<path d="M12 3c.4 3.9 2.1 5.6 6 6-3.9.4-5.6 2.1-6 6-.4-3.9-2.1-5.6-6-6 3.9-.4 5.6-2.1 6-6z"/><path d="M19 15c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z"/>',
  devices:'<rect x="3" y="4" width="13" height="10" rx="1.5"/><path d="M7 18h5"/><rect x="17" y="8" width="4.5" height="10" rx="1"/>',
  x:'<path d="M7 7l10 10M17 7 7 17"/>',
  stop:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cursor:'<path d="M5 3l14 7-6 2-2 6z" fill="currentColor" stroke="#fff" stroke-width="1.2"/>'
};

const chapters=[
  {t:'A tenant calls after hours',c:'Sarah calls at 9:41 PM about a leak. Nobody is at the desk, and HushHawk catches the call.'},
  {t:'The voicemail becomes text',c:'The message is transcribed and matched to the tenant, the unit and the issue.'},
  {t:'A reply is drafted for you',c:'A suggested reply is written from your own policies and templates.'},
  {t:'Your team approves it',c:'Nothing goes out until a person approves it. One click, and Sarah has an answer.'},
  {t:'Maintenance gets a ticket',c:'A ticket opens with the voicemail and texts attached, routed to the right team.'},
  {t:'Every step is on record',c:'The thread is resolved, the dashboard updates, and the audit log shows who did what.'}
];
const sceneSide=[0,1,2,2,3,4];
const words=(text,start=0,step=.06)=>text.split(' ').map((w,i)=>`<span class="w" style="--d:${(start+i*step).toFixed(2)}s">${w}</span>`).join(' ');

function scenes(icon){
  const bars=Array.from({length:34},(_,i)=>`<i style="--h:${[30,55,80,45,95,60,35,70,90,50,25,65,85,40,75,55,30,60,95,70,45,80,35,55,90,60,40,75,50,30,65,45,25,40][i]}%;--d:${(i*.035).toFixed(2)}s"></i>`).join('');
  return `
  <div class="sc sc-0" data-scene="0"><div class="call">
    <div class="call-ring"><span></span><span></span><b>SJ</b></div>
    <strong>Sarah Johnson</strong><small>Riverside Apartments · Unit 204</small>
    <div class="call-state"><span class="ringing">${icon('phone')} Incoming call…</span><span class="missed">${icon('phone')} Missed call · 9:41 PM</span></div>
  </div><div class="pop pop-r">${icon('inbox')} Captured in the shared inbox</div></div>

  <div class="sc sc-1" data-scene="1"><div class="vm">
    <div class="vm-head"><span class="vm-play">${svg(ex.playFill)}</span><div><strong>Voicemail · Sarah Johnson</strong><small>0:18 · Transcribed</small></div></div>
    <div class="wave">${bars}</div>
    <p class="vm-text">“${words('Hi, this is Sarah in unit 204. There’s water leaking under my kitchen sink and it’s getting worse. Can someone come take a look?',.9,.07)}”</p>
    <div class="tags"><span>${icon('people')} Matched: Sarah Johnson</span><span>${icon('building')} Unit 204</span><span class="hot">${icon('tool')} Maintenance · Plumbing</span></div>
  </div></div>

  <div class="sc sc-2" data-scene="2"><div class="thread">
    <div class="bub in"><small>Voicemail · 9:41 PM</small>Water leaking under my kitchen sink, getting worse.</div>
    <div class="draft"><div class="draft-h">${svg(ex.spark)} Suggested reply</div>
      <p>${words('Hi Sarah, thanks for letting us know. We’ve logged the leak and maintenance will reach out first thing tomorrow. If water is spreading, please turn off the valve under the sink.',.5,.05)}</p>
      <div class="draft-f"><span class="src">${icon('file')} Based on: After-hours leak policy</span><span class="btns"><span class="b">Edit</span><span class="b pri">Approve &amp; send</span></span></div>
    </div>
  </div></div>

  <div class="sc sc-3" data-scene="3"><div class="thread">
    <div class="bub in"><small>Voicemail · 9:41 PM</small>Water leaking under my kitchen sink, getting worse.</div>
    <div class="approve"><div><strong>Reply ready for approval</strong><small>Queued by HushHawk · reviewed by Alex M.</small></div><span class="b pri">${icon('check')} Approve</span><span class="cursor">${svg(ex.cursor)}</span></div>
    <div class="bub out">Hi Sarah, thanks for letting us know. We’ve logged the leak and maintenance will reach out first thing tomorrow.<small class="dl">${icon('check')} Delivered · 9:43 PM</small></div>
  </div></div>

  <div class="sc sc-4" data-scene="4"><div class="ticket">
    <div class="tk-h"><span class="tk-ico">${icon('tool')}</span><div><small>Ticket #1042 · created automatically</small><strong>Kitchen sink leak</strong></div><span class="pill hi">High priority</span></div>
    <div class="tk-rows">
      <div><small>Property</small><span>Riverside · Unit 204</span></div>
      <div><small>Assigned to</small><span><b class="av">RM</b> Riverside maintenance</span></div>
      <div><small>Attached</small><span class="att"><em>${icon('phone')} Voicemail</em><em>${icon('inbox')} SMS thread</em></span></div>
    </div>
    <div class="tk-task">${icon('calendar')}<span><strong>Call Sarah back</strong> · Tomorrow, 9:00 AM</span><span class="pill">Task</span></div>
  </div></div>

  <div class="sc sc-5" data-scene="5"><div class="record">
    <div class="stats"><div><small>Open threads</small><strong>3</strong><em>↓ 1</em></div><div><small>Avg. first reply</small><strong>2 min</strong><em>after hours</em></div><div><small>Tickets today</small><strong>4</strong><em>↑ 1</em></div></div>
    <div class="audit"><div class="audit-h">${icon('file')} Audit log <span class="pill ok">${icon('check')} Thread resolved</span></div>
      <div class="row"><time>9:41</time>Missed call captured from Sarah Johnson</div>
      <div class="row"><time>9:41</time>Voicemail transcribed and matched to Unit 204</div>
      <div class="row"><time>9:42</time>Reply drafted from After-hours leak policy</div>
      <div class="row"><time>9:43</time>Alex M. approved and sent the reply</div>
      <div class="row"><time>9:43</time>Ticket #1042 assigned to Riverside maintenance</div>
    </div>
  </div></div>`;
}

export function marketing({brand,icon}){
  const nav=[['product','Product tour'],['features','Features'],['how','How it works'],['pricing','Pricing'],['faq','FAQ']];
  const sideIcons=['inbox','phone','ai','tool','chart'];
  return `<div class="hh">
  <header class="hh-nav"><div class="hh-wrap hh-nav-in">${brand()}
    <nav aria-label="Sections">${nav.map(([id,label])=>`<a href="#${id}" data-scroll="${id}">${label}</a>`).join('')}</nav>
    <div class="hh-nav-cta"><a class="hh-glass" href="#login">Sign in</a><a class="hh-btn sm" href="#contact" data-scroll="contact">Request a demo</a></div>
  </div></header>

  <main id="main">
  <section class="hh-hero">
    <div class="hh-wrap hh-hero-in">
      <a class="hh-eyebrow" href="#product" data-scroll="product"><span class="dot"></span>Calls, texts, email &amp; repairs in one place ${svg(ex.arrow)}</a>
      <h1>Every tenant message.<br><span>A clear next step.</span></h1>
      <p class="hh-lede">HushHawk catches every call, text and email, drafts the reply, and turns repair requests into tickets, so your team always knows what happened and what to do next.</p>
      <div class="hh-ctas"><a class="hh-btn lg" href="#demo">Try the interactive demo ${svg(ex.arrow)}</a><button class="hh-btn ghost lg" type="button" data-watch>${svg(ex.playFill)} Watch the 30-second tour</button></div>
      <ul class="hh-trust"><li>${icon('check')} No sign-up for the demo</li><li>${icon('check')} Works alongside RentRedi</li><li>${icon('check')} Every reply approved by a person</li></ul>
    </div>
  </section>

  <section class="hh-wrap hh-film-sec" id="product" aria-label="Product tour">
    <div class="film is-poster is-paused">
      <div class="film-frame">
        <div class="win">
          <div class="win-top"><span class="dots"><i></i><i></i><i></i></span><span class="win-title">HushHawk · Shared inbox</span><span class="win-live"><i></i>Live</span></div>
          <div class="win-body">
            <aside class="win-side">${sideIcons.map((n,i)=>`<span data-side="${i}">${icon(n)}</span>`).join('')}</aside>
            <div class="win-main">${scenes(icon)}</div>
          </div>
        </div>
        <div class="film-poster">
          <button type="button" class="film-play" data-film="play" aria-label="Play the product tour">${svg(ex.playFill)}</button>
          <strong>See HushHawk handle a late-night leak</strong><small>6 steps · about 30 seconds</small>
        </div>
        <div class="film-end">
          <strong>From missed call to fixed sink, without a single note lost.</strong>
          <div class="hh-ctas"><a class="hh-btn" href="#demo">Try it yourself ${svg(ex.arrow)}</a><button type="button" class="hh-btn ghost dark" data-film="replay">${svg(ex.replay)} Replay</button></div>
        </div>
      </div>
      <div class="film-bar">
        <button type="button" class="film-toggle" data-film="toggle" aria-label="Play">${svg(ex.playFill,'ico i-play')}${svg(ex.pause,'ico i-pause')}</button>
        <div class="film-cap" aria-live="polite"><b>01</b><div><strong>${chapters[0].t}</strong><span>${chapters[0].c}</span></div></div>
      </div>
      <ol class="chaps">${chapters.map((c,i)=>`<li><button type="button" class="chap" data-film="chap" data-i="${i}"><span class="chap-bar"><i></i></span><b>0${i+1}</b><span>${c.t}</span></button></li>`).join('')}</ol>
      <p class="film-note">Product preview with fictional data. Live calling and messaging need a provider connected.</p>
    </div>
  </section>

  <section class="hh-sec" id="problem"><div class="hh-wrap">
    <div class="hh-head reveal"><p class="hh-kicker">The problem</p><h2>Tenant communication is scattered. Things slip.</h2><p>Calls land in one voicemail, texts on one phone, repairs in a spreadsheet. HushHawk puts it all in one place, with an owner and a next step.</p></div>
    <div class="vs reveal">
      <div class="vs-col before"><h3>Without HushHawk</h3><ul>
        <li>${svg(ex.x)}Missed calls wait in someone’s personal voicemail</li>
        <li>${svg(ex.x)}Texts live on one manager’s phone</li>
        <li>${svg(ex.x)}Repair requests get lost between a text and a spreadsheet</li>
        <li>${svg(ex.x)}Replies depend on who happens to be on shift</li>
        <li>${svg(ex.x)}No record of who promised what, or when</li></ul></div>
      <div class="vs-col after"><h3>${icon('brand')} With HushHawk</h3><ul>
        <li>${icon('check')}Every missed call becomes a transcribed message and a callback task</li>
        <li>${icon('check')}Calls, texts and email share one inbox the whole team can see</li>
        <li>${icon('check')}Maintenance reports open tickets with the original message attached</li>
        <li>${icon('check')}Replies are drafted from your policies and wait for approval</li>
        <li>${icon('check')}Every action lands in an audit log</li></ul></div>
    </div>
  </div></section>

  <section class="hh-sec tint" id="features"><div class="hh-wrap">
    <div class="hh-head reveal"><p class="hh-kicker">Features</p><h2>Everything your office handles, in one place.</h2><p>Built around the daily work of a property team: answering tenants, routing repairs and keeping a record.</p></div>
    <div class="bento">
      <article class="bx wide reveal"><div class="bx-copy">${icon('inbox')}<h3>One inbox for every channel</h3><p>SMS, email, calls and voicemail in a single timeline per tenant, with assignment, status, priority, labels and internal notes.</p></div>
        <div class="bx-vis inbox-vis">
          <div class="ir"><b class="av">SJ</b><div><strong>Sarah Johnson</strong><small>Kitchen sink leak, getting worse</small></div><span class="ch sms">SMS</span></div>
          <div class="ir"><b class="av b2">MC</b><div><strong>Michael Chen</strong><small>HVAC not cooling in 3B</small></div><span class="ch em">Email</span></div>
          <div class="ir"><b class="av b3">ER</b><div><strong>Elena Rodriguez</strong><small>Voicemail · parking permit</small></div><span class="ch vm">Voicemail</span></div>
        </div></article>
      <article class="bx reveal"><div class="bx-copy">${icon('phone')}<h3>Voice center</h3><p>Call log, voicemail transcripts and automatic callback tasks, so no missed call goes unanswered.</p></div>
        <div class="bx-vis wave-vis">${Array.from({length:24},(_,i)=>`<i style="--h:${[40,70,50,90,60,35,80,55,95,45,65,30,75,50,85,40,60,90,35,70,55,80,45,60][i]}%;--d:${(i*.07).toFixed(2)}s"></i>`).join('')}</div></article>
      <article class="bx reveal"><div class="bx-copy">${svg(ex.spark)}<h3>Drafted replies, human approval</h3><p>Suggestions come from your own knowledge base and templates. A person reviews every one before it is sent.</p></div>
        <div class="bx-vis ai-vis"><p>“Thanks Sarah, maintenance will reach out first thing tomorrow…”</p><span class="b pri">${icon('check')} Approve</span></div></article>
      <article class="bx wide reveal"><div class="bx-copy">${icon('flow')}<h3>Automation rules you control</h3><p>Trigger on channel, keywords, property or priority. Set the order, test against a real conversation, roll back to any of the last ten versions, or pause everything with one switch.</p></div>
        <div class="bx-vis rule-vis"><span class="rp when">When an SMS mentions <b>leak</b></span>${svg(ex.arrow)}<span class="rp">Create ticket</span>${svg(ex.arrow)}<span class="rp">Priority: High</span>${svg(ex.arrow)}<span class="rp">Assign maintenance</span></div></article>
    </div>
    <div class="mini-grid">
      ${[['tool','Maintenance & tasks','Tickets, callbacks and appointments tied to the property and unit.'],['file','Templates & knowledge','Approved answers and policies your replies are built from.'],['chart','Reports & analytics','Activity, response and workload reports with CSV export.'],['people','Team & roles','Assign conversations, set roles and see who owns what.']].map(([g,t,c])=>`<article class="mini reveal">${icon(g)}<h3>${t}</h3><p>${c}</p></article>`).join('')}
    </div>
  </div></section>

  <section class="hh-sec" id="how"><div class="hh-wrap">
    <div class="hh-head reveal"><p class="hh-kicker">How it works</p><h2>Up and running in three steps.</h2></div>
    <ol class="steps">
      <li class="reveal"><span class="sn">1</span><h3>Connect your channels</h3><p>Bring in your business numbers and mailbox. Add properties, units and contacts, or import a portfolio snapshot.</p></li>
      <li class="reveal"><span class="sn">2</span><h3>Set your rules and knowledge</h3><p>Write the policies and templates replies are drafted from. Decide what creates a ticket, a task or an urgent alert.</p></li>
      <li class="reveal"><span class="sn">3</span><h3>Work one queue</h3><p>Your team answers, approves and resolves from one place, on desktop or phone. Every action is recorded.</p></li>
    </ol>
  </div></section>

  <section class="hh-sec dark" id="why"><div class="hh-wrap">
    <div class="hh-head reveal"><p class="hh-kicker">Why HushHawk</p><h2>Built for how property teams actually work.</h2><p>Fast enough for the after-hours rush, careful enough for tenant records.</p></div>
    <div class="why">
      ${[
        [svg(ex.shield),'People stay in control','Drafts never send themselves. Every outgoing reply is reviewed and approved by your team.'],
        [svg(ex.stop),'Consent built in','When a tenant replies STOP, messaging to that number stops automatically.'],
        [svg(ex.layers),'Nothing falls through','Duplicate events are ignored, missed calls become callbacks, and every thread has an owner.'],
        [svg(ex.link),'Works with your PMS','Keep RentRedi for leases and rent. HushHawk handles the conversations around them.'],
        [icon('file'),'Accountable by default','A full audit history shows who replied, approved, assigned or changed what, and when.'],
        [svg(ex.devices),'Anywhere your team is','Install it as an app on desktop or phone, with a mobile inbox and quick search.']
      ].map(([g,t,c])=>`<article class="reveal"><span class="why-ico">${g}</span><h3>${t}</h3><p>${c}</p></article>`).join('')}
    </div>
  </div></section>

  <section class="hh-sec" id="faq"><div class="hh-wrap faq">
    <div class="hh-head left reveal"><p class="hh-kicker">FAQ</p><h2>Questions, answered.</h2><p>Anything else? Open the demo and try it with fictional data.</p></div>
    <div class="faq-list reveal">
      <details open><summary>Can I use HushHawk alongside RentRedi?</summary><p>Yes. HushHawk is designed to work next to your property management system and handle communication and follow-up.</p></details>
      <details><summary>Will the demo contact a real tenant?</summary><p>No. The demo uses fictional records and simulates calls, SMS and email inside your browser.</p></details>
      <details><summary>Does AI send messages on its own?</summary><p>No. Suggested replies go to an approval queue, and a person approves each one before it is sent.</p></details>
      <details><summary>What happens when a tenant texts STOP?</summary><p>The contact is marked as opted out and further messages to that number are blocked.</p></details>
      <details><summary>Where do I manage my properties?</summary><p>Use Admin sign in to reach your protected workspace.</p></details>
    </div>
  </div></section>

  <section class="hh-sec tint" id="pricing"><div class="hh-wrap">
    <div class="hh-head reveal"><p class="hh-kicker">Pricing</p><h2>Plans that grow with your portfolio.</h2><p>Every plan starts with a free trial. Change or cancel any time.</p></div>
    <div class="price-grid" data-pricing><p class="price-loading">Loading plans…</p></div>
  </div></section>

  <section class="hh-sec" id="contact"><div class="hh-wrap contact">
    <div class="hh-head left reveal"><p class="hh-kicker">Request a demo</p><h2>See HushHawk with your own workflow.</h2><p>Tell us a little about your portfolio. We’ll reply within one business day to set up a walkthrough.</p>
      <ul class="contact-points"><li>${icon('check')} A guided tour of the inbox, AI and maintenance</li><li>${icon('check')} Help planning your number and email setup</li><li>${icon('check')} No commitment</li></ul></div>
    <form class="contact-form reveal" data-home-form="lead" novalidate>
      <label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Work email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>Company<input name="company" maxlength="120" autocomplete="organization"></label>
      <label>Phone <small>(optional)</small><input name="phone" maxlength="40" autocomplete="tel"></label>
      <label>Units managed<input name="units" inputmode="numeric" maxlength="10"></label>
      <label class="wide">What would you like to see?<textarea name="message" rows="3" maxlength="2000"></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="contact-status wide" role="status"></p>
      <button class="hh-btn lg wide">Request a demo ${svg(ex.arrow)}</button>
      <small class="wide">By sending this you agree to our <a href="#privacy">Privacy Policy</a>.</small>
    </form>
  </div></section>

  <section class="hh-wrap hh-cta reveal"><div class="cta-in">
    <h2>See your next missed call handled in minutes.</h2>
    <p>Open the interactive demo. No sign-up, no real tenants, nothing to install.</p>
    <div class="hh-ctas"><a class="hh-btn lg light" href="#demo">Try the interactive demo ${svg(ex.arrow)}</a><a class="hh-btn ghost dark lg" href="#signup">Create an account</a></div>
  </div></section>
  </main>

  <footer class="hh-foot"><div class="hh-wrap hh-foot-in">${brand()}
    <nav aria-label="Footer">${nav.map(([id,label])=>`<a href="#${id}" data-scroll="${id}">${label}</a>`).join('')}<a href="#login">Sign in</a><a href="#signup">Create an account</a></nav>
    <small>Powered by HushHawk · <a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#sms-terms">Messaging terms</a> · The interactive demo uses fictional data.</small>
  </div></footer>
  </div>`;
}

let stopHome=()=>{};
function renderPricing(root,data){
  const box=root.querySelector('[data-pricing]');
  if(!box)return;
  if(!data){box.innerHTML='<p class="price-loading">Plans are shown here once the HushHawk service is running. <a href="#contact" data-scroll="contact">Ask us for pricing.</a></p>';return;}
  const names=Object.fromEntries(data.catalog.map(([k,n])=>[k,n]));
  const money=c=>c%100?`$${(c/100).toFixed(2)}`:`$${(c/100).toLocaleString()}`;
  box.innerHTML=data.plans.map((p,i)=>`<article class="price${i===1?' featured':''}"><h3>${p.name}</h3><p class="price-amount"><strong>${money(p.priceCents)}</strong><span>/ month</span></p><p class="price-desc">${p.description}</p>
    <ul>${p.features.map(f=>`<li>${names[f]||f}</li>`).join('')}<li>${p.seats?p.seats+' team seats':'Unlimited team seats'}</li><li>${p.properties?p.properties+' properties':'Unlimited properties'}</li><li>${p.support}</li></ul>
    <a class="hh-btn${i===1?'':' ghost'}" href="#signup">${p.trialDays?`Start ${p.trialDays}-day free trial`:'Get started'}</a></article>`).join('');
}
export function mountHome(root){
  stopHome();
  const film=root.querySelector('.film');
  if(!film)return;
  const chs=chapters;
  const D=5200,N=chs.length;
  const scenesEl=[...film.querySelectorAll('.sc')],chaps=[...film.querySelectorAll('.chap')],bars=chaps.map(c=>c.querySelector('.chap-bar i'));
  const side=[...film.querySelectorAll('[data-side]')],cap=film.querySelector('.film-cap'),toggle=film.querySelector('[data-film="toggle"]');
  let idx=0,t=0,playing=false,autoPaused=false,last=performance.now(),raf=0;
  function show(i){
    idx=i;t=0;
    scenesEl.forEach((s,k)=>{s.classList.remove('is-on');if(k===i){void s.offsetWidth;s.classList.add('is-on');}});
    chaps.forEach((c,k)=>{c.classList.toggle('is-active',k===i);c.classList.toggle('is-done',k<i);c.setAttribute('aria-current',k===i?'step':'false');bars[k].style.transform=`scaleX(${k<i?1:0})`;});
    side.forEach(s=>s.classList.toggle('on',Number(s.dataset.side)===sceneSide[i]));
    const list=chaps[i].closest('.chaps');
    if(list.scrollWidth>list.clientWidth)list.scrollTo({left:chaps[i].parentElement.offsetLeft-list.offsetLeft,behavior:'smooth'});
    cap.innerHTML=`<b>0${i+1}</b><div><strong>${chs[i].t}</strong><span>${chs[i].c}</span></div>`;
  }
  function setPlaying(p){
    playing=p;film.classList.toggle('is-paused',!p);
    toggle.setAttribute('aria-label',p?'Pause':'Play');
  }
  function start(i){film.classList.remove('is-poster','is-ended');show(i);setPlaying(true);}
  function frame(now){
    if(!film.isConnected){stopHome();return;}
    if(playing){
      t+=Math.min(now-last,100);
      if(t>=D){
        if(idx<N-1)show(idx+1);
        else{setPlaying(false);bars[idx].style.transform='scaleX(1)';film.classList.add('is-ended');}
      }
      if(playing)bars[idx].style.transform=`scaleX(${Math.min(t/D,1)})`;
    }
    last=now;raf=requestAnimationFrame(frame);
  }
  function onClick(event){
    const scroll=event.target.closest('[data-scroll]');
    if(scroll){event.preventDefault();document.getElementById(scroll.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'});return;}
    if(event.target.closest('[data-watch]')){film.scrollIntoView({behavior:'smooth',block:'center'});start(0);return;}
    const c=event.target.closest('[data-film]');
    if(!c)return;
    const a=c.dataset.film;
    if(a==='play'||a==='replay')start(0);
    else if(a==='chap')start(Number(c.dataset.i));
    else if(a==='toggle'){
      if(film.classList.contains('is-poster')||film.classList.contains('is-ended'))start(0);
      else setPlaying(!playing);
    }
  }
  root.addEventListener('click',onClick);
  fetch('/api/public/plans').then(r=>r.ok&&r.headers.get('Content-Type')?.includes('json')?r.json():null).catch(()=>null).then(data=>renderPricing(root,data));
  const onSubmit=async event=>{
    const form=event.target.closest('form[data-home-form="lead"]');
    if(!form)return;
    event.preventDefault();
    const status=form.querySelector('.contact-status'),button=form.querySelector('button');
    const data=Object.fromEntries(new FormData(form));
    if(!data.name?.trim()||!/^\S+@\S+\.\S+$/.test(data.email||'')){status.textContent='Please add your name and a valid work email.';return;}
    button.disabled=true;status.textContent='Sending…';
    try{
      const response=await fetch('/api/public/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Something went wrong. Please email us instead.');
      form.innerHTML='<div class="contact-done"><strong>Thanks! Your request is in.</strong><p>We’ll reply within one business day. Check your email for a confirmation.</p></div>';
    }catch(error){status.textContent=/Unexpected|JSON/.test(error.message)?'Demo requests need the HushHawk service running.':error.message;button.disabled=false;}
  };
  root.addEventListener('submit',onSubmit);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.12,rootMargin:'0px 0px -40px 0px'});
  root.querySelectorAll('.reveal').forEach(el=>reduce?el.classList.add('in'):io.observe(el));
  const vis=new IntersectionObserver(([e])=>{
    if(!e.isIntersecting&&playing){autoPaused=true;setPlaying(false);}
    else if(e.isIntersecting&&autoPaused){autoPaused=false;setPlaying(true);}
  },{threshold:.25});
  vis.observe(film);
  show(0);
  raf=requestAnimationFrame(frame);
  stopHome=()=>{cancelAnimationFrame(raf);root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);io.disconnect();vis.disconnect();stopHome=()=>{};};
}

export function login({brand,icon}){
  const eye='<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  return `<main class="signin" id="main">
    <section class="signin-panel">
      <header class="signin-top">${brand()}<a class="signin-back" href="#home"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg><span>Back to site</span></a></header>
      <div class="signin-body">
        <p class="signin-eyebrow">HushHawk account</p>
        <h1>Welcome back</h1>
        <p class="signin-lede">Sign in to your company workspace or the HushHawk admin console.</p>

        <form data-acct-form="signin" class="signin-form" novalidate>
          <label class="field" for="admin-email"><span>Email</span>
            <input id="admin-email" type="email" name="email" placeholder="you@company.com" required autocomplete="username" spellcheck="false" autofocus>
          </label>
          <label class="field" for="admin-password"><span>Password</span>
            <span class="field-pw">
              <input id="admin-password" type="password" name="password" placeholder="Enter your password" required autocomplete="current-password">
              <button type="button" class="field-reveal" data-acct="reveal" aria-label="Show password" aria-pressed="false">${eye}</button>
            </span>
          </label>
          <div class="signin-row"><label class="signin-remember"><input type="checkbox" name="remember" checked><span>Keep me signed in</span></label><a class="signin-forgot" href="#forgot">Forgot password?</a></div>
          <div class="admin-login-error" id="admin-login-error" role="alert" style="display:none;"></div>
          <button type="submit" class="signin-submit">Sign in</button>
        </form>

        <div class="signin-alt">
          <span>New to HushHawk?</span>
          <a href="#signup">Create an account</a>
        </div>
        <p class="signin-demo">Just looking? <a href="#demo">Explore the interactive demo</a></p>
      </div>
      <footer class="signin-foot">${icon('lock')}<span>Secure session · Every admin action is audit-logged</span></footer>
    </section>

    <aside class="signin-art" aria-hidden="true">
      <div class="art-glow"></div>
      <div class="art-copy">
        <p class="signin-eyebrow">HushHawk Property Management</p>
        <h2>Every tenant message, with a clear next step.</h2>
      </div>
      <div class="art-stack">
        <div class="art-card"><span class="art-ico">${icon('phone')}</span><div><strong>Missed call · Unit 204</strong><small>“Water leaking under my kitchen sink.”</small></div><time>9:41</time></div>
        <div class="art-card"><span class="art-ico">${icon('send')}</span><div><strong>Reply sent to Sarah J.</strong><small>Acknowledged and logged automatically</small></div><time>9:41</time></div>
        <div class="art-card is-done"><span class="art-ico">${icon('tool')}</span><div><strong>Ticket created · Kitchen leak</strong><small>Assigned to Riverside maintenance</small></div><time>9:42</time></div>
      </div>
      <ul class="art-points"><li>${icon('inbox')} Calls, texts &amp; email in one inbox</li><li>${icon('flow')} Rules that route the work</li><li>${icon('check')} Full audit history</li></ul>
    </aside>
  </main>`;
}

// Draft legal pages. They must be reviewed by a lawyer and completed before launch.
const LEGAL={
  terms:['Terms of Service',[
    ['Agreement','These terms govern use of HushHawk Property Management (the “Service”) provided by [HushHawk legal entity name] (“HushHawk”). By creating an account or using the Service you agree to them on behalf of your company.'],
    ['Accounts','You are responsible for your team’s accounts, keeping credentials secure, and the accuracy of information you add. Turn on two-step sign-in for owners and admins.'],
    ['Acceptable use','Do not use the Service to send unsolicited or unlawful messages, to harass anyone, or to process data you have no right to process. Follow the Messaging Terms for SMS and calls.'],
    ['AI features','AI suggestions can be wrong. You are responsible for reviewing replies and for messages sent from your account, including automatic replies you enable.'],
    ['Subscriptions and payment','Plans, trials, usage limits and overage are described on the pricing page and in Billing. Invoices are due by the date shown. Access may be paused for unpaid invoices after a grace period.'],
    ['Your data','You own your data. You can export it at any time and request deletion. See the Privacy Policy for how data is handled.'],
    ['Availability and changes','We aim for high availability but the Service is provided “as is” to the extent permitted by law. We may update features and these terms with notice.'],
    ['Liability','[Limitation of liability, indemnity, governing law and dispute resolution to be completed by counsel.]'],
    ['Contact','[Legal contact email and postal address.]']]],
  privacy:['Privacy Policy',[
    ['Who we are','[HushHawk legal entity name and address] provides HushHawk Property Management to property management companies. For tenant data in a company’s workspace, that company is the controller and HushHawk processes it on their behalf.'],
    ['What we collect','Account details (name, email, company), workspace content (contacts, properties, conversations, files), usage and billing records, and technical logs needed to run and secure the Service.'],
    ['How we use it','To provide the Service, deliver messages, run AI features you enable, bill subscriptions, provide support, and keep the Service secure. We do not sell personal information.'],
    ['Service providers','We use providers for hosting, messaging (for example Twilio), email (Postmark), payments (Stripe) and AI (Anthropic). They process data only to provide their service. [Confirm the final list and data processing agreements.]'],
    ['Retention and deletion','Companies can set how long conversations are kept, export their data, and request deletion; deletion completes 30 days after the request. Invoices are kept as required for accounting.'],
    ['Security','Passwords are hashed, provider keys are encrypted, sessions are protected, and two-step sign-in is available. Access to customer conversations by HushHawk staff is limited and logged.'],
    ['Your rights','Depending on where you live you may have rights to access, correct or delete your information. Contact [privacy email].'],
    ['Changes','We will post updates here with the effective date. Effective date: [date].']]],
  'sms-terms':['Messaging Terms',[
    ['Consent','Companies must have consent before texting tenants, and must honor opt-outs. STOP, UNSUBSCRIBE and similar replies are processed automatically and block further texts to that number.'],
    ['Message types','Use HushHawk for service messages about tenancies and maintenance. Marketing messages need separate, explicit consent.'],
    ['Registration','US business texting through 10-digit numbers requires carrier registration (A2P 10DLC). HushHawk will help complete it before numbers go live.'],
    ['AI and automation','Automatic replies identify the property team and never claim to be a specific person. Emergencies are escalated to people with safety instructions.'],
    ['Calls and recording','Voice features are not yet available. When they are, call recording will follow the consent rules of each jurisdiction.'],
    ['Help','Reply HELP for help. Message and data rates may apply. [Support contact.]']]]
};
export function legalPage(kind,{brand}){
  const [title,sections]=LEGAL[kind]||LEGAL.terms;
  return `<main class="legal" id="main"><header class="legal-top">${brand()}<a class="signin-back" href="#home">Back to site</a></header>
    <article class="legal-body"><p class="legal-draft">Draft for review. These terms must be completed and reviewed by a lawyer before launch. Text in [brackets] needs your details.</p>
    <h1>${title}</h1>${sections.map(([h,p])=>`<h2>${h}</h2><p>${p}</p>`).join('')}
    <nav class="legal-nav"><a href="#terms">Terms of Service</a><a href="#privacy">Privacy Policy</a><a href="#sms-terms">Messaging Terms</a></nav></article></main>`;
}
