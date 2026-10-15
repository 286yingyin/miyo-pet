/* 真机诊断脚本：playwright-core + agent-browser 的 Chrome 打开网页端设置页 */
const path = require('path');
const { chromium } = require('C:/Users/28679/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/playwright-core');
const EXE = 'C:/Users/28679/.agent-browser/browsers/chrome-155.0.8059.79/chrome.exe';
const URL_ = 'file:///D:/Work/WorkBuddy/%E6%97%A5%E5%B8%B8%E4%BD%BF%E7%94%A8/%E6%A1%8C%E5%AE%A0%E8%AE%BE%E8%AE%A1/dist-single/settings.html';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 200)));
  await page.goto(URL_);
  await page.waitForTimeout(2500);
  const diag = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#gallery img')];
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0);
    return {
      webMode: typeof WEB_MODE !== 'undefined' ? WEB_MODE : 'undef',
      webOnly: typeof WEB_ONLY !== 'undefined' ? WEB_ONLY : 'undef',
      webAssets: typeof WEB_ASSETS !== 'undefined' ? WEB_ASSETS : 'undef',
      webVoice: typeof WEB_VOICE !== 'undefined' ? WEB_VOICE : 'undef',
      fsaSupported: typeof window.showDirectoryPicker === 'function',
      bodyClass: document.body.className,
      galleryCount: imgs.length, brokenCount: broken.length,
      firstBrokenSrc: broken.length ? broken[0].getAttribute('src') : null,
      galDiag: (document.getElementById('galDiag') || {}).textContent || null,
      galConnectVisible: !!(document.getElementById('galConnect') && document.getElementById('galConnect').style.display !== 'none'),
    };
  });
  console.log('=== 真机诊断 ===');
  console.log(JSON.stringify(diag, null, 2));
  console.log('=== 控制台错误 (' + errors.length + ') ===');
  errors.slice(0, 8).forEach((e) => console.log(e));
  await page.screenshot({ path: '.tmp/webtest-1.png', fullPage: false });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SCRIPT FAIL:', e.message); process.exit(1); });
