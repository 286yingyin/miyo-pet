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
    'globalThis.configFixture = { read: loadConfig, write(value) { cfg = value; return saveConfig(); } };', context, { filename: mainFile });
  return context.configFixture;
}

for (const platform of ['darwin', 'win32']) {
  test(platform === 'darwin' ? 'main_config_mac_ignores_override_outside_user_data' : 'main_config_windows_preserves_legacy_override', () => {
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
      const loaded = config.read();
      const readMarker = loaded.fixtureMarker;
      assert.equal(config.write({ ...loaded, fixtureMarker: 'saved' }), true);
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
