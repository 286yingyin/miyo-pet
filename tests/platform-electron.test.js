'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('actual Electron recovers hidden/offscreen pet on activate, display change, resume and tray recovery', { timeout: 60000 }, async t => {
  const { _electron } = require(process.env.MIYO_PLAYWRIGHT_MODULE || 'playwright-core');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo-window-'));
  const env = { ...process.env, MIYO_USERDATA: path.join(dir, 'user'), MIYO_CONFIG: path.join(dir, 'config.json'), CODEBUDDY_CONFIG_DIR: path.join(dir, 'missing'), WORKBUDDY_TASKS_DIR: path.join(dir, 'missing/tasks') };
  delete env.ELECTRON_RUN_AS_NODE;
  const bootstrap = path.join(dir, 'bootstrap.cjs');
  await fs.writeFile(bootstrap, `const {Tray}=require('electron');const original=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.fixtureTrayMenu=menu;return original.call(this,menu);};require(${JSON.stringify(path.resolve(__dirname, '../electron/main.js'))});`);
  const app = await _electron.launch({ executablePath: require('../electron/node_modules/electron'), args: [bootstrap], env });
  t.after(async () => { await app.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow(); await page.waitForFunction(() => window.petHost && window.MiyoPet);
  await app.evaluate(async () => { while (!globalThis.fixtureTrayMenu) await new Promise(resolve => setTimeout(resolve, 10)); });
  for (const event of ['activate', 'display-removed', 'resume', 'tray']) {
    const result = await app.evaluate(async ({ app, BrowserWindow, screen, powerMonitor }, event) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setPosition(-12000, -12000); if (event === 'activate' || event === 'tray') win.hide();
      if (event === 'activate') app.emit('activate');
      if (event === 'display-removed') screen.emit('display-removed');
      if (event === 'resume') powerMonitor.emit('resume');
      if (event === 'tray') {
        const item = globalThis.fixtureTrayMenu.items.find(item => item.label === '找回桌宠');
        if (!item) return { missing: 'tray recovery' };
        item.click();
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      return { bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea, visible: win.isVisible() };
    }, event);
    assert.ok(!result.missing, result.missing);
    assert.equal(result.visible, true, event);
    assert.ok(result.bounds.x >= result.area.x && result.bounds.y >= result.area.y, event + ': offscreen');
  }
});
