'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browserTools, serveRepository } = require('./helpers/browser-runner');

test('scale_5_is_applied_after_scale_2', async () => {
  const { chromium, executablePath } = browserTools();
  const server = await serveRepository();
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Only emulate Electron IPC delivery; the real document and applyConfig run in Chromium.
    await page.addInitScript(() => {
      window.petHost = { onState() {}, onConfig(callback) { window.applyHostConfig = callback; } };
    });
    await page.goto(server.url + '/prototype/v2/index.html');
    await page.waitForFunction(() => typeof window.applyHostConfig === 'function');
    async function scale(value) {
      return page.evaluate((value) => {
        window.applyHostConfig({ scale: value });
        return getComputedStyle(document.documentElement).getPropertyValue('--pet-scale').trim();
      }, value);
    }
    assert.equal(await scale(2), '2');
    assert.equal(await scale(5), '5', 'a valid 5x host setting must replace the earlier 2x page scale');
    assert.equal(await scale(0.5), '0.5');
    assert.equal(await scale(0.4), '0.5', 'out-of-range settings must not lower the page below host minimum');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
