'use strict';
const { test }=require('node:test');const assert=require('node:assert/strict');
const {browserTools,serveRepository}=require('./helpers/browser-runner');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=','base64');
test('late A image cannot replace B; a character without speech stays silent',async()=>{
 const {chromium,executablePath}=browserTools();const server=await serveRepository();const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.petHost={onState(){},onConfig(cb){window.applyHostConfig=cb;}};const Native=window.Audio;window.audioFiles=[];window.Audio=function(src){window.audioFiles.push(src);return new Native(src);};});
  let releaseA;const gate=new Promise(resolve=>{releaseA=resolve;});
  await page.route('**/fixture/a.png',async route=>{await gate;await route.fulfill({contentType:'image/png',body:pixel});});
  await page.route('**/fixture/b.png',route=>route.fulfill({contentType:'image/png',body:pixel}));
  await page.goto(server.url+'/prototype/v2/index.html');await page.waitForFunction(()=>window.applyHostConfig);
  function config(id,revision){return {characterId:id,series:id,revision,mode:'v2',packIds:{v2:['08'],v1:[]},packFileUrl:{v2:{'08':server.url+'/fixture/'+id+'.png'},v1:{}},packDefaultId:{v2:'08'},scripts:{v2:{}},mapping:{v2:{idle:['99']}},lines:{v2:{}},voices:{v2:{}},reacts:{v2:{}}};}
  await page.evaluate(c=>window.applyHostConfig(c),config('a',1));
  await page.evaluate(c=>window.applyHostConfig(c),config('b',2));
  await page.waitForFunction(()=>document.getElementById('layerBase').src.endsWith('/fixture/b.png'));
  releaseA();
  await page.evaluate(()=>window.MiyoPet.react('click',1));
  await page.evaluate(()=>window.MiyoPet.chime({hour:9,sprs:['99']}));
  assert.equal(await page.locator('#bubbleText').textContent(),'');assert.deepEqual(await page.evaluate(()=>window.audioFiles),[]);
  await page.evaluate(c=>window.applyHostConfig(c),config('a',1));
  assert.ok((await page.locator('#layerBase').getAttribute('src')).endsWith('/fixture/b.png'));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
test('web-only gallery still reads a real File System Access pack',async()=>{
 const {chromium,executablePath}=browserTools();const server=await serveRepository();const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/prototype/v2/settings.html',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replaceAll('__WEB_ONLY__','true')});});
  await page.goto(server.url+'/prototype/v2/settings.html');
  await page.evaluate(async b64=>{const root=await navigator.storage.getDirectory();const packs=await root.getDirectoryHandle('packs',{create:true});const mode=await packs.getDirectoryHandle('v2',{create:true});const role=await mode.getDirectoryHandle('fixture',{create:true});const file=await role.getFileHandle('08.png',{create:true});const writer=await file.createWritable();await writer.write(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));await writer.close();window.showDirectoryPicker=async()=>packs;},pixel.toString('base64'));
  await page.locator('#galConnect').click();await page.waitForFunction(()=>document.querySelector('#gSerSel option[value="fixture"]'));
  await page.selectOption('#gSerSel','fixture');await page.waitForFunction(()=>{const im=document.querySelector('#gallery img');return im&&im.complete&&im.naturalWidth>0;});
  assert.equal(await page.locator('#gallery img').count(),1);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
