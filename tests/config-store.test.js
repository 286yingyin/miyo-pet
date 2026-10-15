'use strict';
const { test }=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs/promises'); const path=require('node:path'); const os=require('node:os');
async function fixture(t) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'miyo-config-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'config.json'); }
test('legacy non-Miyo ownership, reminder split, unknown fields and schema2 idempotence',()=>{
 const {migrateConfig,getCharacterConfig}=require('../electron/config-store');
 const raw={series:'甲',scripts:{v2:{idle:[{voice:'A.ogg',lines:[{text:'A'}]}]}},scale:2,pillPos:{dx:8},agent:{active:'codex'},detect:{enabled:false},mystery:{keep:1},reminders:[{id:'r',hh:9,mm:0,scripts:[{voice:'A.ogg'}],extra:7}]};
 const {config,changed}=migrateConfig(raw,'a'); assert.equal(changed,true); assert.equal(config.activeCharacterId,'a'); assert.equal(config.characters.miyo,undefined);
 assert.equal(config.characters.a.display.scale,2); assert.deepEqual(config.global.agent,{active:'codex'}); assert.deepEqual(config.mystery,{keep:1}); assert.equal(config.global.reminders[0].scripts,undefined); assert.equal(config.global.reminders[0].extra,7);
 assert.equal(config.characters.a.reminders.r.scripts[0].voice,'A.ogg'); assert.deepEqual(migrateConfig(config),{config,changed:false});
 assert.deepEqual(getCharacterConfig(config,'b',{}),{}); const merged=getCharacterConfig(config,'a',{display:{lowMem:true}}); assert.equal(merged.display.scale,2); assert.equal(merged.display.lowMem,true); assert.equal(config.characters.a.display.lowMem,undefined);
});
test('raw backup precedes parse, migration persists, broken and incompatible config remain untouched',async t=>{
 const {readConfig}=require('../electron/config-store'); const file=await fixture(t); const raw=' { "series": "A", "volume": 0.3 }\n'; await fs.writeFile(file,raw);
 const c=await readConfig(file,{resolveLegacyId:n=>'stable:'+n}); assert.equal(c.activeCharacterId,'stable:A'); assert.equal(await fs.readFile(file+'.bak','utf8'),raw); assert.equal(JSON.parse(await fs.readFile(file,'utf8')).schemaVersion,2);
 await readConfig(file,{}); assert.equal(await fs.readFile(file+'.bak','utf8'),raw);
 const broken=await fixture(t); await fs.writeFile(broken,'{broken'); await assert.rejects(readConfig(broken,{}),{code:'CONFIG_INVALID_JSON'}); assert.equal(await fs.readFile(broken+'.bak','utf8'),'{broken'); assert.equal(await fs.readFile(broken,'utf8'),'{broken');
 const future=await fixture(t); await fs.writeFile(future,'{"schemaVersion":3}'); await assert.rejects(readConfig(future,{}),{code:'CONFIG_UNSUPPORTED_SCHEMA'}); assert.equal(await fs.readFile(future,'utf8'),'{"schemaVersion":3}');
});
test('atomic write failure preserves original and serial writes finish in requested order',async t=>{
 const {writeConfig,migrateConfig}=require('../electron/config-store'); const file=await fixture(t); const a=migrateConfig({series:'A'},'a').config; await writeConfig(file,a);
 const rename=fs.rename; fs.rename=async()=>{throw Object.assign(new Error('synthetic rename failure'),{code:'EACCES'});};
 try { await assert.rejects(writeConfig(file,{...a,revision:9}),{code:'EACCES'}); } finally {fs.rename=rename;}
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).revision,0);
 const before=await fs.readFile(file,'utf8'); const bad={...a}; bad.circular=bad; await assert.rejects(writeConfig(file,bad)); assert.equal(await fs.readFile(file,'utf8'),before);
 await Promise.all([writeConfig(file,{...a,revision:1}),writeConfig(file,{...a,revision:2})]); assert.equal(JSON.parse(await fs.readFile(file,'utf8')).revision,2);
});
test('identity and revision bind saves; switching preserves independent A/B and rejects stale callback',()=>{
 const {migrateConfig,applyPatch,switchCharacter,projectConfig}=require('../electron/config-store'); let c=migrateConfig({series:'A',scripts:{v2:{idle:[{voice:'A.ogg'}]}}},'a').config;
 c=applyPatch(c,{characterId:'a',baseRevision:0,patch:{volume:0.2}}); c=switchCharacter(c,'b'); c=applyPatch(c,{characterId:'b',baseRevision:c.revision,patch:{scripts:{v2:{idle:[{voice:'B.ogg'}]}}}});
 assert.throws(()=>applyPatch(c,{characterId:'a',baseRevision:0,patch:{volume:1}}),{code:'CONFIG_STALE'}); c=switchCharacter(c,'a');
 assert.equal(projectConfig(c,'a',{}).scripts.v2.idle[0].voice,'A.ogg'); assert.equal(projectConfig(c,'a',{}).volume,0.2); assert.equal(c.characters.b.scripts.v2.idle[0].voice,'B.ogg');
});
test('legacy preset applies to declared character without replacing another character',()=>{
 const {migrateConfig,applyPreset}=require('../electron/config-store'); const a=migrateConfig({series:'A',volume:0.2},'a').config;
 const preset=migrateConfig({series:'B',volume:0.8,scripts:{v2:{idle:[{voice:'B.ogg'}]}}},'b').config;
 const next=applyPreset(a,preset,{characterId:'a',baseRevision:0,patch:{}});
 assert.equal(next.activeCharacterId,'b');assert.equal(next.characters.a.volume,0.2);assert.equal(next.characters.b.volume,0.8);
 assert.throws(()=>applyPreset(next,preset,{characterId:'a',baseRevision:0,patch:{}}),{code:'CONFIG_STALE'});
});
test('removing scripts persists removal',()=>{
 const {migrateConfig,applyPatch}=require('../electron/config-store');
 const c=migrateConfig({scripts:{v2:{idle:[{voice:'old'}]}}}).config;
 const next=applyPatch(c,{characterId:'miyo',baseRevision:0,patch:{scripts:{v2:{}}}});
 assert.deepEqual(next.characters.miyo.scripts,{v2:{}});
});
test('sparse default removal preserves unknown empty extension fields',()=>{
 const {omitDefaults}=require('../electron/config-store');
 assert.deepEqual(omitDefaults({plugin:{},pluginList:[]},{}),{plugin:{},pluginList:[]});
 assert.equal(omitDefaults({v2:{idle:[]}},{v2:{}}),undefined);
});
