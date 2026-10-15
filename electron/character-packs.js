'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const MODES = ['v1', 'v2'];
function legacyId(name) { return name === 'miyo' ? 'miyo' : 'legacy:' + encodeURIComponent(name); }
function inside(root, file) { const rel = path.relative(root, file); return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
async function resource(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /^[a-z]+:/i.test(relative)) throw new Error('PACK_PATH');
  const file = path.resolve(root, relative); if (!inside(root, file)) throw new Error('PACK_PATH');
  // realpath rejects links which escape the package as well as lexical traversal.
  const realRoot = await fs.realpath(root), realFile = await fs.realpath(file);
  if (!inside(realRoot, realFile)) throw new Error('PACK_PATH');
  return file;
}
async function entries(dir) { try { return (await fs.readdir(dir, { withFileTypes:true })).sort((a,b)=>a.name.localeCompare(b.name)); } catch { return []; } }
async function scan(root, dir=root, depth=0, sprites={}) {
  if (depth > 3) return sprites;
  for (const entry of await entries(dir)) {
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) await scan(root,full,depth+1,sprites);
    else if (entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name)) {
      const base=entry.name.replace(/\.(png|jpe?g)$/i,''), match=/(?:^|_)spr_(.+)$/i.exec(base), id=match?match[1]:base;
      if (!Object.hasOwn(sprites,id)) Object.defineProperty(sprites,id,{value:await resource(root,path.relative(root,full)),enumerable:true,writable:true,configurable:true});
    }
  }
  return sprites;
}
async function resolveDefaults(root, value, key, inVoices = false) {
  if (typeof value === 'string' && value && (key === 'voice' || key === 'file')) {
    if (path.isAbsolute(value) || /^[a-z]+:/i.test(value) || !inside(root, path.resolve(root, value))) throw new Error('PACK_PATH');
    const full = path.resolve(root, value);
    try { return await resource(root, value); } catch (e) { if (e.code === 'ENOENT') return full; throw e; }
  }
  if (Array.isArray(value)) return Promise.all(value.map(v => resolveDefaults(root, v, inVoices && typeof v === 'string' ? 'file' : key, inVoices)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(k)) throw new Error('PACK_MANIFEST');
      out[k] = await resolveDefaults(root, v, k, inVoices || k === 'voices');
    }
    return out;
  }
  return value;
}
async function descriptor(root, name, onlyMode) {
  let manifest={};
  try { manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  if (!manifest || typeof manifest!=='object' || Array.isArray(manifest) || (manifest.schemaVersion!=null && manifest.schemaVersion!==1)) throw new Error('PACK_MANIFEST');
  const id=manifest.id || legacyId(name);
  if (typeof id!=='string' || !id || id.length>160 || /[\x00-\x1f]/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('PACK_ID');
  if (manifest.preview) await resource(root,manifest.preview);
  const modes={v1:null,v2:null};
  const children=await entries(root), hasModes=children.some(e=>e.isDirectory() && MODES.includes(e.name));
  for (const mode of onlyMode?[onlyMode]:MODES) {
    let sprites={}, dir=root;
    if (manifest.sprites) {
      for (const [key,relative] of Object.entries(manifest.sprites[mode] || {})) {
        const file=await resource(root,relative); if (!/\.(png|jpe?g)$/i.test(file)) throw new Error('PACK_IMAGE');
        Object.defineProperty(sprites,key,{value:file,enumerable:true});
      }
    } else { dir=onlyMode || !hasModes?root:path.join(root,mode); sprites=await scan(root,dir); }
    const ids=Object.keys(sprites).sort();
    if (ids.length) {
      const requested=manifest.defaultSpriteId && (typeof manifest.defaultSpriteId==='string'?manifest.defaultSpriteId:manifest.defaultSpriteId[mode]);
      modes[mode]={rootDir:root,sprites,defaultSpriteId:ids.includes(requested)?requested:ids.includes('00')?'00':ids[0]};
    }
  }
  if (!modes.v1 && !modes.v2) return null;
  if (manifest.defaults && (typeof manifest.defaults !== 'object' || Array.isArray(manifest.defaults))) throw new Error('PACK_MANIFEST');
  const defaults = await resolveDefaults(root, manifest.defaults || {});
  return {id,label:String(manifest.label||name),modes,defaults,attribution:manifest.attribution||null,warnings:[],legacyNames:[name]};
}
async function discoverPacks(roots) {
  const found=new Map();
  async function add(root,name,mode) {
    let pack; try { pack=await descriptor(root,name,mode); } catch { return; } if(!pack)return;
    const previous=found.get(pack.id); if(!previous){found.set(pack.id,pack);return;}
    previous.legacyNames=[...new Set(previous.legacyNames.concat(pack.legacyNames))];
    for(const ver of MODES) if(pack.modes[ver]) {
      if(previous.modes[ver]) previous.warnings.push('Duplicate '+ver+': using '+previous.modes[ver].rootDir+'; ignored '+root);
      else previous.modes[ver]=pack.modes[ver];
    }
  }
  for(const root of roots) {
    for(const e of await entries(root)) if(e.isDirectory() && !MODES.includes(e.name)) await add(path.join(root,e.name),e.name);
    for(const mode of MODES) for(const e of await entries(path.join(root,mode))) if(e.isDirectory()) await add(path.join(root,mode,e.name),e.name,mode);
  }
  return [...found.values()];
}
function resolveSprite(pack, mode, id) {
  const m=pack && pack.modes[mode]; if(!m)return null;
  return m.sprites[id] || m.sprites[m.defaultSpriteId] || m.sprites[Object.keys(m.sprites).sort()[0]] || null;
}
module.exports={discoverPacks,resolveSprite,legacyId};
