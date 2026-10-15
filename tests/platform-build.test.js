'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('run.sh chooses native Darwin executable and preserves requested GPU without default no-sandbox (simulated)', t => {
  const { spawnSync } = require('node:child_process');
  const shell = process.env.MIYO_SH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh');
  const root = fixture(t), bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\nprintf Darwin\n', { mode: 0o755 });
  fs.copyFileSync(path.join(__dirname, '../electron/run.sh'), path.join(root, 'run.sh'));
  const executable = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s|%s|%s|%s" "$MIYO_GPU" "$MIYO_NO_SANDBOX" "$ELECTRON_RUN_AS_NODE" "$*"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, MIYO_GPU: 'on', ELECTRON_RUN_AS_NODE: '1' };
  delete env.MIYO_NO_SANDBOX;
  const shellBin = bin.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
  const result = spawnSync(shell, ['-c', 'PATH="$1:$PATH"; export PATH; shift; exec /bin/sh "$@"', 'fixture', shellBin, path.join(root, 'run.sh'), '--fixture'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'on|||. --fixture');
});
test('simulated Darwin build uses native Node CLI, architecture and downloaded Mac runtime', t => {
  const { buildMac } = require('../scripts/build-mac');
  const root = fixture(t);
  for (const arch of ['arm64', 'x64']) {
    let called = false;
    assert.throws(() => buildMac({ root, arch, platform: 'darwin', run(command, args, options) {
      called = true;
      assert.equal(command, process.execPath);
      assert.ok(args.includes('--mac')); assert.ok(args.includes('--' + arch));
      const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
      assert.equal(config.electronDist, null, 'typed null must override the Windows runtime; CLI string null is not coerced by this builder');
      assert.equal(config.extends, path.join(root, 'electron/electron-builder.yml'));
      assert.ok(!args.some(a => /npm\.cmd|electron\.exe/.test(a)));
      assert.equal(options.cwd, path.join(root, 'electron'));
      return { status: 7 };
    } }), /builder.*7/);
    assert.equal(called, true);
  }
  assert.throws(() => buildMac({ root, arch: 'ia32', platform: 'darwin' }), /arm64.*x64/);
  assert.throws(() => buildMac({ root, arch: 'arm64', platform: 'win32' }), /macOS/);
});
test('failed directory preparation leaves old packs/config and output intact', t => {
  const { publishDirectory } = require('../scripts/build-support');
  const root = fixture(t), output = path.join(root, 'output');
  fs.mkdirSync(path.join(output, 'packs', 'miyo'), { recursive: true });
  fs.writeFileSync(path.join(output, 'packs', 'miyo', 'custom.txt'), 'user');
  fs.writeFileSync(path.join(output, 'config.json'), 'old config');
  assert.throws(() => publishDirectory(output, stage => { fs.writeFileSync(path.join(stage, 'partial'), 'bad'); throw Error('prepare failed'); }), /prepare failed/);
  assert.equal(fs.readFileSync(path.join(output, 'packs', 'miyo', 'custom.txt'), 'utf8'), 'user');
  assert.equal(fs.readFileSync(path.join(output, 'config.json'), 'utf8'), 'old config');
  assert.deepEqual(fs.readdirSync(root), ['output']);
});
test('directory publication preserves custom builtin overrides and unrelated user files', t => {
  const { publishDirectory, exportWeb } = require('../scripts/build-support');
  const root = fixture(t), output = path.join(root, 'output');
  fs.mkdirSync(path.join(output, 'packs', 'miyo', 'v2'), { recursive: true });
  fs.writeFileSync(path.join(output, 'packs', 'miyo', 'v2', '00.png'), 'custom');
  fs.writeFileSync(path.join(output, 'config.json'), 'old config');
  fs.writeFileSync(path.join(output, 'personal.txt'), 'keep');
  publishDirectory(output, stage => {
    fs.writeFileSync(path.join(stage, 'application'), 'new');
    exportWeb(path.resolve(__dirname, '..'), stage);
  });
  assert.equal(fs.readFileSync(path.join(output, 'packs', 'miyo', 'v2', '00.png'), 'utf8'), 'custom');
  assert.equal(fs.readFileSync(path.join(output, 'config.json'), 'utf8'), 'old config');
  assert.equal(fs.readFileSync(path.join(output, 'personal.txt'), 'utf8'), 'keep');
  assert.ok(fs.readFileSync(path.join(output, 'settings.html'), 'utf8').includes("true"));
});
test('failed final rename restores previous directory and reports the failure', t => {
  const { publishDirectory } = require('../scripts/build-support');
  const root = fixture(t), output = path.join(root, 'output');
  fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'old'), 'preserve');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (from.includes('.stage-') && to === output) throw Error('publish denied');
    return rename(from, to);
  });
  assert.throws(() => publishDirectory(output, stage => fs.writeFileSync(path.join(stage, 'new'), 'new')), /publish denied/);
  assert.equal(fs.readFileSync(path.join(output, 'old'), 'utf8'), 'preserve');
});
for (const scenario of ['builder failed', 'missing artifact', 'invalid artifact']) {
  test('portable ' + scenario + ' cannot replace previous product', t => {
    assert.match(fs.readFileSync(path.join(__dirname, '../scripts/build-portable.js'), 'utf8'), /module[.]exports/, 'builder must be import-safe before testing');
    const { buildPortable } = require('../scripts/build-portable');
    const root = fixture(t), output = path.join(root, 'dist-single');
    fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'miyo-pet-portable.exe'), 'previous');
    assert.throws(() => buildPortable({ root, output, run(command, args) {
      const stage = args.find(a => a.startsWith('--config.directories.output=')).split('=').slice(1).join('=');
      if (scenario === 'invalid artifact') fs.writeFileSync(path.join(stage, 'fake-portable.exe'), 'not executable');
      return { status: scenario === 'builder failed' ? 2 : 0 };
    } }), /builder|artifact|portable|NSIS/i);
    assert.equal(fs.readFileSync(path.join(output, 'miyo-pet-portable.exe'), 'utf8'), 'previous');
  });
}
test('offscreen and negative-origin work areas recover; oversized pets retain bottom anchor', () => {
  const { visibleBounds } = require('../electron/window-geometry');
  const left = { x: -1600, y: 50, width: 1600, height: 850 };
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(visibleBounds({ x: -1500, y: 80, width: 240, height: 620 }, [left, primary], primary), { x: -1500, y: 80, width: 240, height: 620 });
  assert.deepEqual(visibleBounds({ x: -4000, y: -3000, width: 240, height: 620 }, [primary], primary), { x: 0, y: 0, width: 240, height: 620 });
  assert.deepEqual(visibleBounds({ x: -50, y: -3000, width: 1200, height: 3100 }, [primary], primary), { x: 0, y: -2060, width: 1200, height: 3100 });
});
test('portable validation finds the NSIS first header before payload and rejects truncated payload', t => {
  const { validatePortable } = require('../scripts/build-support');
  const root = fixture(t), file = path.join(root, 'portable.exe');
  const bytes = Buffer.alloc(400000);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  const header = 1024;
  bytes.writeUInt32LE(0xdeadbeef, header + 4); bytes.write('NullsoftInst', header + 8);
  bytes.writeUInt32LE(100, header + 20); bytes.writeUInt32LE(bytes.length - header, header + 24);
  fs.writeFileSync(file, bytes); assert.doesNotThrow(() => validatePortable(file));
  fs.writeFileSync(file, bytes.subarray(0, bytes.length - 4)); assert.throws(() => validatePortable(file), /NSIS/);
});
test('real directory builder includes adapter modules and only builtin voices; failed rebuild preserves user output', t => {
  const { buildExe } = require('../scripts/build-exe');
  const root = fixture(t), output = path.join(root, 'dist/product'), runtime = path.join(root, 'runtime');
  const write = (name, value = 'fixture') => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  write('runtime/electron.exe', 'MZfixture');
  write('electron/package.json', '{"version":"0.3.23"}');
  for (const name of ['main.js', 'preload.js', 'paths.js', 'platform-paths.js', 'character-packs.js', 'config-store.js', 'window-geometry.js', 'icon.png']) write('electron/' + name);
  for (const name of ['task-status.js', 'state-core.js', 'approval-status.js', 'change-log.js', 'credits-query.js', 'codex-event.js', 'agents/schema.js', 'agents/hub.js', 'agents/workbuddy.js', 'agents/codex.js']) write('scripts/' + name);
  write('prototype/v1/assets/spr/00.png'); write('prototype/v2/assets/full_low/00.png');
  write('prototype/v2/settings.html', "var WEB_VERSION = '__WEB_VERSION__'; var WEB_ONLY = '__WEB_ONLY__' === 'true';");
  for (const voice of ['CH0317_Title.ogg', 'ch0317_season_newyear.ogg', 'ch0317_season_xmas.ogg']) write('prototype/voices/' + voice);
  write('prototype/voices/private.ogg', 'never distribute'); write('voice/private.ogg', 'never distribute');
  write('dist/product/packs/custom/keep.txt', 'user'); write('dist/product/config.json', 'user config');
  buildExe({ root, output, runtime });
  assert.equal(fs.readFileSync(path.join(output, 'packs/custom/keep.txt'), 'utf8'), 'user');
  const app = path.join(output, 'resources/app');
  for (const name of ['agents/hub.js', 'agents/schema.js', 'agents/codex.js', 'agents/workbuddy.js', 'codex-event.js']) assert.ok(fs.existsSync(path.join(app, 'scripts', name)));
  assert.equal(fs.readdirSync(path.join(app, 'prototype/voices')).length, 3);
  assert.equal(fs.existsSync(path.join(app, 'voice')), false);
  fs.unlinkSync(path.join(root, 'scripts/codex-event.js'));
  assert.throws(() => buildExe({ root, output, runtime }), /ENOENT/);
  assert.equal(fs.readFileSync(path.join(output, 'packs/custom/keep.txt'), 'utf8'), 'user');
  assert.equal(fs.readFileSync(path.join(output, 'config.json'), 'utf8'), 'user config');
  assert.ok(fs.existsSync(path.join(app, 'scripts/codex-event.js')));
});
test('Mac effective builder config disables Windows electronDist (simulated, no build)', async t => {
  const { buildMac } = require('../scripts/build-mac');
  const { getConfig } = require('../electron/node_modules/app-builder-lib/out/util/config/config');
  const fixtureRoot = fixture(t), saved = path.join(fixtureRoot, 'mac.json'), root = path.resolve(__dirname, '..');
  assert.throws(() => buildMac({ root, arch: 'arm64', platform: 'darwin', run(command, args) {
    fs.copyFileSync(args[args.indexOf('--config') + 1], saved); return { status: 1 };
  } }), /builder/);
  const config = await getConfig(path.join(root, 'electron'), saved);
  assert.equal(config.electronDist, null);
  assert.equal(config.electronVersion, '33.4.11');
});
test('failed rollback leaves a named recoverable backup containing user packs', t => {
  const { publishDirectory } = require('../scripts/build-support');
  const root = fixture(t), output = path.join(root, 'output');
  fs.mkdirSync(path.join(output, 'packs'), { recursive: true }); fs.writeFileSync(path.join(output, 'packs', 'keep'), 'user');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === output) throw Error('destination locked');
    return rename(from, to);
  });
  assert.throws(() => publishDirectory(output, () => {}), /previous product retained at .*backup-.*restore failed/);
  const backups = fs.readdirSync(root).filter(name => name.includes('.backup-'));
  assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(root, backups[0], 'packs/keep'), 'utf8'), 'user');
});
