'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {snapshot,toPetState}=require('../scripts/agents/schema');

test('real Electron stops Agent IO/pushes, resumes, switches sources, and handles normalized rendering',{timeout:60000},async t=>{
  const {_electron}=require(process.env.MIYO_PLAYWRIGHT_MODULE||'playwright-core');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'miyo-agent-'));
  const root=path.join(dir,'workbuddy'),sid='aaaaaaaa-1111-2222-3333-444444444444';
  for(const sub of ['tasks/'+sid,'sessions','audit-log/spool'])await fs.mkdir(path.join(root,sub),{recursive:true});
  const task=path.join(root,'tasks',sid,'1.json');
  async function writeTask(status){await fs.writeFile(task,JSON.stringify({id:'1',subject:'Synthetic task',status,createdAt:Date.now(),updatedAt:Date.now()}));}
  await writeTask('in_progress');
  await fs.writeFile(path.join(root,'sessions','1234.json'),JSON.stringify({pid:1234,sessionId:sid,lastHeartbeat:Date.now(),cwd:dir,kind:'interactive'}));
  const env={...process.env,MIYO_USERDATA:path.join(dir,'user'),MIYO_CONFIG:path.join(dir,'config.json'),CODEBUDDY_CONFIG_DIR:root,WORKBUDDY_TASKS_DIR:path.join(root,'tasks')};delete env.ELECTRON_RUN_AS_NODE;
  const bootstrap=path.join(dir,'bootstrap.cjs');
  await fs.writeFile(bootstrap, `
    const fs=require('node:fs');globalThis.agentReads=0;
    const root=${JSON.stringify(root)};
    for(const name of ['readdirSync','readFileSync','statSync','existsSync']) {
      const old=fs[name];fs[name]=function(p,...args){if(String(p).startsWith(root))globalThis.agentReads++;return old.call(this,p,...args);};
    }
    require(${JSON.stringify(path.resolve(__dirname,'../electron/main.js'))});
  `);
  let app=await _electron.launch({executablePath:require('../electron/node_modules/electron'),args:[bootstrap],env});
  t.after(async()=>{if(app)await app.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.MiyoPet&&window.MiyoPet.getState().health==='ready');
  assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'processing');

  await page.evaluate(()=>{window.agentPushes=[];window.petHost.onState(s=>window.agentPushes.push(s));});
  async function save(patch){return page.evaluate(async patch=>{const c=await window.petHost.getConfig();return window.petHost.saveConfig({characterId:c.characterId,baseRevision:c.revision,patch});},patch);}
  assert.equal((await save({agent:{activeProvider:'workbuddy',enabled:{workbuddy:false}}})).ok,true);
  await page.waitForFunction(()=>window.MiyoPet.getState().phase==='unknown');
  const disabled=await page.evaluate(()=>window.petHost.getState());
  const pushes=await page.evaluate(()=>window.agentPushes.length);
  await app.evaluate(()=>{globalThis.agentReads=0;});
  await writeTask('completed');
  await page.evaluate(()=>window.petHost.refreshState());
  await new Promise(resolve=>setTimeout(resolve,2800));
  assert.equal(await app.evaluate(()=>globalThis.agentReads),0);
  assert.equal(await page.evaluate(()=>window.agentPushes.length),pushes);
  assert.equal((await page.evaluate(()=>window.petHost.getState())).rev,disabled.rev);
  assert.equal(await page.evaluate(()=>window.MiyoPet.getState().done),false);
  await page.reload();await page.waitForFunction(()=>window.MiyoPet&&window.MiyoPet.getState().phase==='unknown');
  assert.equal(await app.evaluate(()=>globalThis.agentReads),0);
  await writeTask('in_progress');
  await save({agent:{activeProvider:'workbuddy',enabled:{workbuddy:true}}});
  await page.waitForFunction(()=>window.MiyoPet.getMode()==='processing');
  assert.ok(await app.evaluate(()=>globalThis.agentReads)>0);
  await writeTask('completed');
  await page.evaluate(()=>window.petHost.refreshState());
  await page.waitForFunction(()=>window.MiyoPet.getMode()==='done');
  // A second immediate refresh used to lose the first completion to main's 250 ms throttle.
  await page.evaluate(()=>window.petHost.refreshState());
  assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'done');
  await save({agent:{activeProvider:'codex'}});
  const codex=await page.evaluate(()=>window.petHost.getState());assert.equal(codex.provider,'codex');assert.equal(codex.health,'unconfigured');
  assert.equal(await page.evaluate(()=>window.MiyoPet.getState().done),false);
  assert.equal(await page.locator('#pillWorking').evaluate(e=>e.classList.contains('hide')),true);
  assert.equal(await page.locator('#pillCredits').evaluate(e=>e.classList.contains('hide')),true);
  await app.evaluate(()=>{globalThis.agentReads=0;});await page.evaluate(()=>window.petHost.refreshState());assert.equal(await app.evaluate(()=>globalThis.agentReads),0);
  // Exercise the actual settings controls and global persistence envelope.
  await page.evaluate(()=>window.petHost.openSettings());
  let settings;for(let i=0;i<100;i++){settings=app.windows().find(w=>w.url().includes('settings.html'));if(settings)break;await new Promise(r=>setTimeout(r,30));}
  assert.ok(settings);await settings.waitForFunction(()=>document.getElementById('agentProvider').value==='codex');
  await settings.selectOption('#agentProvider','workbuddy');await settings.waitForFunction(()=>document.getElementById('agentHealth').textContent.includes('WorkBuddy'));
  const saved=JSON.parse(await fs.readFile(env.MIYO_CONFIG,'utf8'));assert.equal(saved.global.agent.activeProvider,'workbuddy');assert.ok(Object.values(saved.characters).every(c=>!c.agent));
  await settings.uncheck('#agentEnabled');await page.waitForFunction(()=>window.MiyoPet.getState().phase==='unknown');
  await settings.close();
  // Synthetic normalized provider messages test rendering without reading any Codex data.
  let rev=100000;
  async function display(fields){const value=toPetState(snapshot('codex',{health:'ready',...fields,rev:++rev}));await page.evaluate(value=>window.MiyoPet.setState(value),value);}
  await display({phase:'running'});assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'processing');
  await display({phase:'awaiting_input'});assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'pending');assert.match(await page.locator('#agentStatus').textContent(),/等待您输入/);
  await display({phase:'idle',counts:{processing:4,pending:0,approval:0}});
  await display({phase:'idle',counts:{processing:0,pending:0,approval:0}});assert.notEqual(await page.evaluate(()=>window.MiyoPet.getMode()),'done');
  await display({phase:'completed',completionKey:'once'});assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'done');
  await display({phase:'interrupted'});assert.notEqual(await page.evaluate(()=>window.MiyoPet.getMode()),'done');
  await display({phase:'completed',completionKey:'once'});assert.notEqual(await page.evaluate(()=>window.MiyoPet.getMode()),'done');
  await display({phase:'failed'});assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'error');
  await display({phase:'unknown',health:'unconfigured'});assert.equal(await page.evaluate(()=>window.MiyoPet.getMode()),'idle');
  assert.deepEqual(errors,[]);
  await app.close();app=null;
  // Fresh default configuration with no WorkBuddy installation remains a usable pet.
  await fs.rename(root,root+'-saved');
  app=await _electron.launch({executablePath:require('../electron/node_modules/electron'),args:[bootstrap],env:{...env,MIYO_CONFIG:path.join(dir,'fresh-config.json'),MIYO_USERDATA:path.join(dir,'fresh-user')}});
  const fresh=await app.firstWindow();await fresh.waitForFunction(()=>window.MiyoPet&&window.MiyoPet.getState().health==='unconfigured');
  assert.equal(await fresh.evaluate(()=>window.MiyoPet.getMode()),'idle');
  assert.equal(await fresh.evaluate(()=>window.MiyoPet.getState().error),false);
  assert.match(await fresh.locator('#agentStatus').textContent(),/尚未接入/);
  await app.close();app=null;
});
