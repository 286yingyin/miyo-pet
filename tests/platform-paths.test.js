'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
// Load lazily so each missing boundary has a named failing assertion.
function api() { try { return require('../electron/platform-paths'); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') return {}; throw e; } }

test('resolvePaths_mac_writes_only_user_data', () => {
  assert.equal(typeof api().resolvePaths, 'function', 'platform path resolver must exist');
  const result = api().resolvePaths({ platform: 'darwin', userDataDir: '/Users/test/Library/Application Support/miyo-pet', appRoot: '/Applications/Miyo.app/Contents/Resources/app-root', portableDir: '/Applications', exeDir: '/Applications/Miyo.app/Contents/MacOS', isPackaged: true });
  assert.deepEqual(result, {
    resourceRoot: '/Applications/Miyo.app/Contents/Resources/app-root',
    configDir: '/Users/test/Library/Application Support/miyo-pet',
    packRoots: ['/Users/test/Library/Application Support/miyo-pet/packs'],
    presetDir: '/Users/test/Library/Application Support/miyo-pet/settings',
    eventDir: '/Users/test/Library/Application Support/miyo-pet/agent-events'
  });
});

test('windows_preserves_portable_pack_roots', () => {
  assert.equal(typeof api().resolvePaths, 'function', 'platform path resolver must exist');
  const result = api().resolvePaths({ platform: 'win32', userDataDir: 'C:\\Users\\test\\AppData\\Roaming\\miyo-pet', appRoot: 'C:\\Temp\\app-root', portableDir: 'D:\\美代 #100%', exeDir: 'C:\\Temp\\runtime', isPackaged: true });
  assert.deepEqual(result, {
    resourceRoot: 'C:\\Temp\\app-root',
    configDir: 'C:\\Users\\test\\AppData\\Roaming\\miyo-pet',
    packRoots: ['D:\\美代 #100%\\packs', 'C:\\Temp\\runtime\\packs'],
    presetDir: 'D:\\美代 #100%\\packs\\settings',
    eventDir: 'C:\\Users\\test\\AppData\\Roaming\\miyo-pet\\agent-events'
  });
  const green = api().resolvePaths({ platform: 'win32', userDataDir: 'C:\\data', appRoot: 'C:\\app', exeDir: 'D:\\miyo', isPackaged: true });
  assert.deepEqual(green.packRoots, ['D:\\miyo\\packs']);
  assert.equal(green.presetDir, 'D:\\miyo\\packs\\settings');
  const dev = api().resolvePaths({ platform: 'win32', userDataDir: 'C:\\test-data', appRoot: 'C:\\source', exeDir: 'C:\\node' });
  assert.deepEqual(dev.packRoots, []);
  assert.equal(dev.presetDir, 'C:\\source\\presets');
  const dedup = api().resolvePaths({ platform: 'win32', userDataDir: 'C:\\data', appRoot: 'C:\\app', portableDir: 'D:\\miyo', exeDir: 'D:\\miyo', isPackaged: true });
  assert.deepEqual(dedup.packRoots, ['D:\\miyo\\packs']);
});

test('file_url_roundtrips_special_characters', () => {
  assert.equal(typeof api().fileUrlOf, 'function', 'file URL boundary must exist');
  assert.equal(typeof api().fileUrlOfDir, 'function', 'directory URL boundary must exist');
  const file = path.resolve('测试 目录 #100%', '语音 #50%.ogg');
  const url = api().fileUrlOf(file);
  assert.equal(fileURLToPath(url), file);
  assert.ok(url.includes('%23') && url.includes('%25'));
  const dir = path.dirname(file);
  assert.equal(fileURLToPath(api().fileUrlOfDir(dir)), dir + path.sep);
  assert.equal(fileURLToPath(new URL(encodeURIComponent(path.basename(file)), api().fileUrlOfDir(dir))), file);
});
