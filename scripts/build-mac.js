'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copy, publishDirectory, removeOwned } = require('./build-support');
function buildMac({ root = path.resolve(__dirname, '..'), arch, platform = process.platform, run = spawnSync } = {}) {
  if (!['arm64', 'x64'].includes(arch)) throw Error('Choose --arch arm64 or --arch x64');
  if (platform !== 'darwin') throw Error('Run this build on macOS; Windows command tests are simulated only.');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-mac-'));
  try {
    const electronDir = path.join(root, 'electron');
    // CLI dot-notation leaves "null" as a string for electronDist in this
    // builder version. A typed config override actually disables Windows dist.
    const config = path.join(stage, 'mac-config.json');
    fs.writeFileSync(config, JSON.stringify({ extends: path.join(electronDir, 'electron-builder.yml'), electronDist: null }));
    const args = [path.join(electronDir, 'node_modules/electron-builder/out/cli/cli.js'), '--mac', 'zip', '--' + arch,
      '--config', config, '--config.directories.output=' + stage];
    const result = run(process.execPath, args, { cwd: electronDir, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, stdio: 'inherit', timeout: 900000 });
    if (result.error || result.status !== 0) throw Error('Mac builder failed: ' + result.status + ' ' + (result.error?.message || ''));
    const zip = fs.readdirSync(stage).find(name => name.endsWith('.zip'));
    const appDir = path.join(stage, arch === 'arm64' ? 'mac-arm64' : 'mac', 'miyo-pet.app');
    if (!zip || !fs.existsSync(path.join(appDir, 'Contents/MacOS/miyo-pet'))) throw Error('Missing Mac .app/zip artifact');
    return publishDirectory(path.join(root, 'dist-mac', arch), output => {
      const app = path.join(output, 'miyo-pet.app');
      if (fs.existsSync(app)) removeOwned(output, app);
      copy(appDir, app); copy(path.join(stage, zip), path.join(output, zip));
    });
  } finally { removeOwned(os.tmpdir(), stage); }
}
if (require.main === module) {
  try { console.log('Mac artifact: ' + buildMac({ arch: process.argv[process.argv.indexOf('--arch') + 1] })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildMac };
