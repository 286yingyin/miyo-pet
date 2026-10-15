'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseLine,normalizeThreadId,MAX_LINE_BYTES}=require('../scripts/codex-event');
const {createAdapter}=require('../scripts/agents/codex');
const SID='11111111-2222-3333-4444-555555555555';
const meta=(extra={})=>({type:'session_meta',payload:{id:SID,cli_version:'0.162.0-alpha.17.2',source:'vscode',thread_source:'user',...extra}});
const event=(type,turn_id,extra={})=>({timestamp:'2026-01-01T00:00:00Z',type:'event_msg',payload:{type,turn_id,...extra}});
const lines=rows=>rows.map(r=>JSON.stringify(r)+'\n').join('');
async function fixture(t,rows=[meta()],options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'miyo-codex-'));
  const home=path.join(root,'home'),events=path.join(root,'events');
  fs.mkdirSync(path.join(home,'sessions','2026'),{recursive:true});
  const file=path.join(home,'sessions','2026','rollout-2026-01-01T00-00-00-'+SID+'.jsonl');
  fs.writeFileSync(file,lines(rows));
  const seen=[],cfg={agent:{codex:{codexHome:home,threadId:SID}}};
  const a=createAdapter({getConfig:()=>cfg,eventDir:events,...options});
  t.after(async()=>{await a.stop();fs.rmSync(root,{recursive:true,force:true});});
  await a.start(s=>seen.push(s));
  return {a,root,file,events,seen,cfg,append:async(...rows)=>{fs.appendFileSync(file,lines(rows));return a.refresh();}};
}
test('parser keeps only lifecycle whitelist and validates local binding',()=>{
  assert.equal(normalizeThreadId('codex://threads/'+SID),SID);
  assert.equal(normalizeThreadId(SID.toUpperCase()),SID);
  for(const value of ['codex://threads/'+SID+'?hostId=remote&threadAccess=SECRET', 'codex://other/'+SID, '../secret', 'codex://threads/'+SID+'?threadAccess=SECRET'])assert.throws(()=>normalizeThreadId(value));
  const raw=event('task_complete','t1',{error:'SECRET error',last_agent_message:'SECRET reply',prompt:'SECRET prompt',arguments:'SECRET args'});
  const x=parseLine(JSON.stringify(raw),{sessionId:SID,streamId:'stream',offset:20,observedAt:1});
  assert.equal(x.kind,'turn_failed');assert.equal(x.turnId,'t1');
  assert.equal(JSON.stringify(x).includes('SECRET'),false);
  assert.deepEqual(Object.keys(x).sort(),['eventId','kind','observedAt','provider','schemaVersion','sessionId','sourceSequence','sourceTime','streamId','turnId'].sort());
  assert.equal(parseLine(JSON.stringify({type:'response_item',payload:{text:'SECRET'}})),null);
});
for (const type of ['constructor', 'toString', '__proto__']) {
  test('parser ignores inherited event name '+type,()=>{
    assert.equal(parseLine(JSON.stringify(event(type,'t1'))),null);
  });
  test('inherited event name '+type+' cannot terminate a live turn or suppress completion',async t=>{
    const f=await fixture(t);
    await f.append(event('task_started','t1'));
    const ignored=await f.append(event(type,'t1'));
    const completed=await f.append(event('task_complete','t1'));
    assert.equal(ignored.phase,'running');assert.equal(ignored.health,'ready');assert.equal(ignored.completionKey,null);
    assert.equal(completed.phase,'completed');assert.equal(completed.health,'ready');assert.equal(completed.completionKey,SID+':t1');
  });
}
test('live lifecycle, failure, interruption and capability limits',async t=>{
  const f=await fixture(t);let s=await f.append(event('task_started','t1'));
  assert.equal(s.phase,'running');assert.equal(s.health,'ready');
  assert.deepEqual(s.counts,{processing:null,pending:null,approval:null});
  assert.deepEqual(s.capabilities,{lifecycle:true,waitingApproval:false,waitingInput:false,sessionClosed:false});
  s=await f.append(event('task_complete','t1',{error:null}));assert.equal(s.phase,'completed');assert.equal(s.completionKey,SID+':t1');
  const summary=fs.readFileSync(path.join(f.events,fs.readdirSync(f.events).find(x=>x.endsWith('.json'))),'utf8');assert.ok(summary.includes(SID+':t1'));
  s=await f.append(event('turn_started','t2'),event('turn_complete','t2',{error:'SECRET'}));assert.equal(s.phase,'failed');assert.equal(s.completionKey,null);
  s=await f.append(event('task_started','t3'),event('turn_aborted','t3',{reason:'interrupted'}));assert.equal(s.phase,'interrupted');
  assert.equal(JSON.stringify(f.seen).includes('SECRET'),false);
});
test('unsupported version and non-root identity never interpret lifecycle',async t=>{
  for(const extra of [{cli_version:'9.0'},{id:'22222222-2222-3333-4444-555555555555'},{source:{SubAgent:{thread_spawn:{}}}},{source:{Internal:'x'}},{thread_source:'subagent'},{thread_source:'arbitrary_feature'},{thread_source:'agent_forked_thread'},{parent_thread_id:SID},{thread_source:'agent_created_thread',parent_thread_id:SID},{thread_source:'agent_created_thread',source:{Internal:'x'}},{thread_source:'agent_created_thread',source:{SubAgent:{thread_spawn:{}}}}]) {
    const f=await fixture(t,[meta(extra),event('task_started','t1')]);
    assert.notEqual(f.seen.at(-1).health,'ready');assert.equal(f.seen.at(-1).phase,'unknown');
    assert.notEqual((await f.append(event('task_started','t2'))).phase,'running');
  }
});
test('explicitly bound agent-created local root supports lifecycle with the same privacy boundary',async t=>{
  const f=await fixture(t,[meta({thread_source:'agent_created_thread'}),event('task_started','baseline'),event('task_complete','baseline')]);
  assert.equal(f.seen.at(-1).health,'ready');assert.equal(f.seen.at(-1).completionKey,null);
  let s=await f.append(event('task_started','fresh'));assert.equal(s.phase,'running');
  s=await f.append(event('task_complete','fresh'));assert.equal(s.completionKey,SID+':fresh');
});
test('initial/re-enabled/restarted history is silent and unmatched start stale unknown',async t=>{
  const f=await fixture(t,[meta(),event('task_complete','old'),event('task_started','active')]);
  assert.equal(f.seen.at(-1).health,'stale');assert.equal(f.seen.at(-1).phase,'unknown');
  await f.a.stop();await f.a.start(s=>f.seen.push(s));assert.equal(f.seen.at(-1).phase,'unknown');
  const s=await f.append(event('task_complete','active'));assert.equal(s.completionKey,null,'historical start is not a live baseline');
  await f.a.stop();const b=createAdapter({getConfig:()=>f.cfg,eventDir:f.events});t.after(()=>b.stop());await b.start(s=>f.seen.push(s));assert.equal(f.seen.at(-1).completionKey,null);
});
test('terminal dedupe, late starts, old terminals and missing abort ID',async t=>{
  const f=await fixture(t);await f.append(event('task_started','a'),event('task_complete','a'));
  let s=await f.append(event('task_complete','a'),event('task_started','a'));assert.equal(s.phase,'completed');assert.equal(s.completionKey,null);
  await f.append(event('task_started','b'));s=await f.append(event('task_complete','a'));assert.equal(s.phase,'running');assert.equal(s.turnId,'b');
  s=await f.append(event('turn_aborted'));assert.equal(s.phase,'interrupted');assert.equal(s.turnId,'b');
  s=await f.append(event('turn_aborted'));assert.equal(s.phase,'unknown');assert.equal(s.completionKey,null);
  await f.append(event('task_started','c'),event('task_started','d'));s=await f.append(event('turn_aborted'));assert.equal(s.phase,'unknown');
});
test('half lines, invalid JSON and bounded line buffering do not fabricate completion',async t=>{
  const f=await fixture(t);await f.append(event('task_started','a'));
  const row=JSON.stringify(event('task_complete','a'));fs.appendFileSync(f.file,row.slice(0,20));let s=await f.a.refresh();assert.equal(s.phase,'running');
  fs.appendFileSync(f.file,row.slice(20)+'\n');s=await f.a.refresh();assert.equal(s.phase,'completed');assert.ok(s.completionKey);
  fs.appendFileSync(f.file,'{bad}\n');s=await f.a.refresh();assert.equal(s.health,'stale');assert.equal(s.completionKey,null);
  fs.appendFileSync(f.file,'x'.repeat(MAX_LINE_BYTES+10));s=await f.a.refresh();assert.equal(s.health,'stale');
  fs.appendFileSync(f.file,'\n');await f.a.refresh();s=await f.append(event('task_started','b'));assert.equal(s.phase,'running');
});
test('truncate, replace, rollback and fork inherited history cannot celebrate',async t=>{
  const f=await fixture(t);await f.append(event('task_started','a'));
  fs.writeFileSync(f.file,lines([meta(),event('task_started','b'),event('task_complete','b')]));let s=await f.a.refresh();assert.equal(s.completionKey,null);
  fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,lines([meta({forked_from_id:SID}),event('task_started','c'),event('task_complete','c')]));s=await f.a.refresh();assert.equal(s.completionKey,null);
  await f.append(event('task_started','d'));s=await f.append(event('task_complete','d'),event('thread_rolled_back',undefined,{num_turns:1}));assert.equal(s.completionKey,null);assert.notEqual(s.turnId,'d');
});
test('atomic summary failure suppresses celebration and source failures retain last good',async t=>{
  const real=fs.promises;let fail=false;
  const io=new Proxy(real,{get(target,key){if(key==='rename')return async(...args)=>{if(fail)throw new Error('SECRET disk');return real.rename(...args);};return target[key];}});
  const f=await fixture(t,undefined,{fs:{...fs,promises:io}});await f.append(event('task_started','a'));fail=true;
  let s=await f.append(event('task_complete','a'));assert.equal(s.completionKey,null);assert.equal(s.reason,'persist_failed');fail=false;
  s=await f.a.refresh();assert.equal(s.completionKey,null,'failed persistence cannot replay a celebration');
  await f.append(event('task_started','b'));fs.renameSync(f.file,f.file+'.gone');s=await f.a.refresh();assert.equal(s.phase,'running');assert.equal(s.health,'stale');assert.equal(s.completionKey,null);
});
test('stop releases timers/watchers and disabled refresh performs no source IO',async t=>{
  let calls=0;const timers={setInterval(){calls++;return 1;},clearInterval(){calls--;},setTimeout(){calls++;return 2;},clearTimeout(){calls--;}};
  const f=await fixture(t,undefined,{timers});await f.a.start(()=>{});await f.a.stop();assert.equal(calls,0);
  const old=fs.promises.stat;fs.promises.stat=async()=>{throw new Error('must not read');};t.after(()=>{fs.promises.stat=old;});
  const count=f.seen.length;await f.a.refresh();assert.equal(f.seen.length,count);
});
test('a pre-attach partial start stays historical; unknown old terminal cannot replace live turn',async t=>{
  const f=await fixture(t);await f.a.stop();
  const start=JSON.stringify(event('task_started','old'));
  fs.appendFileSync(f.file,start.slice(0,30));await f.a.start(s=>f.seen.push(s));
  fs.appendFileSync(f.file,start.slice(30)+'\n');let s=await f.a.refresh();assert.equal(s.phase,'unknown');assert.equal(s.health,'stale');
  await f.append(event('task_started','new'));s=await f.append(event('task_complete','unseen-old'));
  assert.equal(s.turnId,'new');assert.equal(s.phase,'running');
});
test('configuration persistence normalizes only local links and rejects remote credentials',()=>{
  const store=require('../electron/config-store');const base=store.migrateConfig({}).config;
  const patch=agent=>store.applyPatch(base,{characterId:'miyo',baseRevision:0,patch:{agent}});
  const next=patch({codex:{threadId:'codex://threads/'+SID,codexHome:'',threadAccess:'SECRET'},customSource:{keep:1}});
  assert.equal(next.global.agent.codex.threadId,SID);assert.equal(JSON.stringify(next).includes('SECRET'),false);assert.equal(next.global.agent.customSource.keep,1);
  assert.throws(()=>patch({codex:{threadId:'codex://threads/'+SID+'?hostId=remote&threadAccess=SECRET'}}));
});
test('oversized partial line never advances the persisted complete-line cursor',async t=>{
  const f=await fixture(t);const summary=path.join(f.events,fs.readdirSync(f.events)[0]);
  const before=JSON.parse(fs.readFileSync(summary)).offset;
  fs.appendFileSync(f.file,'x'.repeat(MAX_LINE_BYTES+1));await f.a.refresh();
  assert.equal(JSON.parse(fs.readFileSync(summary)).offset,before);
  fs.appendFileSync(f.file,'\n');await f.a.refresh();assert.equal(JSON.parse(fs.readFileSync(summary)).offset,fs.statSync(f.file).size);
});
test('batched live completions are emitted only after durable dedupe, rollback cancels batch',async t=>{
  const f=await fixture(t);await f.append(event('task_started','a'),event('task_complete','a'),event('task_started','b'),event('task_complete','b'));
  assert.deepEqual(f.seen.filter(s=>s.completionKey).map(s=>s.completionKey),[SID+':a',SID+':b']);
  await f.append(event('task_started','c'),event('task_complete','c'),event('thread_rolled_back',undefined,{num_turns:1}));
  assert.equal(f.seen.filter(s=>s.completionKey).length,2);
});
test('ordinal ordering ignores old events regardless of timestamp and inactivity stays ready',async t=>{
  const f=await fixture(t);
  await f.append({...event('task_started','a'),ordinal:20});
  let s=await f.append({...event('task_complete','a'),ordinal:19});assert.equal(s.phase,'running');
  const now=Date.now;Date.now=()=>now()+864000000;try{s=await f.a.refresh();assert.equal(s.health,'ready');assert.equal(s.phase,'running');}finally{Date.now=now;}
});
test('reverted rollout selection follows filename timestamp/rollout ID, silently rebuilds and detects new branches',async t=>{
  const f=await fixture(t,[meta(),event('task_started','old'),event('task_complete','old')]);
  const branch=path.join(path.dirname(f.file),'rollout-2026-01-01T01-00-00-'+SID+'_22222222-2222-3333-4444-555555555555.jsonl');
  fs.writeFileSync(branch,lines([meta(),event('task_started','old'),event('task_complete','old'),event('task_started','current')]));
  fs.utimesSync(f.file,new Date('2030-01-01'),new Date('2030-01-01'));
  let s=await f.a.refresh();assert.equal(s.turnId,'current');assert.equal(s.phase,'unknown');assert.equal(s.health,'stale');assert.equal(s.completionKey,null);
  fs.appendFileSync(branch,lines([event('task_complete','current'),event('task_started','fresh')]));s=await f.a.refresh();assert.equal(s.phase,'running');assert.equal(s.turnId,'fresh');
  const newer=path.join(path.dirname(branch),'rollout-2026-01-01T01-00-00-'+SID+'_33333333-2222-3333-4444-555555555555.jsonl');
  fs.writeFileSync(newer,lines([meta(),event('task_started','reverted'),event('task_complete','reverted')]));s=await f.a.refresh();assert.equal(s.turnId,'reverted');assert.equal(s.completionKey,null);
  const unrelated=path.join(path.dirname(branch),'rollout-2099-01-01T01-00-00-22222222-2222-3333-4444-555555555555_'+SID+'.jsonl');
  fs.writeFileSync(unrelated,'SECRET unrelated body');s=await f.a.refresh();assert.equal(s.turnId,'reverted');
});
test('invalid calendar filenames are ignored; same-second legacy ID participates in tie ordering',async t=>{
  const f=await fixture(t,[meta(),event('task_started','legacy')]);
  const name=(stamp,id)=>path.join(path.dirname(f.file),'rollout-'+stamp+'-'+SID+'_'+id+'.jsonl');
  fs.writeFileSync(name('9999-99-99T99-99-99','33333333-2222-3333-4444-555555555555'),lines([meta(),event('task_started','invalid')]));
  fs.writeFileSync(name('2026-01-01T00-00-00','00000000-2222-3333-4444-555555555555'),lines([meta(),event('task_started','lesser')]));
  let s=await f.a.refresh();assert.equal(s.turnId,'legacy');
  fs.writeFileSync(name('2026-01-01T00-00-00','33333333-2222-3333-4444-555555555555'),lines([meta(),event('task_started','greater')]));
  s=await f.a.refresh();assert.equal(s.turnId,'greater');
});
test('newer compressed selected branch is explicit unsupported; plain sibling takes precedence',async t=>{
  const f=await fixture(t,[meta(),event('task_started','old')]);
  const logical=path.join(path.dirname(f.file),'rollout-2026-01-02T00-00-00-'+SID+'_33333333-2222-3333-4444-555555555555.jsonl');
  fs.writeFileSync(logical+'.zst','SYNTHETIC compressed bytes');
  let s=await f.a.refresh();assert.equal(s.reason,'unsupported_compression');assert.equal(s.health,'error');assert.equal(s.phase,'unknown');
  fs.writeFileSync(logical,lines([meta(),event('task_started','plain')]));
  s=await f.a.refresh();assert.equal(s.turnId,'plain');assert.equal(s.phase,'unknown');assert.equal(s.reason,'previous_turn_unconfirmed');
});
