const { chromium } = require('C:/Users/28679/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/playwright-core');
const URL_ = 'file:///D:/Work/WorkBuddy/%E6%97%A5%E5%B8%B8%E4%BD%BF%E7%94%A8/%E6%A1%8C%E5%AE%A0%E8%AE%BE%E8%AE%A1/dist-single/settings.html';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/28679/.agent-browser/browsers/chrome-155.0.8059.79/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.goto(URL_);
  await page.waitForTimeout(1500);
  /* 手动探测三个候选路径的真实可达性 */
  const probe = await page.evaluate(async () => {
    function probeImg(src) {
      return new Promise((res) => {
        const im = new Image();
        const t = setTimeout(() => res({ src, ok: false, err: 'timeout' }), 4000);
        im.onload = () => { clearTimeout(t); res({ src, ok: true }); };
        im.onerror = () => { clearTimeout(t); res({ src, ok: false, err: 'onerror' }); };
        im.src = src;
      });
    }
    const cands = ['prototype/v2/', 'miyo-web/', './'];
    const out = [];
    for (const c of cands) out.push(await probeImg(c + 'v2/assets/full_low/00.png'));
    return out;
  });
  console.log('=== 候选路径真实可达性 ===');
  probe.forEach((p) => console.log((p.ok ? 'OK  ' : 'FAIL') + '  ' + p.src + (p.err ? ' (' + p.err + ')' : '')));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
