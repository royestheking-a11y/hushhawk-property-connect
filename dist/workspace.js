import {now,uid} from './model.js';

export function upgrade(state) {
  state.scheduled ??= [];
  state.settings.automationPaused ??= false;
  state.settings.tone ??= 'Professional';
  for (const thread of state.threads) {
    thread.labels ??= [];
    thread.followUp ??= '';
    thread.automationPaused ??= false;
  }
  for (const rule of state.rules) {
    rule.history ??= [];
    rule.channel ??= '';
    rule.property ??= '';
    rule.priority ??= '';
    rule.order ??= 50;
  }
  return state;
}

export function createJob(state, thread, kind, value, date) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('Choose a future date and time.');
  const job = {id:uid(),thread:thread.id,kind,value,date:new Date(timestamp).toISOString(),status:'Scheduled'};
  state.scheduled.push(job);
  if (kind === 'Reminder') thread.followUp=job.date;
  return job;
}

export function runDueJobs(state, send, timestamp = Date.now()) {
  const processed = [];
  for (const job of state.scheduled.filter(job=>job.status==='Scheduled' && Date.parse(job.date)<=timestamp).sort((a,b)=>a.date.localeCompare(b.date))) {
    const thread=state.threads.find(row=>row.id===job.thread);
    try {
      if (!thread) throw new Error('The linked conversation is unavailable.');
      if (job.kind==='Reminder') {
        thread.status='Open';
        thread.unread=true;
        thread.updated=now();
        if (thread.followUp===job.date) thread.followUp='';
        state.tasks.push({id:uid(),title:'Reminder · '+job.value,thread:thread.id,assigned:thread.assigned,due:'',status:'Open'});
      } else {
        send(thread,job.value);
      }
      job.status='Completed';
      job.error='';
    } catch(error) {
      job.status='Failed';
      job.error=error.message;
    }
    job.processed=now();
    processed.push(job);
  }
  return processed;
}
