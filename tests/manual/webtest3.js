/* 真机验证：连接差分文件夹 → 枚举其他学生（OPFS 构建真实 FSA 句柄树） */
const { chromium } = require('C:/Users/28679/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/playwright-core');
const URL_ = 'http://127.0.0.1:8399/settings.html';
/* 1x1 红色 PNG */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/28679/.agent-browser/browsers/chrome-155.0.8059.79/chrome.exe', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(URL_);
  await page.waitForTimeout(2000);
  /* 页面内：OPFS 构建 packs 树 + monkey-patch showDirectoryPicker */
  await page.evaluate(async (pngB64) => {
    const root = await navigator.storage.getDirectory();
    async function mkPacks() {
      const packs = await root.getDirectoryHandle('packs', { create: true });
      for (const ver of ['v1', 'v2']) {
        const vDir = await packs.getDirectoryHandle(ver, { create: true });
        const sDir = await vDir.getDirectoryHandle('teststudent', { create: true });
        for (const id of ['00', '01', '02', '05']) {
          const fh = await sDir.getFileHandle(id + '.png', { create: true });
          const w = await fh.createWritable();
          const bin = atob(pngB64), arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          await w.write(arr); await w.close();
        }
      }
      return packs;
    }
    const packsHandle = await mkPacks();
    window.showDirectoryPicker = () => Promise.resolve(packsHandle);
  }, PNG);
  /* 点击连接按钮 */
  await page.click('#galConnect');
  await page.waitForTimeout(2500);
  const res = await page.evaluate(() => ({
    diag: (document.getElementById('galDiag') || {}).textContent,
    series: [...document.querySelectorAll('#gSerSel option')].map((o) => o.value),
    cur: document.getElementById('gSerSel') ? document.getElementById('gSerSel').value : null,
    imgs: document.querySelectorAll('#gallery img').length,
    broken: [...document.querySelectorAll('#gallery img')].filter((i) => i.complete && i.naturalWidth === 0).length,
  }));
  console.log('=== 连接后状态 ===');
  console.log(JSON.stringify(res, null, 2));
  /* 切换系列 */
  if (res.series.length > 1) {
    const other = res.series.find((s) => s !== res.cur) || res.series[1];
    await page.selectOption('#gSerSel', other);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      cur: document.getElementById('gSerSel').value,
      imgs: document.querySelectorAll('#gallery img').length,
      broken: [...document.querySelectorAll('#gallery img')].filter((i) => i.complete && i.naturalWidth === 0).length,
      count: (document.getElementById('galCount') || {}).textContent,
    }));
    console.log('=== 切换系列后 ===');
    console.log(JSON.stringify(after, null, 2));
  }
  console.log('=== 页面错误 (' + errors.length + ') ===');
  errors.slice(0, 5).forEach((e) => console.log(e));
  await page.screenshot({ path: '.tmp/webtest3.png' });
  await browser.close();
  const pass = res.series.some((s) => s === 'teststudent') && res.broken === 0;
  console.log(pass ? '=== PASS ===' : '=== FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('SCRIPT FAIL:', e.message); process.exit(1); });
