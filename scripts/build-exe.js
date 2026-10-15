/**
 * 美代桌宠 · 打包脚本（免安装绿色版 exe，零下载）
 * ---------------------------------------------------------------------------
 * 用法：  node scripts/build-exe.js
 * 产物：  dist/miyo-pet-win32-x64/miyo-pet.exe   ← 双击即用
 *
 * 做法：直接复用 electron/node_modules/electron/dist 里已下好的运行时，
 *       改名 exe + 把应用放进 resources/app/（Electron 的标准加载位置）。
 *       —— 不依赖 electron-builder / electron-packager，无需再次联网下载。
 *
 * 目录约定（关键）：resources/app 下保持与项目一致的层级，
 *   这样 main.js 里的 '../scripts/task-status' 与 '../prototype/<版本>/index.html' 才能解析到。
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist');
const OUT_NAME = 'miyo-pet-win32-x64';
let OUT = path.join(ROOT, 'dist', OUT_NAME);
let APP = path.join(OUT, 'resources', 'app');   // ⚠ 必须在 OUT 兜底换目录之后再用（0.2.4 踩坑）

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'package.json'), 'utf8'));

function log(m) { console.log('  ' + m); }
/* 0.3.8：确定性删除 —— fs.rmSync 在文件被占用（僵尸进程/杀软）时失败，
   曾导致构建回退到 -N 目录、canonical 里躺着旧版本（老师运行的一直是旧包！）。
   rmSync 失败后用系统 rd 同步强删（实测可靠），再失败才真正回退 -N。 */
function rm(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e1) { /* 走 rd */ }
  if (fs.existsSync(p)) {
    try {
      require('child_process').execSync('rd /s /q "' + p + '"', { stdio: 'ignore' });
    } catch (e2) { /* ignore */ }
  }
  if (fs.existsSync(p)) throw new Error('无法删除（被占用）：' + p);
}

/* 手写递归拷贝：不用 fs.cpSync —— 它在受限环境里会静默被杀（实测 exit 127） */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/* ---------- 前置检查 ---------- */
if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  console.error('找不到 Electron 运行时：' + ELECTRON_DIST);
  console.error('先在 electron/ 目录执行 npm install。');
  process.exit(1);
}

console.log('\n=== 美代桌宠 · 打包 ===\n');

/* ---------- 1. 清空输出 ----------
   沙箱 safe-delete 会把 rmSync 转成回收站操作；回收站后端对含中文的路径可能失败
   （Some operations were aborted）。删不掉就换一个全新目录（-2、-3…），不硬碰。
   ⚠️ 0.3.5：OUT/packs（exe 旁的外部差分包，老师手动维护）重建前必须暂存、
   重建后放回 —— 否则每次打包都会把老师建的 packs 清掉（0.3.4→0.3.5 实际事故）。 */
let packsStash = null;
const outPacks = path.join(OUT, 'packs');
if (fs.existsSync(outPacks)) {
  packsStash = path.join(ROOT, '.tmp', 'packs-stash');
  try { fs.rmSync(packsStash, { recursive: true, force: true }); } catch (e0) { /* ignore */ }
  try {
    fs.renameSync(outPacks, packsStash);
    log('已暂存外部差分目录 packs/' + '（重建完成后自动放回）');
  } catch (eRename) {
    copyDir(outPacks, packsStash);
    rm(outPacks);
    log('已复制暂存外部差分目录 packs/（重建完成后自动放回）');
  }
}
try {
  rm(OUT);
} catch (e) {
  let n = 2;
  while (fs.existsSync(path.join(ROOT, 'dist', OUT_NAME + '-' + n))) n++;
  OUT = path.join(ROOT, 'dist', OUT_NAME + '-' + n);
  APP = path.join(OUT, 'resources', 'app');
  log('旧目录删不掉（回收站后端），改用全新输出目录：' + path.relative(ROOT, OUT));
}
fs.mkdirSync(OUT, { recursive: true });
log('输出目录 ' + path.relative(ROOT, OUT));
/* 0.3.9：目录一建好就立刻放回外部差分 packs —— 之前放在构建末尾，
   中途任何异常都会导致放回被跳过（packs 连续三轮丢失的根因） */
if (packsStash && fs.existsSync(packsStash)) {
  try {
    copyDir(packsStash, path.join(OUT, 'packs'));
    log('已放回外部差分目录 packs/');
  } catch (eR) {
    log('⚠️ packs 放回失败，暂存保留在 ' + path.relative(ROOT, packsStash));
  }
}

/* ---------- 2. 拷贝 Electron 运行时 ---------- */
copyDir(ELECTRON_DIST, OUT);
log('已拷贝 Electron 运行时（' + pkg.devDependencies.electron + '）');

/* ---------- 3. 卸掉默认应用 ---------- */
const defaultApp = path.join(OUT, 'resources', 'default_app.asar');
if (fs.existsSync(defaultApp)) { fs.rmSync(defaultApp); log('已移除 default_app.asar'); }

/* ---------- 3b. 精简 locales ----------
 * Electron 默认带 55 个语言包（每个 ~0.5–1MB）。这份桌宠只服务中文环境，
 * 留 zh-CN / zh-TW / en-US / en-GB 即可，其余删除后：
 *   · 绿色版体积更小、启动更快；
 *   · 单文件自解压包能过 IExpress —— SED 的文件条目过多时 iexpress 会静默失败
 *     （实测：178 条失败、≤160 条成功）。55 → 4 条是决定性的。 */
const KEEP_LOCALES = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']);
const locDir = path.join(OUT, 'locales');
if (fs.existsSync(locDir)) {
  const all = fs.readdirSync(locDir);
  let removed = 0;
  for (const f of all) {
    if (KEEP_LOCALES.has(f)) continue;
    fs.rmSync(path.join(locDir, f), { force: true });
    removed++;
  }
  log('已精简 locales：' + all.length + ' → ' + (all.length - removed) + ' 个（保留 zh-CN/zh-TW/en-US/en-GB）');
}

/* ---------- 4. 放入应用 ---------- */
fs.mkdirSync(path.join(APP, 'electron'), { recursive: true });
fs.mkdirSync(path.join(APP, 'scripts'), { recursive: true });

['main.js', 'preload.js', 'paths.js', 'platform-paths.js', 'character-packs.js', 'config-store.js', 'icon.png'].forEach((f) => {
  fs.copyFileSync(path.join(ROOT, 'electron', f), path.join(APP, 'electron', f));
});
log('已放入 electron/（main.js / preload.js / paths.js / platform-paths.js / character-packs.js / config-store.js / icon.png）');

/* 状态链路所需的脚本一个都不能少 */
['task-status.js', 'state-core.js', 'approval-status.js', 'change-log.js', 'credits-query.js', 'codex-event.js'].forEach((f) => {
  fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(APP, 'scripts', f));
});
fs.cpSync(path.join(ROOT, 'scripts', 'agents'), path.join(APP, 'scripts', 'agents'), { recursive: true });
log('已放入 scripts/（task-status / state-core / approval-status / change-log / credits-query）');

/* prototype：v1 + v2 都要（右键菜单要能切版本）；跳过只用于开发的文件 */
const SKIP = new Set(['spine-webgl.js', 'render.html', 'preview.html', 'ix-test.js']);
/* 0.3.23：其他学生差分包（packs/*）不入分发产物（版权边界） */
['v1', 'v2'].forEach((v) => {
  const src = path.join(ROOT, 'prototype', v);
  const dst = path.join(APP, 'prototype', v);
  fs.mkdirSync(dst, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach((e) => {
    if (SKIP.has(e.name)) return;
    if (e.isDirectory() && e.name === 'packs') return;   // 0.3.23：其他学生差分包不入分发产物
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
  log('已放入 prototype/' + v);
});

/* 语音目录（台词配音用；老师把 ogg 放这里即可，设置页写 ../voices/xx.ogg 引用） */
{
  const vsrc = path.join(ROOT, 'prototype', 'voices');
  if (fs.existsSync(vsrc)) {
    const vdst = path.join(APP, 'prototype', 'voices');
    /* 0.3.11：根目录 voice/（老师的语音库，14 个 ogg）→ 包内 voice/，
       运行时 voiceRoot 兜底目录（exe 旁 voice/ 优先） */
    /* 内置语音库：voice/（若存在）→ 包内 voice/
       （运行时 voiceMap 兜底目录；exe 旁 packs/voice 优先） */
    [path.join(ROOT, 'voice')].forEach((vroot) => {
      if (!fs.existsSync(vroot)) return;
      const vrdst = path.join(APP, 'voice');
      copyDir(vroot, vrdst);
      log('已放入 voice/（' + fs.readdirSync(vrdst).length + ' 个文件）← ' + path.basename(vroot));
    });
    fs.mkdirSync(vdst, { recursive: true });
    fs.readdirSync(vsrc).forEach((f) => fs.copyFileSync(path.join(vsrc, f), path.join(vdst, f)));
    log('已放入 prototype/voices（' + fs.readdirSync(vdst).length + ' 个文件）');
  }
}

/* 应用自己的 package.json —— main 指向 electron/main.js */
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: 'miyo-pet',
  productName: '美代桌宠',
  version: pkg.version || '0.1.0',
  description: '美代桌宠 · WorkBuddy 状态桌宠',
  main: 'electron/main.js'
}, null, 2), 'utf8');
log('已写入 resources/app/package.json');

/* ---------- 5. exe 改名 ---------- */
const exeOld = path.join(OUT, 'electron.exe');
const exeNew = path.join(OUT, 'miyo-pet.exe');
fs.renameSync(exeOld, exeNew);
log('exe 已改名 → miyo-pet.exe');

/* 顺手放一份启动说明。
   注意：文件名必须是纯 ASCII —— 单文件自解压包的 SED 是 ANSI 文本，
   含中文的文件名会被编码破坏（内容不受影响，只有「文件名」有要求）。 */
fs.writeFileSync(path.join(OUT, 'READ-ME-FIRST.txt'),
  '美代桌宠（免安装版）\r\n' +
  '=====================\r\n\r\n' +
  '1. 双击 miyo-pet.exe 即可运行，无需安装。\r\n' +
  '2. 右键点桌宠 → 「设置…」可调表情映射与大小；' +
  '「模式」可在 v1（半身）与 v2（全身）之间切换。\r\n' +
  '3. 配置文件位于 %APPDATA%\\miyo-pet\\config.json。\r\n' +
  '4. 若窗口出现黑底或起不来：\r\n' +
  '   在命令行里执行： set MIYO_GPU=on  &&  miyo-pet.exe\r\n' +
  '   反之若提示 GPU 进程不可用，则用 set MIYO_GPU=off\r\n' +
  '5. 退出：右键菜单 → 退出，或托盘图标右键 → 退出。\r\n\r\n' +
  '素材版权归 NEXON Games 及官方所有，仅供个人使用，请勿用于商业目的。\r\n',
  'utf8');

/* ---------- 6. 统计 ---------- */
function sizeOf(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return total;
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

/* 0.3.9 兜底：mkdir 后已放回则跳过；这里只处理 stash 仍存在且 OUT/packs 缺失的情况 */
if (packsStash && fs.existsSync(packsStash) && !fs.existsSync(path.join(OUT, 'packs'))) {
  try {
    copyDir(packsStash, path.join(OUT, 'packs'));
    fs.rmSync(packsStash, { recursive: true, force: true });
    log('已放回外部差分目录 packs/（兜底路径）');
  } catch (eP) {
    log('⚠️ 外部差分目录放回失败，暂存在 ' + path.relative(ROOT, packsStash));
  }
}

/* 0.3.18：导出设置页网页端 —— exe 旁 settings.html，浏览器直接打开即可
   管理配置与预设（localStorage 后端，版本号注入副本） */
try {
  let web = fs.readFileSync(path.join(ROOT, 'prototype', 'v2', 'settings.html'), 'utf8');
  web = web.replace('__WEB_VERSION__', pkg.version);
  web = web.replace("'__WEB_ONLY__' === 'true'", 'true');   // 导出副本 = 差分专用浏览页
  fs.writeFileSync(path.join(OUT, 'settings.html'), web);
  /* 0.3.21：美代差分副本 → packs/miyo/{v1,v2}（与老师手动添加的学生同构，
     网页端连接 packs 一次即可枚举全部学生含美代；miyo-web 探针仍保留兜底） */
  try {
    copyDir(path.join(ROOT, 'prototype', 'v2', 'assets', 'full_low'),
            path.join(OUT, 'packs', 'miyo', 'v2'));
    copyDir(path.join(ROOT, 'prototype', 'v1', 'assets', 'spr'),
            path.join(OUT, 'packs', 'miyo', 'v1'));
    fs.writeFileSync(path.join(OUT, 'packs', 'miyo', 'manifest.json'),
      JSON.stringify({ label: '美代（内置）' }, null, 2));
    log('已内置差分包 packs/miyo/（v1 spr + v2 full_low，网页端连接即可见）');
  } catch (eR) { log('⚠️ packs/miyo 复制失败：' + eR.message); }
  /* miyo-web 探针兜底保留 */
  try {
    copyDir(path.join(ROOT, 'prototype', 'v2', 'assets', 'full_low'),
            path.join(OUT, 'miyo-web', 'v2', 'assets', 'full_low'));
    copyDir(path.join(ROOT, 'prototype', 'v1', 'assets', 'spr'),
            path.join(OUT, 'miyo-web', 'v1', 'assets', 'spr'));
  } catch (eR2) { /* 探针兜底失败不致命 */ }
  log('已导出设置页网页端 settings.html（exe 旁，浏览器直接打开）');
  log('导出验证 existsSync: ' + fs.existsSync(path.join(OUT, 'settings.html'))
    + ' | packs/miyo: ' + fs.existsSync(path.join(OUT, 'packs', 'miyo', 'manifest.json')));
} catch (eW) { log('⚠️ settings.html 网页端导出失败：' + eW.message); }

console.log('\n=== 完成 ===');
console.log('  产物   ' + path.relative(ROOT, path.join(OUT, 'miyo-pet.exe')));
console.log('  总体积 ' + mb(sizeOf(OUT)));
console.log('  应用   ' + mb(sizeOf(APP)) + '（prototype + 主进程）');
console.log('  运行时 ' + mb(sizeOf(OUT) - sizeOf(APP)) + '（Electron 自身）');
console.log('');
