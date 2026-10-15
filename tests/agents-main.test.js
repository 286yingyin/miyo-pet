'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');

test('credits source gate stops owned timer/child and ignores late success or failure',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'miyo-credits-lifecycle-'));
  try {
    const binary=path.join(dir,'binaries/node/versions/22.10.0/node.exe');
    fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'synthetic path only');
    const mainFile=path.resolve(__dirname,'../electron/main.js'),actualRequire=createRequire(mainFile);
    const children=[],timers=new Map();let next=0;
    const electron={app:{getPath:()=>dir,setPath(){},isPackaged:false,commandLine:{appendSwitch(){}},disableHardwareAcceleration(){},whenReady(){return {then(){}};},on(){}},ipcMain:{on(){},handle(){}}};
    const context=vm.createContext({
      require(id){if(id==='electron')return electron;if(id==='child_process')return {spawn(){const c=new EventEmitter();c.stdout=new EventEmitter();c.killed=false;c.kill=()=>{c.killed=true;};children.push(c);return c;}};return actualRequire(id);},
      process:{platform:'win32',env:{MIYO_USERDATA:dir,CODEBUDDY_CONFIG_DIR:dir}},__dirname:path.dirname(mainFile),console,
      setInterval(fn){timers.set(++next,fn);return next;},clearInterval(id){timers.delete(id);},
      setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);}
    });
    vm.runInContext(fs.readFileSync(mainFile,'utf8')+`
      cfg = defaults();
      globalThis.creditFixture = {
        start:startCredits, stop:stopCredits, poll:pollCredits,
        select(provider,enabled=true){cfg.agent={activeProvider:provider};cfg.detect.enabled=enabled;},
        last(){return lastCredits;}
      };
    `,context,{filename:mainFile});
    const f=context.creditFixture;
    f.select('workbuddy');f.start();assert.equal(children.length,1);assert.equal(timers.size,2);
    const lateTimers=[...timers.values()];f.select('codex');f.stop();assert.equal(timers.size,0);assert.equal(children[0].killed,true);
    children[0].stdout.emit('data','{"ok":true,"total":100}\n');children[0].emit('close');children[0].emit('error',new Error('synthetic late error'));
    for(const callback of lateTimers)callback();f.poll();assert.equal(children.length,1);assert.equal(f.last().ok,false);assert.equal(fs.existsSync(path.join(dir,'credits.json')),false);
    f.select('workbuddy',false);f.poll();assert.equal(children.length,1);
    f.select('workbuddy');f.start();assert.equal(children.length,2);f.stop();assert.equal(children[1].killed,true);assert.equal(timers.size,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
