'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { builtinVoices, copy, removeOwned, publishDirectory, exportWeb } = require('./build-support');

// Windows directory build: generated resources are fresh; previous output and
// user packs remain intact until all copies and the web export have succeeded.
function buildExe({ root = path.resolve(__dirname, '..'), output = path.join(root, 'dist/miyo-pet-win32-x64'), runtime = path.join(root, 'electron/node_modules/electron/dist') } = {}) {
  if (!fs.existsSync(path.join(runtime, 'electron.exe'))) throw Error('Missing Windows Electron runtime; run npm ci in electron/ on Windows.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron/package.json'), 'utf8'));
  publishDirectory(output, stage => {
    // Only the generated application subtrees are replaced. Other output files
    // (packs, config, custom voice libraries, notes) belong to the user.
    for (const name of ['resources/app', 'resources/app-root', 'resources/app.asar']) {
      const generated = path.join(stage, name); if (fs.existsSync(generated)) removeOwned(stage, generated);
    }
    copy(runtime, stage);
    const defaultApp = path.join(stage, 'resources/default_app.asar');
    if (fs.existsSync(defaultApp)) removeOwned(stage, defaultApp);
    const locales = path.join(stage, 'locales'), keep = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']);
    if (fs.existsSync(locales)) for (const name of fs.readdirSync(locales)) if (!keep.has(name)) removeOwned(stage, path.join(locales, name));
    const app = path.join(stage, 'resources/app');
    fs.mkdirSync(path.join(app, 'electron'), { recursive: true });
    for (const name of ['main.js', 'preload.js', 'paths.js', 'platform-paths.js', 'character-packs.js', 'config-store.js', 'window-geometry.js', 'icon.png']) copy(path.join(root, 'electron', name), path.join(app, 'electron', name));
    fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
    for (const name of ['task-status.js', 'state-core.js', 'approval-status.js', 'change-log.js', 'credits-query.js', 'codex-event.js', 'agents']) copy(path.join(root, 'scripts', name), path.join(app, 'scripts', name));
    const skip = new Set(['packs', 'spine-webgl.js', 'render.html', 'preview.html', 'ix-test.js']);
    for (const mode of ['v1', 'v2']) {
      const source = path.join(root, 'prototype', mode), dest = path.join(app, 'prototype', mode);
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(source)) if (!skip.has(name)) copy(path.join(source, name), path.join(dest, name));
    }
    fs.mkdirSync(path.join(app, 'prototype/voices'), { recursive: true });
    for (const name of builtinVoices) copy(path.join(root, 'prototype/voices', name), path.join(app, 'prototype/voices', name));
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'miyo-pet', productName: '美代桌宠', version: pkg.version, main: 'electron/main.js' }, null, 2));
    const exe = path.join(stage, 'miyo-pet.exe');
    if (fs.existsSync(exe)) removeOwned(stage, exe);
    fs.renameSync(path.join(stage, 'electron.exe'), exe);
    const fd = fs.openSync(exe, 'r'), header = Buffer.alloc(2);
    try { fs.readSync(fd, header, 0, 2, 0); } finally { fs.closeSync(fd); }
    if (header.toString() !== 'MZ') throw Error('Invalid Windows runtime executable');
    fs.writeFileSync(path.join(stage, 'READ-ME-FIRST.txt'),
      '美代桌宠 ' + pkg.version + '（免安装版）\r\n\r\n双击 miyo-pet.exe。右键或托盘打开设置、找回桌宠或退出。\r\n' +
      '配置：%APPDATA%\\miyo-pet\\config.json。角色包：exe 旁 packs\\。美代自定义语音：packs\\voice\\。\r\n' +
      '启动异常可设置 MIYO_GPU=on 或 off。构建不自动分发仓库根目录 voice/ 与 packs/ 私人资源。\r\n' +
      '游戏素材版权归 NEXON Games 及官方所有，仅供个人使用，请勿商用。\r\n');
    exportWeb(root, stage);
  });
  return path.join(output, 'miyo-pet.exe');
}
if (require.main === module) {
  try { console.log('Directory artifact: ' + buildExe()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildExe };
