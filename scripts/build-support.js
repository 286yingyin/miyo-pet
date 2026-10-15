'use strict';
const fs = require('node:fs');
const path = require('node:path');
const builtinVoices = ['CH0317_Title.ogg', 'ch0317_season_newyear.ogg', 'ch0317_season_xmas.ogg'];
function ownedChild(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe build path: ' + target);
  return path.resolve(target);
}
function removeOwned(parent, target) { fs.rmSync(ownedChild(parent, target), { recursive: true, force: true }); }
function copy(src, dst) { fs.cpSync(src, dst, { recursive: true, dereference: false }); }
// Prepare before touching the old product. Keep user files; each builder replaces
// only its generated resources. Unique sibling backup supports rename rollback.
function publishDirectory(output, prepare) {
  output = path.resolve(output);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, '.' + path.basename(output) + '.stage-'));
  let backup = null;
  try {
    if (fs.existsSync(output)) copy(output, stage);
    prepare(stage);
    if (fs.existsSync(output)) {
      backup = fs.mkdtempSync(path.join(parent, '.' + path.basename(output) + '.backup-'));
      fs.rmdirSync(backup);
      fs.renameSync(output, backup);
    }
    try { fs.renameSync(stage, output); }
    catch (error) {
      if (backup) {
        try { fs.renameSync(backup, output); backup = null; }
        catch (restoreError) { throw new Error(error.message + '; previous product retained at ' + backup + '; restore failed: ' + restoreError.message); }
      }
      throw error;
    }
    if (backup) {
      try { removeOwned(parent, backup); backup = null; }
      catch (error) { console.warn('Previous product retained at ' + backup + ': ' + error.message); }
    }
  } finally {
    if (fs.existsSync(stage)) {
      try { removeOwned(parent, stage); }
      catch (error) { console.warn('Build stage retained at ' + stage + ': ' + error.message); }
    }
  }
  return output;
}
function exportWeb(root, output) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron/package.json'), 'utf8'));
  const web = fs.readFileSync(path.join(root, 'prototype/v2/settings.html'), 'utf8')
    .replace('__WEB_VERSION__', pkg.version).replace("'__WEB_ONLY__' === 'true'", 'true');
  fs.writeFileSync(path.join(output, 'settings.html'), web);
  const builtin = path.join(output, 'packs/miyo');
  // An existing miyo pack may contain user-edited artwork or its own manifest.
  if (!fs.existsSync(builtin)) {
    copy(path.join(root, 'prototype/v2/assets/full_low'), path.join(builtin, 'v2'));
    copy(path.join(root, 'prototype/v1/assets/spr'), path.join(builtin, 'v1'));
    fs.writeFileSync(path.join(builtin, 'manifest.json'), JSON.stringify({ label: '美代（内置）' }, null, 2));
  }
  copy(path.join(root, 'prototype/v2/assets/full_low'), path.join(output, 'miyo-web/v2/assets/full_low'));
  copy(path.join(root, 'prototype/v1/assets/spr'), path.join(output, 'miyo-web/v1/assets/spr'));
}
function validatePortable(file) {
  const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
  try {
    // The NSIS first header precedes its compressed payload; it is not in the
    // last 256 KiB. Bound the stub scan, check PE and the declared archive size.
    const head = Buffer.alloc(Math.min(size, 1048576));
    fs.readSync(fd, head, 0, head.length, 0);
    const pe = head.length >= 64 ? head.readUInt32LE(60) : -1;
    const nsis = head.indexOf(Buffer.from('NullsoftInst'));
    if (head.subarray(0, 2).toString() !== 'MZ' || pe < 0 || head.subarray(pe, pe + 4).toString() !== 'PE\0\0' ||
        nsis < 8 || nsis + 20 > head.length || head.readUInt32LE(nsis - 4) !== 0xdeadbeef ||
        head.readUInt32LE(nsis + 16) !== size - (nsis - 8)) throw Error('Invalid portable artifact: expected complete PE/NSIS');
  } finally { fs.closeSync(fd); }
}
module.exports = { builtinVoices, ownedChild, removeOwned, copy, publishDirectory, exportWeb, validatePortable };
