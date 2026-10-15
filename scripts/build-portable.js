'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copy, publishDirectory, exportWeb, validatePortable, removeOwned } = require('./build-support');
function buildPortable({ root = path.resolve(__dirname, '..'), output = path.join(root, 'dist-single'), run = spawnSync } = {}) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-portable-'));
  try {
    const electronDir = path.join(root, 'electron'), system = process.env.SystemRoot || 'C:\\Windows';
    const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      PATH: [path.join(system, 'System32'), path.join(system, 'System32/WindowsPowerShell/v1.0'), path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter) };
    if (process.env.MIYO_BUILDER_MIRROR) env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.MIYO_BUILDER_MIRROR;
    const result = run(process.execPath, [path.join(electronDir, 'node_modules/electron-builder/out/cli/cli.js'),
      '--win', 'portable', '--x64', '--config', path.join(electronDir, 'electron-builder.yml'),
      '--config.directories.output=' + stage], { cwd: electronDir, env, stdio: 'inherit', timeout: 900000 });
    if (result.error || result.status !== 0) throw Error('Portable builder failed: ' + result.status + ' ' + (result.error?.message || ''));
    const artifacts = fs.readdirSync(stage).filter(name => /portable\.exe$/i.test(name));
    if (artifacts.length !== 1) throw Error('Missing or ambiguous portable artifact');
    const built = path.join(stage, artifacts[0]);
    validatePortable(built);
    publishDirectory(output, destination => { copy(built, path.join(destination, 'miyo-pet-portable.exe')); exportWeb(root, destination); });
    return path.join(output, 'miyo-pet-portable.exe');
  } finally { removeOwned(os.tmpdir(), stage); }
}
if (require.main === module) {
  try { console.log('Portable artifact: ' + buildPortable()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildPortable };
