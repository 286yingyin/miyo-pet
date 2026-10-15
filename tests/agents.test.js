'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {snapshot,toPetState}=require('../scripts/agents/schema');
const {createAdapter}=require('../scripts/agents/workbuddy');
const {createHub}=require('../scripts/agents/hub');
function fixture(){
 let value={ok:true,scope:'current',session:'a',processing:1,pending:0,approval:0};
 const timers=new Map(), watchers=[];let next=0,reads=0;
 const clock={setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);},setInterval(fn){timers.set(++next,fn);return next;},clearInterval(id){timers.delete(id);}};
 const fs={existsSync:()=>true,watch(dir,opts,fn){const w={dir,fn,closed:false,on(){},close(){w.closed=true;}};watchers.push(w);return w;}};
 const core={resolveRoots:()=>({root:'r',tasks:'r/tasks',sessions:'r/sessions',spool:'r/spool',audit:'r/audit'}),snapshot(){reads++;return {...value};}};
 return {adapter:createAdapter({core,fs,timers:clock}),timers,watchers,set(v){value={...value,...v};},get reads(){return reads;}};
}
test('unconfigured_is_not_task_failure',()=>{const s=toPetState(snapshot('codex'));assert.equal(s.error,false);assert.equal(s.processing,0);assert.equal(s.justDone,false);});
test('nullable_counts_are_not_tasks',()=>{const s=toPetState(snapshot('codex',{health:'ready',phase:'running'}));assert.equal(s.counts.processing,null);assert.equal(s.processing,0);assert.equal(s.phase,'running');});
test('read_failure_keeps_last_good_without_done',async()=>{const f=fixture();await f.adapter.start(()=>{});f.set({ok:false,error:true,processing:0,justDone:true});const s=await f.adapter.refresh();assert.equal(s.health,'stale');assert.equal(s.counts.processing,1);assert.equal(s.completionKey,null);assert.equal(toPetState(s).error,false);await f.adapter.stop();});
test('disabled_provider_stops_and_emits_nothing',async()=>{const f=fixture(),out=[];const h=createHub({adapters:{workbuddy:f.adapter},activeProvider:'workbuddy',onSnapshot:s=>out.push(s)});await h.setActiveProvider('workbuddy');const callbacks=[...f.timers.values(),...f.watchers.map(w=>w.fn)];await h.setEnabled('workbuddy',false);const n=out.length,r=f.reads;for(const cb of callbacks)cb();await f.adapter.refresh();assert.equal(out.length,n);assert.equal(f.reads,r);assert.equal(f.timers.size,0);assert.ok(f.watchers.every(w=>w.closed));await h.dispose();});
test('repeated_start_stop_owns_one_set_and_dispose_filters_callbacks',async()=>{const f=fixture(),out=[];await f.adapter.start(s=>out.push(s));const count=f.watchers.length;await f.adapter.start(s=>out.push(s));assert.equal(f.watchers.length,count);assert.equal(f.timers.size,1);const late=f.watchers[0].fn;await f.adapter.stop();await f.adapter.stop();late();assert.equal(f.timers.size,0);await f.adapter.start(s=>out.push(s));assert.equal(f.watchers.filter(w=>!w.closed).length,count);await f.adapter.stop();});
test('provider_switch_never_reuses_completion',async()=>{const f=fixture(),out=[];const h=createHub({adapters:{workbuddy:f.adapter},activeProvider:'workbuddy',onSnapshot:s=>out.push(s)});await h.setActiveProvider('workbuddy');f.set({processing:0,justDone:true});await f.adapter.refresh();assert.ok(h.getSnapshot().completionKey);await h.setActiveProvider('codex');assert.equal(h.getSnapshot().health,'unconfigured');assert.equal(h.getSnapshot().completionKey,null);await h.setActiveProvider('workbuddy');assert.equal(h.getSnapshot().completionKey,null);assert.ok(out.every((s,i)=>!i||s.rev>out[i-1].rev));await h.dispose();});
test('session_and_settings_changes_reset_completion_baseline',async()=>{const f=fixture();await f.adapter.start(()=>{});f.set({session:'b',processing:0,justDone:true});assert.equal((await f.adapter.refresh()).completionKey,null);f.set({processing:1});await f.adapter.refresh();f.set({scope:'all',processing:0});assert.equal((await f.adapter.refresh()).completionKey,null);await f.adapter.stop();});


test('hub rejects previous adapter emissions after switch and dispose',async()=>{
  let callback, stopped=0;const out=[];
  const adapter={async start(emit){callback=emit;emit(snapshot('workbuddy',{health:'ready',phase:'running'}));},async refresh(){},async stop(){stopped++;}};
  const h=createHub({adapters:{workbuddy:adapter},activeProvider:'workbuddy',onSnapshot:s=>out.push(s)});
  await h.setActiveProvider('workbuddy');const old=callback;await h.setActiveProvider('codex');const count=out.length;
  old(snapshot('workbuddy',{health:'ready',phase:'completed',completionKey:'late'}));assert.equal(out.length,count);
  await h.setActiveProvider('workbuddy');const beforeDispose=out.length;await h.dispose();callback(snapshot('workbuddy',{phase:'failed'}));
  await h.setEnabled('workbuddy',true);await h.refresh();assert.equal(out.length,beforeDispose);assert.equal(stopped,2);
});
test('recovery after read failure establishes a fresh completion baseline',async()=>{
  const f=fixture();await f.adapter.start(()=>{});f.set({ok:false,processing:0});await f.adapter.refresh();
  f.set({ok:true,processing:0,justDone:true});assert.equal((await f.adapter.refresh()).completionKey,null);await f.adapter.stop();
});
test('queued old debounce cannot orphan a new lifecycle timer',async()=>{
  const f=fixture();await f.adapter.start(()=>{});f.watchers[0].fn();
  const oldDebounce=[...f.timers.values()].at(-1);await f.adapter.stop();await f.adapter.start(()=>{});
  f.watchers.find(w=>!w.closed).fn();oldDebounce();await f.adapter.stop();assert.equal(f.timers.size,0);
});
test('failed adapter start releases partial resources and invalidates its callback',async()=>{
  let callback,stops=0;const out=[];
  const adapter={async start(emit){callback=emit;throw new Error('synthetic start failure');},async refresh(){},async stop(){stops++;}};
  const h=createHub({adapters:{workbuddy:adapter},onSnapshot:s=>out.push(s)});await h.setActiveProvider('workbuddy');
  assert.equal(stops,1);assert.equal(h.getSnapshot().health,'error');const count=out.length;
  callback(snapshot('workbuddy',{phase:'completed',completionKey:'late'}));assert.equal(out.length,count);await h.dispose();
});
