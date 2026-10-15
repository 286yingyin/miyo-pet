'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const project=path.resolve(__dirname,'..');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=','base64');
// Distinct, valid PCM tones; no game audio is read or distributed.
function tone(frequency) {
 const sampleRate=8000, samples=sampleRate*30, bytes=Buffer.alloc(44+samples*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
 bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
 bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(2000*Math.sin(2*Math.PI*frequency*i/sampleRate)),44+i*2);
 return bytes;
}
async function observeRealAudio(page) {
 await page.evaluate(()=>{
  const NativeAudio=window.Audio;
  window.roleAudio=[];
  window.Audio=function(src){
   const audio=new NativeAudio(src);
   audio.muted=true; // Decode and play normally without test sound on the user's desktop.
   const record={audio,src:audio.src,ready:false,playing:false,nativeResolved:false,nativeRejected:false,delivered:false};
   const hold=audio.src.endsWith('/a/audio/a.wav')&&!window.roleAudio.some(r=>r.src.endsWith('/a/audio/a.wav'));
   const gate=hold?new Promise(resolve=>{record.release=resolve;}):Promise.resolve();
   const play=audio.play.bind(audio);
   audio.play=function(){
    // Only delay delivery of the actual native play Promise. Media loading, decoding,
    // playback and pause remain the real Chromium Audio object's operations.
    return play().then(()=>{record.nativeResolved=true;return gate;},error=>{
     record.nativeRejected=true;return gate.then(()=>{throw error;});
    }).finally(()=>{record.delivered=true;});
   };
   audio.addEventListener('loadeddata',()=>{record.ready=true;});
   audio.addEventListener('playing',()=>{record.playing=true;});
   window.roleAudio.push(record);
   return audio;
  };
 });
}
async function waitForRoleAudio(page,id) {
 await page.waitForFunction(id=>{
  const record=window.roleAudio.at(-1);
  return record&&record.src.endsWith('/'+id+'/audio/'+id+'.wav')&&record.ready&&record.playing&&record.nativeResolved&&!record.audio.paused&&record.audio.currentTime>0;
 },id);
}

test('real Electron role switching isolates images, scripts, real audio, and config across restart',{timeout:60000},async t=>{
 const {_electron}=require(process.env.MIYO_PLAYWRIGHT_MODULE||'playwright-core'); const dir=await fs.mkdtemp(path.join(os.tmpdir(),'miyo-roles-'));
 for(const id of ['a','b']) {const root=path.join(dir,'packs',id);await fs.mkdir(path.join(root,'v2'),{recursive:true});await fs.writeFile(path.join(root,'v2','08.png'),pixel);await fs.mkdir(path.join(root,'audio'));await fs.writeFile(path.join(root,'audio',id+'.wav'),tone(id==='a'?220:440));await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id,label:id,defaults:{scripts:{v2:{idle:[{def:1,voice:'audio/'+id+'.wav',lines:[{text:id.toUpperCase(),spr:'99',sec:30}]}]}}}}));}
 const stage=path.join(dir,'zip-fixture');await fs.mkdir(stage);await fs.writeFile(path.join(stage,'00.png'),pixel);require('node:child_process').execFileSync('tar',['-a','-cf',path.join(dir,'packs','zipped.zip'),'-C',stage,'.']);
 const env={...process.env,MIYO_USERDATA:path.join(dir,'user'),MIYO_CONFIG:path.join(dir,'user','config.json'),PORTABLE_EXECUTABLE_DIR:dir,CODEBUDDY_CONFIG_DIR:path.join(dir,'empty-workbuddy')};delete env.ELECTRON_RUN_AS_NODE;
 async function launch(){ const app=await _electron.launch({executablePath:require('../electron/node_modules/electron'),args:[path.join(project,'electron/main.js')],env}); const page=await app.firstWindow();await page.waitForFunction(()=>window.petHost && window.MiyoPet);return {app,page}; }
 let {app,page}=await launch();t.after(async()=>{if(app)await app.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});});
 const request=(channel,arg)=>app.evaluate(({ipcMain},[ch,arg])=>ipcMain._invokeHandlers.get(ch)({},arg),[channel,arg]);
 await observeRealAudio(page);
 const listed=await page.evaluate(()=>window.petHost.packsList());assert.ok(listed.v2.some(p=>p.id==='legacy:zipped'));
 let c=await page.evaluate(()=>window.petHost.getConfig()); assert.equal(c.schemaVersion,2);
 let r=await request('character-switch',{characterId:c.characterId,baseRevision:c.revision,targetId:'a',patch:{}});assert.equal(r.ok,true);c=r.config;
 await page.evaluate(()=>window.MiyoPet.setState({rev:Number.MAX_SAFE_INTEGER,error:false,ok:true,processing:0,pending:0,approval:0}));
 await page.waitForFunction(()=>document.getElementById('bubbleText').textContent==='A');
 await waitForRoleAudio(page,'a');
 assert.equal(c.scripts.v2.idle[0].voice,path.join(dir,'packs','a','audio','a.wav'));
 r=await page.evaluate(c=>window.petHost.saveConfig({characterId:c.characterId,baseRevision:c.revision,patch:{volume:0.25}}),c);assert.equal(r.ok,true);c=r.config;
 const stale={characterId:'a',baseRevision:c.revision,patch:{volume:0.9}};
 r=await request('character-switch',{characterId:c.characterId,baseRevision:c.revision,targetId:'b',patch:{}});assert.equal(r.ok,true);c=r.config;
 await page.waitForFunction(()=>document.getElementById('bubbleText').textContent==='B');
 await waitForRoleAudio(page,'b');
 assert.equal(c.scripts.v2.idle[0].voice,path.join(dir,'packs','b','audio','b.wav'));
 const stoppedA=await page.evaluate(()=>{const old=window.roleAudio.find(r=>r.src.endsWith('/a/audio/a.wav'));return {paused:old.audio.paused,time:old.audio.currentTime,delivered:old.delivered};});
 assert.equal(stoppedA.paused,true);assert.equal(stoppedA.time,0);assert.equal(stoppedA.delivered,false);
 await page.evaluate(()=>window.roleAudio.find(r=>r.release).release());
 await page.waitForFunction(()=>window.roleAudio.find(r=>r.release).delivered);
 assert.equal(await page.evaluate(()=>window.roleAudio.find(r=>r.release).audio.paused),true);
 await waitForRoleAudio(page,'b'); // Late A completion cannot restart A or stop B.
 assert.equal((await page.evaluate(()=>window.petHost.getConfig())).characterId,'b');
 assert.equal((await page.evaluate(q=>window.petHost.saveConfig(q),stale)).ok,false);
 assert.equal((await request('character-switch',{characterId:'b',baseRevision:c.revision,targetId:'missing',patch:{}})).ok,false);
 await page.waitForFunction(()=>document.getElementById('layerBase').src.includes('/b/'));
 const image=await page.locator('#layerBase').getAttribute('src');assert.match(image,/b\/v2\/08\.png/);assert.doesNotMatch(image,/packs\/miyo\/|CH0317/);
 r=await request('character-switch',{characterId:'b',baseRevision:c.revision,targetId:'a',patch:{}});assert.equal(r.config.volume,0.25);
 assert.equal(JSON.parse(await fs.readFile(env.MIYO_CONFIG,'utf8')).activeCharacterId,'a');
 await waitForRoleAudio(page,'a');
 assert.equal(r.config.scripts.v2.idle[0].voice,path.join(dir,'packs','a','audio','a.wav'));
 assert.equal(await page.evaluate(()=>window.roleAudio.filter(r=>r.src.endsWith('/b/audio/b.wav')).every(r=>r.audio.paused)),true);
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
 await waitForRoleAudio(page,'a');
 assert.equal(await page.evaluate(()=>window.roleAudio.slice(0,-1).every(r=>r.audio.paused)),true);
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
