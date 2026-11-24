export const channels = ['SMS', 'Email', 'Call', 'Voicemail'];
export const statuses = ['Open', 'Pending', 'Resolved', 'Archived'];
export const priorities = ['Low', 'Normal', 'High', 'Emergency'];
export const ticketStatuses = ['New', 'Triaged', 'Assigned', 'Scheduled', 'In progress', 'Resolved', 'Closed'];
export const triggers = ['Maintenance', 'Emergency', 'Missed call', 'Rent', 'Lease', 'Access', 'Noise', 'Appointment', 'Complaint', 'Vendor', 'General'];
export const ruleActions = ['Create maintenance ticket', 'Create follow-up task', 'Queue reply for approval', 'Label conversation', 'Escalate to staff'];
export const uid = () => crypto.randomUUID();
const daysAgo = (days, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
export const now = () => new Date().toISOString();

export function seed() {
  const properties = [
    {id:'p1',name:'Riverside Apartments',address:'125 River Walk, Austin, TX',units:'101, 103, 204, 206'},
    {id:'p2',name:'The Westbrook',address:'72 Westbrook Lane, Austin, TX',units:'3A, 3B, 4C'},
    {id:'p3',name:'Oakview Residences',address:'410 Live Oak Drive, Austin, TX',units:'110, 112, 208'}
  ];
  const contacts = [
    {id:'c1',name:'Sarah Johnson',type:'Tenant',property:'p1',unit:'204',email:'sarah@example.test',phone:'+15125550104',verified:true,optout:false},
    {id:'c2',name:'Michael Chen',type:'Tenant',property:'p1',unit:'103',email:'michael@example.test',phone:'+15125550103',verified:true,optout:false},
    {id:'c3',name:'Elena Rodriguez',type:'Tenant',property:'p2',unit:'3B',email:'elena@example.test',phone:'+15125550123',verified:true,optout:false},
    {id:'c4',name:'James Wilson',type:'Tenant',property:'p3',unit:'112',email:'james@example.test',phone:'+15125550112',verified:true,optout:false},
    {id:'c5',name:'Brightline Plumbing',type:'Vendor',property:'',unit:'',email:'dispatch@example.test',phone:'+15125550151',verified:true,optout:false},
    {id:'c6',name:'Nora Patel',type:'Owner',property:'p2',unit:'',email:'nora@example.test',phone:'+15125550142',verified:true,optout:false}
  ];
  const snippets = [
    ['c1','SMS','Kitchen sink leak','Hi, there’s water leaking under my kitchen sink. Can someone take a look?',0,'High','Open'],
    ['c2','Email','HVAC maintenance update','Could you share the latest update on the air conditioning service request?',0,'Normal','Pending'],
    ['c3','Voicemail','Parking permit question','Hi, I’m calling about a replacement parking permit. Please call me back.',1,'Normal','Open'],
    ['c4','SMS','Package room access','Thanks, I found the package in the lobby.',1,'Low','Resolved'],
    ['c5','Email','Work order availability','We have availability for a plumbing visit on Wednesday afternoon.',2,'Normal','Open'],
    ['c6','Call','Property update','Incoming call missed. Owner requested a callback.',3,'Normal','Open'],
    ['c2','SMS','Entry notice received','Hi, I received the entry notice. Thanks for letting me know.',4,'Low','Resolved'],
    ['c3','Email','Community room','Where can I find the community room reservation policy?',5,'Normal','Archived'],
    ['c4','Call','Maintenance callback','Callback completed. Tenant confirmed the issue is resolved.',6,'Low','Resolved']
  ];
  const threads = snippets.map(([contact,channel,subject,body,day,priority,status],i)=>({
    id:'t'+(i+1),contact,channel,subject,priority,status,assigned:i===1?'u2':'',unread:i<3,updated:daysAgo(day),
    messages:[{id:'m'+(i+1),kind:'in',body,time:daysAgo(day)}]
  }));
  return {
    properties,contacts,threads,
    tickets:[
      {id:'mt1',title:'Kitchen sink leak',thread:'t1',contact:'c1',property:'p1',priority:'High',status:'New',description:snippets[0][3],assigned:'',date:daysAgo(0)},
      {id:'mt2',title:'AC service request',thread:'t2',contact:'c2',property:'p1',priority:'Normal',status:'In progress',description:snippets[1][3],assigned:'u2',date:daysAgo(2)}
    ],
    tasks:[{id:'ta1',title:'Return Elena’s voicemail',thread:'t3',assigned:'u1',due:'',status:'Open'},{id:'ta2',title:'Call James about residence follow-up',thread:'',assigned:'u2',due:'',status:'Done'}],
    events:[{id:'e1',title:'HVAC service window',date:daysAgo(0).slice(0,10),time:'14:00',property:'p1',notes:'Fictional service visit.'}],
    calls:[
      {id:'ca1',contact:'c3',thread:'t3',status:'Voicemail',duration:'0:33',date:daysAgo(1),notes:snippets[2][3]},
      {id:'ca2',contact:'c6',thread:'t6',status:'Missed',duration:'0:00',date:daysAgo(3),notes:''},
      {id:'ca3',contact:'c4',thread:'t9',status:'Answered',duration:'2:48',date:daysAgo(6),notes:snippets[8][3]}
    ],
    approvals:[],rules:[
      {id:'r1',name:'Maintenance intake',trigger:'Maintenance',action:'Create maintenance ticket',enabled:true},
      {id:'r2',name:'Emergency review',trigger:'Emergency',action:'Create follow-up task',enabled:true},
      {id:'r3',name:'Missed call follow-up',trigger:'Missed call',action:'Create follow-up task',enabled:true}
    ],runs:[],
    templates:[
      {id:'tm1',name:'Maintenance acknowledgment',channel:'SMS',body:'Thanks for reporting this. Our team will review your maintenance request and follow up.'},
      {id:'tm2',name:'Request for details',channel:'Email',body:'Thanks for reaching out. Could you share any additional details that would help our team look into this?'}
    ],
    knowledge:[
      {id:'k1',title:'Maintenance intake',topic:'Maintenance',body:'For non-urgent maintenance, share when the issue began and any visible symptoms.'},
      {id:'k2',title:'Office hours',topic:'Office hours',body:'The property team reviews routine requests Monday to Friday, from 9 a.m. to 5 p.m.'}
    ],
    team:[{id:'u1',name:'Alex Morgan',email:'alex@example.test',role:'Company Owner',status:'Active'},{id:'u2',name:'Jordan Lee',email:'jordan@example.test',role:'Maintenance Coordinator',status:'Active'},{id:'u3',name:'Taylor Brooks',email:'taylor@example.test',role:'Communication Agent',status:'Active'}],
    draft:{},audit:[],leads:[],providerEvents:[],settings:{company:'HushHawk Demo Portfolio',timezone:'America/Chicago',hours:'Mon–Fri, 9:00–17:00',assistant:'HushHawk Assistant',mode:'Human approval'},
    billing:{plan:'Professional'}, integrations:{}
  };
}

export function classify(body, channel) {
  if (/fire|gas leak|flood|sparking|smoke|immediate danger/i.test(body)) return 'Emergency';
  if (channel === 'Call' || channel === 'Voicemail') return 'Missed call';
  if (/leak|plumb|sink|maintenance|repair|HVAC|heating|cooling|broken|air condition/i.test(body)) return 'Maintenance';
  if (/rent|payment|balance|invoice/i.test(body)) return 'Rent';
  if (/lease|renewal|move.out|move.in/i.test(body)) return 'Lease';
  if (/parking|access|lockout|key|entry/i.test(body)) return 'Access';
  if (/noise|loud|disturbance/i.test(body)) return 'Noise';
  if (/appointment|reschedule|booking|availability/i.test(body)) return 'Appointment';
  if (/complaint|frustrated|unacceptable/i.test(body)) return 'Complaint';
  if (/contractor|vendor|work order/i.test(body)) return 'Vendor';
  return 'General';
}

export function suggest(thread, contact, knowledge, tone='Professional') {
  const incoming = thread.messages.filter(message=>message.kind==='in').at(-1)?.body ?? '';
  const category = classify(incoming,thread.channel);
  if (category === 'Emergency') throw new Error('Urgent report. Escalate to staff for direct handling.');
  if (!contact?.verified) return 'Thanks for reaching out. Please confirm your name and property or unit so our team can route your request.';
  const entry = knowledge.find(note=>note.topic === category || (note.topic === 'Office hours' && /office hours|opening hours/i.test(incoming)));
  const opening = tone === 'Friendly' ? 'Hi there! Thanks for reaching out.' : 'Thanks for reaching out.';
  if (tone === 'Concise') return entry?.body || 'Our property team will review your message and follow up.';
  return entry ? `${opening} ${entry.body} Our team can follow up if you need more help.` : `${opening} Our property team will review your message and follow up.`;
}

export function inbound(state, event) {
  if (state.providerEvents.includes(event.eventId)) return {duplicate:true};
  const channel = event.channel;
  const field = channel === 'Email' ? 'email' : 'phone';
  const normalize = value => field === 'email' ? value.trim().toLowerCase() : value.replace(/[^\d]/g,'');
  const address = normalize(event.sender);
  if (!address) throw new Error('Enter a sender address or phone number.');
  let contact = state.contacts.find(person=>person[field] && normalize(person[field])===address);
  if (!contact) {
    contact={id:uid(),name:event.sender,type:'Other',email:'',phone:'',property:'',unit:'',verified:false,optout:false,[field]:event.sender};
    state.contacts.push(contact);
  }
  let thread = state.threads.find(item=>item.contact===contact.id && item.channel===channel && (channel!=='Email' || item.subject.toLowerCase()===event.subject.toLowerCase()));
  if (!thread) {
    thread={id:uid(),contact:contact.id,channel,subject:event.subject,priority:'Normal',status:'Open',assigned:'',unread:true,updated:now(),labels:[],followUp:'',automationPaused:false,messages:[]};
    state.threads.push(thread);
  }
  thread.messages.push({id:uid(),kind:'in',body:event.body,time:now()});
  thread.updated=now();
  thread.status='Open';
  thread.unread=true;
  state.providerEvents.push(event.eventId);
  if (channel === 'SMS' && /^(stop|unsubscribe|cancel|end|quit)$/i.test(event.body.trim())) {
    contact.optout=true;
    return {thread,optOut:true};
  }
  if (channel==='Call' || channel==='Voicemail') {
    state.calls.push({id:uid(),contact:contact.id,thread:thread.id,status:channel==='Call'?'Missed':'Voicemail',duration:'0:00',date:now(),notes:event.body});
  }
  const category=classify(event.body,channel);
  thread.category=category;
  if (category==='Emergency') thread.priority='Emergency';
  runRules(state,thread,category);
  return {thread,category};
}

export function runRules(state, thread, category, explicitRule) {
  const contact=state.contacts.find(person=>person.id===thread.contact);
  const matches = rule => (!rule.channel || rule.channel===thread.channel) &&
    (!rule.property || rule.property===contact?.property) && (!rule.priority || rule.priority===thread.priority);
  const applicable=explicitRule?[explicitRule]:state.settings.automationPaused||thread.automationPaused
    ? []
    : state.rules.filter(rule=>rule.enabled && rule.trigger===category && matches(rule)).sort((a,b)=>(a.order??50)-(b.order??50));
  for (const rule of applicable) {
    let result='Completed';
    try {
      if (!matches(rule)) {
        result='Skipped · conditions did not match';
      } else if (rule.action==='Label conversation') {
        thread.labels=[...new Set([...(thread.labels||[]),category])];
      } else if (rule.action==='Escalate to staff') {
        thread.priority=category==='Emergency'?'Emergency':'High';
        thread.unread=true;
        if (!state.tasks.some(task=>task.thread===thread.id&&task.status==='Open')) {
          state.tasks.push({id:uid(),title:'Escalation · '+thread.subject,thread:thread.id,assigned:thread.assigned,due:'',status:'Open'});
        }
      } else if (rule.action==='Create maintenance ticket') {
        if (state.tickets.some(ticket=>ticket.thread===thread.id && !['Closed','Resolved'].includes(ticket.status))) result='Skipped · open ticket exists';
        else state.tickets.push({id:uid(),title:thread.subject,thread:thread.id,contact:thread.contact,property:contact?.property??'',priority:thread.priority,status:'New',description:thread.messages.filter(m=>m.kind==='in').at(-1)?.body??'',assigned:'',date:now()});
      } else if (rule.action==='Create follow-up task') {
        if (state.tasks.some(task=>task.thread===thread.id && task.status==='Open' && task.title===`${category}: ${thread.subject}`)) result='Skipped · follow-up exists';
        else state.tasks.push({id:uid(),title:`${category}: ${thread.subject}`,thread:thread.id,assigned:thread.assigned,due:'',status:'Open'});
      } else if (rule.action==='Queue reply for approval') {
        if (contact?.optout || state.settings.mode!=='Human approval' || !['SMS','Email'].includes(thread.channel)) throw new Error('Reply is blocked by communication settings.');
        if (state.approvals.some(approval=>approval.thread===thread.id && approval.status==='Pending')) result='Skipped · approval pending';
        else state.approvals.push({id:uid(),thread:thread.id,body:suggest(thread,contact,state.knowledge,state.settings.tone),status:'Pending',date:now()});
      }
    } catch (error) {
      result=`Blocked · ${error.message}`;
    }
    state.runs.unshift({id:uid(),name:rule.name,thread:thread.id,result,date:now()});
  }
}
