'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { fileUrlOf, fileUrlOfDir } = require('../electron/platform-paths');
const { browserTools } = require('./helpers/browser-runner');

// A short, synthetic PCM waveform: no third-party voice or account data.
function wave() {
  const samples = 800;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}

test('host_voice_paths_and_file_urls_load_special_characters', async (t) => {
  // Use the shipped Electron Chromium + real preload/IPC, not a browser mock of petHost.
  const moduleId = process.env.MIYO_PLAYWRIGHT_MODULE || 'playwright-core';
  browserTools(); // Same actionable prerequisite diagnostics as the Chromium runner.
  const { _electron } = require(moduleId);
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, '.tmp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, '.tmp', 'miyo-voice-'));
  const portableDir = path.join(dir, '中文 空格 #100%');
  const voiceDir = path.join(portableDir, 'packs', 'voice');
  await fs.mkdir(voiceDir, { recursive: true });
  const voice = path.join(voiceDir, '语音 #50%.wav');
  await fs.writeFile(voice, wave());
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ detect: { enabled: false }, usage: { enabled: false } }));
  const env = { ...process.env, MIYO_USERDATA: dir, MIYO_CONFIG: path.join(dir, 'config.json'), CODEBUDDY_CONFIG_DIR: path.join(dir, 'empty-workbuddy'), PORTABLE_EXECUTABLE_DIR: portableDir };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: require(path.join(root, 'electron/node_modules/electron')), args: [path.join(root, 'electron')], env });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.hide()));
    await page.waitForFunction(() => !!window.MiyoPet);
    await app.evaluate(({ BrowserWindow }, voiceRootUrl) => {
      BrowserWindow.getAllWindows()[0].webContents.send('miyo-config', { voiceRootUrl, voiceMap: {} });
    }, fileUrlOfDir(voiceDir));
    await page.evaluate(() => {
      const NativeAudio = window.Audio;
      window.loadedVoice = null;
      window.Audio = function (src) {
        const audio = new NativeAudio(src);
        window.loadedVoice = { src, ready: false, error: false };
        const current = window.loadedVoice;
        audio.addEventListener('loadeddata', () => { current.ready = true; });
        audio.addEventListener('error', () => { current.error = true; });
        return audio;
      };
    });
    const relative = path.relative(path.join(root, 'prototype/v2'), voice).split(path.sep).map(encodeURIComponent).join('/');
    // All four existing input forms must reach the real audio decoder.
    for (const [name, file] of [
      ['absolute_path_loads', voice],
      ['file_url_is_not_double_encoded', fileUrlOf(voice)],
      ['relative_url_keeps_page_base', relative],
      ['filename_fallback_encodes_special_characters', path.basename(voice)]
    ]) {
      await t.test(name, async () => {
        await app.evaluate(({ BrowserWindow }, file) => {
          BrowserWindow.getAllWindows()[0].webContents.send('miyo-test', { sprs: ['00'], lines: ['fixture'], voice: [file], ms: 3000 });
        }, file);
        await page.waitForFunction(() => window.loadedVoice && (window.loadedVoice.ready || window.loadedVoice.error));
        const actual = await page.evaluate(() => window.loadedVoice);
        assert.equal(fileURLToPath(new URL(actual.src, page.url())), voice);
        assert.equal(actual.error, false, 'special-character voice must decode rather than fail at a truncated or double-encoded URL');
        assert.equal(actual.ready, true);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('miyo-test', { stop: true }));
        await page.evaluate(() => { window.loadedVoice = null; });
      });
    }
    const opened = app.waitForEvent('window');
    await page.evaluate(() => window.petHost.openSettings());
    const settings = await opened;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.hide()));
    const input = settings.locator('input[placeholder^="语音文件名"]').first();
    await input.waitFor({ state: 'attached' });
    await settings.evaluate(() => {
      const NativeAudio = window.Audio;
      window.loadedVoice = null;
      window.Audio = function (src) {
        const audio = new NativeAudio(src);
        window.loadedVoice = { src, ready: false, error: false };
        const current = window.loadedVoice;
        audio.addEventListener('loadeddata', () => { current.ready = true; });
        audio.addEventListener('error', () => { current.error = true; });
        return audio;
      };
    });
    for (const [name, file] of [
      ['settings_absolute_path_loads', voice],
      ['settings_file_url_is_not_double_encoded', fileUrlOf(voice)],
      ['settings_relative_url_keeps_page_base', relative],
      ['settings_filename_fallback_encodes_special_characters', path.basename(voice)]
    ]) {
      await t.test(name, async () => {
        await input.evaluate((input, file) => {
          input.value = file;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.parentElement.querySelector('button').click();
        }, file);
        await settings.waitForFunction(() => window.loadedVoice && (window.loadedVoice.ready || window.loadedVoice.error));
        const actual = await settings.evaluate(() => window.loadedVoice);
        assert.equal(fileURLToPath(new URL(actual.src, settings.url())), voice);
        assert.equal(actual.error, false);
        assert.equal(actual.ready, true);
        await settings.evaluate(() => { window.loadedVoice = null; });
      });
    }
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
