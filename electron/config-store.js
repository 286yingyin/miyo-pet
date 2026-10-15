'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const GLOBAL = new Set(['agent','alwaysOnTop','scope','dropStale','showApproval','approvalTtlMs','convWindowMs','usage','detect','window']);
const ROLE = new Set(['mapping','scripts','voices','reacts','hourly','idleSprs','restSprs','lines','idleSprMs','idleBlink','idleSway','idleBreathe','stateCycleMs','idleSecs','scriptRestMs','volume','hourlyGraceMs']);
const DISPLAY = new Set(['mode','scale','lowMem','bubble','pillVisible','pillText','pillPos']);
const DERIVED = new Set(['series','packIds','packFiles','packFileUrl','packUrl','packDefaultId','packsRoot','packsRootUrl','voiceDirs','voiceMap','voiceRoot','voiceRootUrl','characterLabel','characterId','configError']);
const META = new Set(['_v','schemaVersion','revision','activeCharacterId','global','characters']);
const clone = v => JSON.parse(JSON.stringify(v));
const object = v => v && typeof v==='object' && !Array.isArray(v);
function error(code) { return Object.assign(new Error(code),{code}); }
function merge(base, patch) {
  const out=clone(base || {});
  for(const [key,value] of Object.entries(patch || {})) {
    if(['__proto__','prototype','constructor'].includes(key)) throw error('CONFIG_INVALID');
    out[key]=object(value)?merge(object(out[key])?out[key]:{},value):clone(value);
  }
  return out;
}
function validate(config) {
  if(config.schemaVersion!==2) throw error('CONFIG_UNSUPPORTED_SCHEMA');
  if(typeof config.activeCharacterId!=='string' || !config.activeCharacterId || !object(config.global) || !object(config.characters) || !Number.isSafeInteger(config.revision) || config.revision<0) throw error('CONFIG_INVALID');
  merge({},config); return config;
}
function split(flat) {
  const global={}, character={display:{}}, unknown={};
  for(const [key,value] of Object.entries(flat)) {
    if(GLOBAL.has(key)) global[key]=clone(value);
    else if(ROLE.has(key)) character[key]=clone(value);
    else if(DISPLAY.has(key)) character.display[key]=clone(value);
    else if(key==='reminders') {
      global.reminders=[]; character.reminders={};
      for(const r of Array.isArray(value)?value:[]) {
        const schedule=clone(r); delete schedule.scripts; delete schedule.ackScripts;
        global.reminders.push(schedule); character.reminders[r.id]={scripts:clone(r.scripts||[]),ackScripts:clone(r.ackScripts||[])};
      }
    } else if(!DERIVED.has(key) && !META.has(key)) unknown[key]=clone(value);
  }
  return {global,character,unknown};
}
function migrateConfig(raw, selectedLegacyId) {
  if(!object(raw)) throw error('CONFIG_INVALID');
  if(raw.schemaVersion===2) return {config:validate(clone(raw)),changed:false};
  if(raw.schemaVersion!=null && raw.schemaVersion!==1) throw error('CONFIG_UNSUPPORTED_SCHEMA');
  const id=raw.series?(selectedLegacyId || (raw.series==='miyo'?'miyo':'legacy:'+encodeURIComponent(raw.series))):'miyo';
  const parts=split(raw);
  const config={...parts.unknown,_v:raw._v??1,schemaVersion:2,revision:0,activeCharacterId:id,global:parts.global,characters:{[id]:parts.character}};
  return {config:validate(config),changed:true};
}
const writes=new Map();
function writeConfig(file, config) {
  // Snapshot before enqueue: subsequent caller mutations must not affect this write.
  let bytes; try { validate(config); bytes=JSON.stringify(config,null,2)+'\n'; } catch(e){return Promise.reject(e);}
  const key=path.resolve(file), previous=writes.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(key),{recursive:true}); const temp=key+'.tmp-'+randomUUID();
    try { await fs.writeFile(temp,bytes,{flag:'wx'}); await fs.rename(temp,key); }
    finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
  });
  writes.set(key,task); task.finally(()=>{if(writes.get(key)===task)writes.delete(key);}).catch(()=>{}); return task;
}
async function readConfig(file, {resolveLegacyId=()=>undefined}={}) {
  let bytes;
  try { bytes=await fs.readFile(file); } catch(e) { if(e.code!=='ENOENT')throw e; const c=migrateConfig({}).config; await writeConfig(file,c); return c; }
  // Exclusive first-read backup is byte-for-byte and never replaced on later launches.
  try { await fs.writeFile(file+'.bak',bytes,{flag:'wx'}); } catch(e){if(e.code!=='EEXIST')throw e;}
  let raw; try {raw=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw error('CONFIG_INVALID_JSON');}
  const {config,changed}=migrateConfig(raw,raw && raw.schemaVersion!==2?await resolveLegacyId(raw.series):undefined);
  if(changed)await writeConfig(file,config); return config;
}
function getCharacterConfig(config,id,defaults={}) { return merge(defaults,config.characters[id]||{}); }
function projectConfig(config,id=config.activeCharacterId,defaults={}) {
  const role=getCharacterConfig(config,id,defaults), display=role.display||{}, reminders=role.reminders||{};
  const extra=Object.fromEntries(Object.entries(config).filter(([key])=>!META.has(key)));
  const out={...clone(extra),...clone(config.global),...role,...display,schemaVersion:2,activeCharacterId:id,characterId:id,series:id,revision:config.revision};
  delete out.display;
  out.reminders=(config.global.reminders||[]).map(r=>({...clone(r),...clone(reminders[r.id]||{scripts:[],ackScripts:[]})}));
  return out;
}
function applyPatch(config,request) {
  if(!request || request.characterId!==config.activeCharacterId || request.baseRevision!==config.revision) throw error('CONFIG_STALE');
  if(!object(request.patch))throw error('CONFIG_INVALID');
  const parts=split(request.patch), next=clone(config), id=request.characterId;
  next.global={...next.global,...parts.global};
  const prior=next.characters[id]||{};
  next.characters[id]={...prior,...parts.character,display:{...prior.display,...parts.character.display}};
  for (const [key, value] of Object.entries(parts.unknown)) {
    if (Object.hasOwn(prior, key)) next.characters[id][key] = value;
    else if (Object.hasOwn(next.global, key)) next.global[key] = value;
    else next[key] = value;
  }
  next.revision++; return validate(next);
}
function switchCharacter(config,id) { const next=clone(config); next.activeCharacterId=id; if(!next.characters[id])next.characters[id]={};next.revision++;return validate(next); }
function omitDefaults(value, defaults, key) {
  if (JSON.stringify(value) === JSON.stringify(defaults)) return undefined;
  const emptyMode = /^(idle(_5|_15|_30)?|processing|pending|approval|done|error|click[1-8]?|double|long|drag|drop|hover)$/.test(key || '');
  if (Array.isArray(value)) return !value.length && defaults === undefined && emptyMode ? undefined : clone(value);
  if (!object(value)) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const remaining = omitDefaults(val, defaults && defaults[key], key);
    if (remaining !== undefined) out[key] = remaining;
  }
  if (!Object.keys(value).length && defaults === undefined) return {};
  return Object.keys(out).length ? out : undefined;
}
function applyPreset(config, preset, request) {
  const next=applyPatch(config,request), id=preset.activeCharacterId;
  next.global=merge(next.global,preset.global);
  next.characters[id]=clone(preset.characters[id] || {});
  next.activeCharacterId=id; return validate(next);
}
module.exports={omitDefaults,applyPreset,migrateConfig,readConfig,writeConfig,getCharacterConfig,projectConfig,applyPatch,switchCharacter,merge,split};
