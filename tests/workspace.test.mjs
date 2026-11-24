import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,inbound,runRules,suggest} from '../dist/model.js';
import {upgrade,createJob,runDueJobs} from '../dist/workspace.js';

const event = {channel:'SMS',sender:'+15125550104',subject:'Question',body:'Could you explain the parking permit process?',eventId:'e-1'};

test('older workspace records initialize the new settings and rule conditions',()=>{
  const state=upgrade(seed());
  assert.deepEqual(state.scheduled,[]);
  assert.equal(state.settings.automationPaused,false);
  assert.equal(state.rules[0].order,50);
  assert.deepEqual(state.threads[0].labels,[]);
});

test('matching rule applies a label and filters by channel and property',()=>{
  const state=upgrade(seed());
  state.rules.push({name:'Property access',trigger:'Access',action:'Label conversation',channel:'SMS',property:'p1',enabled:true});
  state.rules.push({name:'Email only',trigger:'Access',action:'Escalate to staff',channel:'Email',enabled:true});
  const {thread}=inbound(state,event);
  assert.equal(thread.category,'Access');
  assert.deepEqual(thread.labels,['Access']);
  assert.deepEqual(state.runs.map(run=>run.name),['Property access']);
  assert.equal(inbound(state,event).duplicate,true);
});

test('rule conditions and pause controls apply independently',()=>{
  const state=upgrade(seed());
  state.settings.automationPaused=true;
  const {thread}=inbound(state,{...event,body:'Gas leak in building'});
  assert.equal(thread.priority,'Emergency');
  assert.equal(state.runs.length,0);
  runRules(state,thread,'Emergency',{name:'Test rule',action:'Escalate to staff',property:'p2'});
  assert.match(state.runs[0].result,/conditions did not match/);
});

test('scheduled reminders reopen the thread and run exactly once',()=>{
  const state=upgrade(seed());
  const thread=state.threads.find(row=>row.status==='Archived');
  const job=createJob(state,thread,'Reminder','Call resident',new Date(Date.now()+60000).toISOString());
  assert.equal(thread.followUp,job.date);
  assert.equal(runDueJobs(state,()=>{},Date.parse(job.date)-1).length,0);
  assert.equal(runDueJobs(state,()=>{},Date.parse(job.date)).length,1);
  assert.equal(runDueJobs(state,()=>{},Date.parse(job.date)).length,0);
  assert.equal(thread.followUp,'');
  assert.equal(thread.status,'Open');
  assert.equal(state.tasks.at(-1).title,'Reminder · Call resident');
});

test('send errors leave a visible failed job',()=>{
  const state=upgrade(seed());
  const job=createJob(state,state.threads[0],'Message','Hello',new Date(Date.now()+60000).toISOString());
  runDueJobs(state,()=>{throw new Error('Recipient opted out');},Date.parse(job.date));
  assert.equal(job.status,'Failed');
  assert.equal(job.error,'Recipient opted out');
});

test('assistant preserves unknown-contact and emergency handling',()=>{
  const state=upgrade(seed());
  const {thread}=inbound(state,{...event,sender:'+15125550188'});
  const recipient=state.contacts.find(row=>row.id===thread.contact);
  assert.match(suggest(thread,recipient,state.knowledge,'Concise'),/confirm your name/);
  inbound(state,{...event,eventId:'e-2',sender:event.sender,body:'Gas leak'});
  assert.throws(()=>suggest(state.threads[0],state.contacts[0],state.knowledge),/Urgent report/);
});
