'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Run the real main.js config readers/writers against real files. Only Electron's
// lifecycle is deferred so a cross-platform boundary test does not open windows.
function mainConfig(platform, userData, override) {
  const mainFile = path.resolve(__dirname, '../electron/main.js');
  const actualRequire = createRequire(mainFile);
  const appPaths = { userData, appData: path.dirname(userData), exe: path.join(path.dirname(override), 'miyo') };
  const electron = {
    app: {
      getPath(name) { return appPaths[name]; },
      setPath(name, value) { appPaths[name] = value; },
      isPackaged: true,
      commandLine: { appendSwitch() {} },
      disableHardwareAcceleration() {},
      whenReady() { return { then() {} }; },
      on() {}
    },
    ipcMain: { on() {}, handle() {} }
  };
  const context = vm.createContext({
    require(id) { return id === 'electron' ? electron : actualRequire(id); },
    process: { platform, env: { MIYO_USERDATA: userData, MIYO_CONFIG: override } },
    console,
    __dirname: path.dirname(mainFile)
  });
  vm.runInContext(fs.readFileSync(mainFile, 'utf8') + '\n' +
    'tick = function () {}; globalThis.configFixture = { read: loadConfig, write(value) { return saveConfig(value); }, submit(request) { return submitConfig(request); }, clickTop(checked) { petMenuTemplate().find(item => item.label === \'始终置顶\').click({ checked }); return configQueue; } };', context, { filename: mainFile });
  return context.configFixture;
}

for (const platform of ['darwin', 'win32']) {
  test(platform === 'darwin' ? 'main_config_mac_ignores_override_outside_user_data' : 'main_config_windows_preserves_legacy_override', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-config-boundary-'));
    try {
      const userData = path.join(dir, 'user-data');
      const override = path.join(dir, 'Miyo.app', 'Contents', 'Resources', 'config.json');
      const defaultFile = path.join(userData, 'config.json');
      fs.mkdirSync(userData, { recursive: true });
      fs.mkdirSync(path.dirname(override), { recursive: true });
      const originalDefault = JSON.stringify({ _v: 1, fixtureMarker: 'user-data' });
      const originalOverride = JSON.stringify({ _v: 1, fixtureMarker: 'app-override' });
      fs.writeFileSync(defaultFile, originalDefault);
      fs.writeFileSync(override, originalOverride);
      const config = mainConfig(platform, userData, override);
      const loaded = await config.read();
      const readMarker = loaded.fixtureMarker;
      assert.equal((await config.write({ fixtureMarker: 'saved' })).ok, true);
      if (platform === 'darwin') {
        assert.equal(readMarker, 'user-data', 'Mac must read userData despite MIYO_CONFIG pointing inside .app');
        assert.equal(JSON.parse(fs.readFileSync(defaultFile, 'utf8')).fixtureMarker, 'saved');
        assert.equal(fs.readFileSync(override, 'utf8'), originalOverride, 'Mac must leave the external override byte-for-byte unchanged');
      } else {
        assert.equal(readMarker, 'app-override');
        assert.equal(JSON.parse(fs.readFileSync(override, 'utf8')).fixtureMarker, 'saved');
        assert.equal(fs.readFileSync(defaultFile, 'utf8'), originalDefault);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}


test('queued internal actions bind revision at execution while renderer requests remain stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-config-queue-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ _v: 1, alwaysOnTop: true, scope: 'current' }));
    const config = mainConfig('win32', dir, file);
    const original = await config.read();
    const results = await Promise.all([
      config.write({ alwaysOnTop: false }),
      config.write({ scope: 'all' }),
      config.submit({ characterId: original.characterId, baseRevision: original.revision, patch: { volume: 0.9 } })
    ]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true, 'the second queued menu action must not be silently dropped');
    assert.equal(results[2].ok, false);
    assert.equal(results[2].error, 'CONFIG_STALE', 'renderer-supplied revisions must still be enforced');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.global.alwaysOnTop, false);
    assert.equal(stored.global.scope, 'all');
    assert.equal(stored.revision, original.revision + 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('two queued native checkbox actions restore the original value', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-checkbox-queue-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ _v: 1, alwaysOnTop: true }));
    const config = mainConfig('win32', dir, file);
    const original = await config.read();
    const results = await Promise.all([config.clickTop(false), config.clickTop(true)]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.global.alwaysOnTop, true);
    assert.equal(stored.revision, original.revision + 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
