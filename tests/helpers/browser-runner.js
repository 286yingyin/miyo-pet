'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Keep the browser an explicit test prerequisite; no product runtime dependency.
function browserTools() {
  const moduleId = process.env.MIYO_PLAYWRIGHT_MODULE || 'playwright-core';
  let chromium;
  try { ({ chromium } = require(moduleId)); }
  catch (e) { throw new Error('Install playwright-core for tests or set MIYO_PLAYWRIGHT_MODULE to its module directory.', { cause: e }); }
  const candidates = [
    process.env.MIYO_BROWSER_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'
  ];
  const executablePath = candidates.find((file) => file && fs.existsSync(file));
  return { chromium, executablePath };
}

async function serveRepository() {
  const root = path.resolve(__dirname, '../..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg' };
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
    catch (e) { res.writeHead(400).end(); return; }
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(bytes);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}
module.exports = { browserTools, serveRepository };
