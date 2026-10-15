'use strict';
// Run after building Windows artifacts. Uses only isolated, synthetic user data.
// MIYO_PLAYWRIGHT_MODULE / MIYO_BROWSER_PATH may select existing test tooling.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { browserTools, serveRepository } = require('../helpers/browser-runner');
const root = path.resolve(__dirname, '../..');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');

async function chromiumChecks(evidence) {
  const { chromium, executablePath } = browserTools(), server = await serveRepository();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.petHost = { onState() {}, onConfig(cb) { window.fixtureConfig = cb; } }; });
    await page.goto(server.url + '/prototype/v2/index.html');
    await page.waitForFunction(() => window.fixtureConfig && window.MiyoPet);
    for (const scale of [0.5, 2, 5]) {
      await page.evaluate(scale => window.fixtureConfig({ scale }), scale);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pet-scale').trim()), String(scale));
    }
    await page.route('**/synthetic-role.png', route => route.fulfill({ contentType: 'image/png', body: pixel }));
    await page.evaluate(url => window.fixtureConfig({ characterId: 'fixture', series: 'fixture', revision: 1, mode: 'v2', scale: 1,
      packIds: { v2: ['08'], v1: [] }, packFileUrl: { v2: { '08': url }, v1: {} }, packDefaultId: { v2: '08' }, scripts: { v2: {} }, mapping: { v2: { idle: ['08'] } } }), server.url + '/synthetic-role.png');
    await page.waitForFunction(() => document.getElementById('layerBase').src.endsWith('/synthetic-role.png'));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(evidence, 'chromium-role.png') });
    // Exercise the exported document itself, not a string-only build assertion.
    for (const output of ['dist/miyo-pet-win32-x64', 'dist-single']) {
      const gallery = await browser.newPage();
      await gallery.goto(pathToFileURL(path.join(root, output, 'settings.html')).href);
      await gallery.waitForFunction(() => document.getElementById('galConnect'));
      assert.ok(await gallery.locator('#galConnect').isVisible());
      await gallery.waitForFunction(() => { const image = document.getElementById('previewImg'); return image && image.complete && image.naturalWidth > 0; }, null, { timeout: 5000 });
      await gallery.screenshot({ path: path.join(evidence, output.startsWith('dist/') ? 'directory-web.png' : 'portable-web.png') });
      await gallery.close();
    }
    return { simulatedHost: true, scale: [0.5, 2, 5], externalRoleImage: true, exportedWebDocuments: 2 };
  } finally { await browser.close(); await server.close(); }
}

async function electronChecks(kind, evidence) {
  const { _electron } = require(process.env.MIYO_PLAYWRIGHT_MODULE || 'playwright-core');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'miyo-v040-' + kind + '-'));
  const user = path.join(dir, '用户配置'), configFile = path.join(user, 'config.json');
  await fs.mkdir(user);
  // Legacy flat config is deliberately upgraded, then checked across restart.
  await fs.writeFile(configFile, JSON.stringify({ _v: 1, scale: 0.75, volume: 0.25, detect: { enabled: false }, agent: { enabled: false, activeProvider: 'workbuddy' } }));
  const role = path.join(dir, 'packs', '测试角色');
  await fs.mkdir(path.join(role, 'v2'), { recursive: true });
  await fs.writeFile(path.join(role, 'v2/08.png'), pixel);
  await fs.writeFile(path.join(role, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'fixture', label: '测试角色', defaults: { mapping: { v2: { idle: ['08'] } } } }));
  const sentinel = path.join(dir, 'packs/settings/user-sentinel.json');
  await fs.mkdir(path.dirname(sentinel), { recursive: true }); await fs.writeFile(sentinel, '{"keep":true}');
  let executablePath, args;
  if (kind === 'source') { executablePath = require('../../electron/node_modules/electron'); args = [path.join(root, 'electron/main.js')]; }
  else if (kind === 'directory') { executablePath = path.join(root, 'dist/miyo-pet-win32-x64/miyo-pet.exe'); args = []; }
  else {
    executablePath = path.join(dir, 'miyo-pet-portable.exe');
    await fs.copyFile(path.join(root, 'dist-single/miyo-pet-portable.exe'), executablePath); args = [];
  }
  const env = { ...process.env, MIYO_USERDATA: user, MIYO_CONFIG: configFile, PORTABLE_EXECUTABLE_DIR: dir,
    CODEBUDDY_CONFIG_DIR: path.join(dir, 'synthetic-workbuddy'), WORKBUDDY_TASKS_DIR: path.join(dir, 'synthetic-workbuddy/tasks') };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, browser, wrapper, cdp, petPage;
  const close = async () => {
    if (browser) {
      // The NSIS child may drop the transport before acknowledging Browser.close.
      const deadline = async promise => { let timer; try { await Promise.race([promise.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 3000); })]); } finally { clearTimeout(timer); } };
      await deadline(cdp.send('Browser.close')); await deadline(browser.close()); browser = null;
    }
    if (app) { await app.close(); app = null; }
    if (wrapper) {
      // The NSIS wrapper waits for its child. Close via CDP before removing its
      // private extraction directory; terminate only this owned wrapper if stuck.
      for (let i = 0; i < 100 && wrapper.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (wrapper.exitCode === null) wrapper.kill();
      wrapper = null;
    }
  };
  const launch = async () => {
    let page;
    if (kind !== 'portable') {
      app = await _electron.launch({ executablePath, args, env, timeout: 60000 });
      page = await app.firstWindow();
    } else {
      const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port; await new Promise(resolve => server.close(resolve));
      wrapper = spawn(executablePath, ['--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1'], { env, windowsHide: true, stdio: 'ignore' });
      let endpoint;
      for (let i = 0; i < 600; i++) {
        try { const response = await fetch('http://127.0.0.1:' + port + '/json/version'); endpoint = (await response.json()).webSocketDebuggerUrl; if (endpoint) break; } catch (_) {}
        if (wrapper.exitCode !== null) throw Error('Portable wrapper exited before CDP: ' + wrapper.exitCode);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!endpoint) throw Error('Portable wrapper CDP did not become available');
      browser = await browserTools().chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0]; page = context.pages()[0] || await context.waitForEvent('page');
      cdp = await browser.newBrowserCDPSession();
    }
    await page.waitForFunction(() => window.petHost && window.MiyoPet); petPage = page; return page;
  };
  const bounds = async () => {
    if (app) return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    // Electron's CDP endpoint omits Browser.getWindowBounds. Renderer screen
    // coordinates still observe the native frameless window's actual movement.
    return petPage.evaluate(() => ({ x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }));
  };
  try {
    let page = await launch();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const metadata = app ? await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), resources: process.resourcesPath,
      exe: app.getPath('exe'), userData: app.getPath('userData'), background: BrowserWindow.getAllWindows()[0].getBackgroundColor(),
      preload: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().preload })) : {
        packaged: true, wrapperExe: executablePath, wrapperPid: wrapper.pid, inspection: 'Actual NSIS wrapper spawn + CDP; packaged status inferred from extracted app-root location',
        resources: path.resolve(path.dirname(fileURLToPath(page.url())), '../../..'), userData: user, page: page.url()
      };
    assert.equal(metadata.packaged, kind !== 'source'); assert.equal(metadata.userData, user);
    // getBackgroundColor() drops alpha on this Electron/Windows combination;
    // retain the observed value, never infer desktop compositing from it.
    const appRoot = kind === 'source' ? root : kind === 'directory' ? path.join(metadata.resources, 'app') : path.join(metadata.resources, 'app-root');
    for (const file of ['scripts/agents/hub.js', 'scripts/agents/schema.js', 'scripts/agents/workbuddy.js', 'scripts/agents/codex.js', 'scripts/codex-event.js']) await fs.access(path.join(appRoot, file));
    const voices = await fs.readdir(path.join(appRoot, 'prototype/voices'));
    if (kind !== 'source') assert.deepEqual(voices.sort(), ['CH0317_Title.ogg', 'ch0317_season_newyear.ogg', 'ch0317_season_xmas.ogg'].sort());
    let config = await page.evaluate(() => window.petHost.getConfig());
    assert.equal(config.scale, 0.75); assert.equal(config.volume, 0.25); assert.equal(config.schemaVersion, 2);
    assert.ok((await page.evaluate(() => window.petHost.packsList())).v2.some(pack => pack.id === 'fixture'));
    // Actual preload -> main IPC -> BrowserWindow delta, with synthetic pointer events.
    const before = await bounds();
    await page.evaluate(() => {
      document.getElementById('pet').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10, screenX: 100, screenY: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, screenX: 110, screenY: 110 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30, screenX: 130, screenY: 120 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    await page.waitForTimeout(100);
    const after = await bounds();
    assert.equal(after.x - before.x, 20); assert.equal(after.y - before.y, 10);
    // Native decode/play promise and advancing media clock; muted for the desktop.
    const audio = await page.evaluate(async () => {
      const audio = new Audio('../voices/CH0317_Title.ogg'); audio.muted = true; await audio.play();
      await new Promise(resolve => setTimeout(resolve, 150));
      const result = { ready: audio.readyState, playing: !audio.paused, time: audio.currentTime }; audio.pause(); return result;
    });
    assert.ok(audio.ready >= 2 && audio.playing && audio.time > 0);
    const opened = app ? app.waitForEvent('window') : browser.contexts()[0].waitForEvent('page'); await page.evaluate(() => window.petHost.openSettings()); const settings = await opened;
    settings.on('pageerror', error => errors.push(error.message));
    await settings.waitForFunction(() => document.querySelector('#serSel option[value="fixture"]'));
    await settings.selectOption('#serSel', 'fixture');
    await settings.waitForFunction(() => document.getElementById('status').textContent.includes('已切换角色'));
    await settings.locator('#scale').fill('1.2'); await settings.locator('#scale').dispatchEvent('input'); await settings.locator('#save').click();
    await settings.waitForFunction(() => document.getElementById('status').textContent.includes('已保存并生效'));
    config = await page.evaluate(() => window.petHost.getConfig()); assert.equal(config.characterId, 'fixture'); assert.equal(config.scale, 1.2);
    await page.waitForFunction(() => document.getElementById('layerBase').src.includes('08.png'));
    await page.screenshot({ path: path.join(evidence, kind + '-pet.png'), omitBackground: true });
    await settings.screenshot({ path: path.join(evidence, kind + '-settings.png') });
    assert.deepEqual(errors, []);
    console.log(kind + ': first launch checks passed; restarting');
    await close(); page = await launch();
    config = await page.evaluate(() => window.petHost.getConfig()); assert.equal(config.characterId, 'fixture'); assert.equal(config.scale, 1.2);
    assert.equal(await fs.readFile(sentinel, 'utf8'), '{"keep":true}');
    return { kind, metadata, legacyMigrated: true, restartPersisted: true, externalChinesePack: true, dragDelta: [20, 10], mutedNativeAudio: audio,
      limitation: 'Programmatic Electron/window assertions and screenshots; physical drag, native tray/menu visual interaction, desktop compositing and audible output not observed.' };
  } finally { await close(); await fs.rm(dir, { recursive: true, force: true }); }
}
async function main() {
  const evidence = path.join(root, '.tmp/v040-regression'); await fs.mkdir(evidence, { recursive: true });
  const selected = process.argv[2];
  const result = { at: new Date().toISOString(), platform: process.platform, mac: 'Not built or run; Windows simulated command/path tests only.' };
  if (!selected || selected === 'browser') result.chromium = await chromiumChecks(evidence);
  for (const kind of ['source', 'directory', 'portable']) if (!selected || selected === kind) {
    result[kind] = await electronChecks(kind, evidence); console.log(kind + ': passed');
  }
  await fs.writeFile(path.join(evidence, (selected || 'all') + '-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
