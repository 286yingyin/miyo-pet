'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo-packs-')); t.after(() => fs.rm(root, { recursive:true, force:true })); return root; }
async function put(root, file, data='image') { await fs.mkdir(path.dirname(path.join(root,file)), { recursive:true }); await fs.writeFile(path.join(root,file), data); }
test('both layouts share stable legacy identity and first root / character-first mode wins', async t => {
  const { discoverPacks } = require('../electron/character-packs'); const root=await fixture(t);
  await put(root,'one/A/v2/03.png'); await put(root,'one/A/manifest.json', '{"label":"甲"}');
  await put(root,'one/v2/A/09.png'); await put(root,'one/v1/A/02.jpg'); await put(root,'two/A/v2/07.png');
  const packs=await discoverPacks([path.join(root,'one'),path.join(root,'two')]);
  assert.equal(packs.length,1); assert.equal(packs[0].id,'legacy:A'); assert.equal(packs[0].label,'甲');
  assert.deepEqual(Object.keys(packs[0].modes.v2.sprites),['03']); assert.deepEqual(Object.keys(packs[0].modes.v1.sprites),['02']); assert.ok(packs[0].warnings.length);
});
test('manifest IDs, defaults, and fallback stay inside current character', async t => {
  const { discoverPacks, resolveSprite }=require('../electron/character-packs'); const root=await fixture(t);
  await put(root,'A/pictures/blue.png'); await put(root,'A/manifest.json',JSON.stringify({schemaVersion:1,id:'a',label:'A',sprites:{v2:{'08':'pictures/blue.png'}},defaults:{scripts:{v2:{idle:[{voice:'voice/a.ogg',lines:[{text:'A',spr:'08'}]}]}}}}));
  const [a]=await discoverPacks([root]); assert.equal(a.id,'a'); assert.equal(a.defaults.scripts.v2.idle[0].lines[0].text,'A');
  assert.equal(resolveSprite(a,'v2','99'),a.modes.v2.sprites['08']); assert.equal(resolveSprite(a,'v1','00'),null);
});
test('bad JSON, escaping paths, and empty packs cannot be selected', async t => {
  const { discoverPacks }=require('../electron/character-packs'); const root=await fixture(t);
  await put(root,'bad/v2/00.png'); await put(root,'bad/manifest.json','{');
  await put(root,'escape/manifest.json',JSON.stringify({schemaVersion:1,id:'escape',sprites:{v2:{'00':'../bad/v2/00.png'}}}));
  await put(root,'empty/manifest.json','{"label":"empty"}');
  assert.deepEqual(await discoverPacks([root]),[]);
});

test('manifest audio is resolved within character root and escaping audio is rejected', async t=>{
 const {discoverPacks}=require('../electron/character-packs');const root=await fixture(t);
 await put(root,'a/v2/00.png');await put(root,'a/voice/a.ogg','synthetic');await put(root,'a/manifest.json',JSON.stringify({id:'a',schemaVersion:1,defaults:{scripts:{v2:{idle:[{voice:'voice/a.ogg'}]}}}}));
 await put(root,'b/v2/00.png');await put(root,'b/manifest.json',JSON.stringify({id:'b',schemaVersion:1,defaults:{scripts:{v2:{idle:[{voice:'../a/voice/a.ogg'}]}}}}));
 const list=await discoverPacks([root]);assert.deepEqual(list.map(p=>p.id),['a']);assert.equal(list[0].defaults.scripts.v2.idle[0].voice,path.join(root,'a/voice/a.ogg'));
});
test('manifest legacy string voice lists resolve inside their own package',async t=>{
 const {discoverPacks}=require('../electron/character-packs');const root=await fixture(t);
 await put(root,'a/v2/00.png');await put(root,'a/manifest.json',JSON.stringify({id:'a',schemaVersion:1,defaults:{voices:{v2:{idle:['voice/a.ogg',{file:'voice/b.ogg',text:'hello'}]}}}}));
 const [a]=await discoverPacks([root]);assert.equal(a.defaults.voices.v2.idle[0],path.join(root,'a/voice/a.ogg'));assert.equal(a.defaults.voices.v2.idle[1].text,'hello');
});
