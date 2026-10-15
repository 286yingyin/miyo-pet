'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const project=path.resolve(__dirname,'..');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=','base64');
test('real Electron A to B to A, restart, stale saves, invalid switch and silent missing sprites',{timeout:60000},async t=>{
 const {_electron}=require(process.env.MIYO_PLAYWRIGHT_MODULE||'playwright-core'); const dir=await fs.mkdtemp(path.join(os.tmpdir(),'miyo-roles-'));
 for(const id of ['a','b']) {const root=path.join(dir,'packs',id);await fs.mkdir(path.join(root,'v2'),{recursive:true});await fs.writeFile(path.join(root,'v2','08.png'),pixel);await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id,label:id,defaults:{scripts:{v2:{idle:[{def:1,voice:'',lines:[{text:id.toUpperCase(),spr:'99',sec:30}]}]}}}}));}
 const stage=path.join(dir,'zip-fixture');await fs.mkdir(stage);await fs.writeFile(path.join(stage,'00.png'),pixel);require('node:child_process').execFileSync('tar',['-a','-cf',path.join(dir,'packs','zipped.zip'),'-C',stage,'.']);
 const env={...process.env,MIYO_USERDATA:path.join(dir,'user'),MIYO_CONFIG:path.join(dir,'user','config.json'),PORTABLE_EXECUTABLE_DIR:dir,CODEBUDDY_CONFIG_DIR:path.join(dir,'empty-workbuddy')};delete env.ELECTRON_RUN_AS_NODE;
 async function launch(){ const app=await _electron.launch({executablePath:require('../electron/node_modules/electron'),args:[path.join(project,'electron/main.js')],env}); const page=await app.firstWindow();await page.waitForFunction(()=>window.petHost && window.MiyoPet);return {app,page}; }
 let {app,page}=await launch();t.after(async()=>{if(app)await app.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});});
 const request=(channel,arg)=>app.evaluate(({ipcMain},[ch,arg])=>ipcMain._invokeHandlers.get(ch)({},arg),[channel,arg]);
 const listed=await page.evaluate(()=>window.petHost.packsList());assert.ok(listed.v2.some(p=>p.id==='legacy:zipped'));
 let c=await page.evaluate(()=>window.petHost.getConfig()); assert.equal(c.schemaVersion,2);
 let r=await request('character-switch',{characterId:c.characterId,baseRevision:c.revision,targetId:'a',patch:{}});assert.equal(r.ok,true);c=r.config;
 await page.evaluate(()=>window.MiyoPet.setState({error:false,ok:true,processing:0,pending:0,approval:0}));
 await page.waitForFunction(()=>document.getElementById('bubbleText').textContent==='A');
 r=await page.evaluate(c=>window.petHost.saveConfig({characterId:c.characterId,baseRevision:c.revision,patch:{volume:0.25}}),c);assert.equal(r.ok,true);c=r.config;
 const stale={characterId:'a',baseRevision:c.revision,patch:{volume:0.9}};
 r=await request('character-switch',{characterId:c.characterId,baseRevision:c.revision,targetId:'b',patch:{}});assert.equal(r.ok,true);c=r.config;
 await page.waitForFunction(()=>document.getElementById('bubbleText').textContent==='B');
 assert.equal((await page.evaluate(q=>window.petHost.saveConfig(q),stale)).ok,false);
 assert.equal((await request('character-switch',{characterId:'b',baseRevision:c.revision,targetId:'missing',patch:{}})).ok,false);
 await page.waitForFunction(()=>document.getElementById('layerBase').src.includes('/b/'));
 const image=await page.locator('#layerBase').getAttribute('src');assert.match(image,/b\/v2\/08\.png/);assert.doesNotMatch(image,/packs\/miyo\/|CH0317/);
 r=await request('character-switch',{characterId:'b',baseRevision:c.revision,targetId:'a',patch:{}});assert.equal(r.config.volume,0.25);
 assert.equal(JSON.parse(await fs.readFile(env.MIYO_CONFIG,'utf8')).activeCharacterId,'a');
 // A stale host broadcast cannot reinstall B after A committed.
 const aConfig=r.config;
 await app.evaluate(({BrowserWindow},old)=>BrowserWindow.getAllWindows()[0].webContents.send('miyo-config',old),c);
 await page.waitForFunction(()=>document.getElementById('layerBase').src.includes('/a/'));
 // Exercise the actual settings controls and their asynchronous switch queue.
 const settingsPromise=app.waitForEvent('window');await page.evaluate(()=>window.petHost.openSettings());const settings=await settingsPromise;
 const pageErrors=[];settings.on('pageerror',e=>pageErrors.push(e.message));
 await settings.waitForFunction(()=>document.querySelector('#serSel option[value="b"]'));
 await settings.locator('#volume').fill('0.4');await settings.locator('#volume').dispatchEvent('input');
 await settings.evaluate(()=>{const sel=document.getElementById('serSel');for(const id of ['b','a','b','a']){sel.value=id;sel.dispatchEvent(new Event('change'));}});
 await settings.waitForFunction(()=>document.getElementById('status').textContent.includes('已切换'));
 c=await page.evaluate(()=>window.petHost.getConfig());assert.equal(c.characterId,'a');assert.equal(c.volume,0.4);
 assert.deepEqual(pageErrors,[]);
 const disk=JSON.parse(await fs.readFile(env.MIYO_CONFIG,'utf8'));assert.equal(disk.activeCharacterId,'a');assert.equal(disk.characters.b.scripts,undefined);assert.equal(disk.characters.a.scripts,undefined,'pack defaults must remain read-only rather than copied into user overrides');
 // A settings window made stale by another writer reloads the returned projection.
 r=await page.evaluate(c=>window.petHost.saveConfig({characterId:c.characterId,baseRevision:c.revision,patch:{alwaysOnTop:false}}),c);assert.equal(r.ok,true);
 await settings.locator('#save').click();await settings.waitForFunction(()=>document.getElementById('status').textContent.includes('保存失败'));
 await settings.locator('#save').click();await settings.waitForFunction(()=>document.getElementById('status').textContent.includes('已保存并生效'));
 c=await page.evaluate(()=>window.petHost.getConfig());
 const presetDir=path.join(dir,'packs','settings');await fs.mkdir(presetDir,{recursive:true});await fs.writeFile(path.join(presetDir,'legacyB.json'),JSON.stringify({series:'b',volume:0.7}));
 r=await request('presets-apply',{name:'legacyB',characterId:c.characterId,baseRevision:c.revision,patch:{}});assert.equal(r.ok,true);assert.equal(r.config.characterId,'b');assert.equal(r.config.volume,0.7);
 r=await request('character-switch',{characterId:'b',baseRevision:r.config.revision,targetId:'a',patch:{}});assert.equal(r.config.volume,0.4);
 await app.close();({app,page}=await launch());c=await page.evaluate(()=>window.petHost.getConfig());assert.equal(c.characterId,'a');assert.equal(c.volume,0.4);
 await app.close();app=null;
});
