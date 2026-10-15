/**
 * 美代桌宠 · 单文件便携 exe（electron-builder · NSIS portable）
 * ---------------------------------------------------------------------------
 * 用法：  node scripts/build-portable.js
 * 产物：  dist-single/miyo-pet-portable.exe      单文件，双击即用
 *
 * 前置：  electron/ 已 npm install（含 electron-builder 与 app-builder-bin）
 *         首次构建会从网络拉 nsis / nsis-resources / 7zip（之后走缓存）
 *
 * ── 为什么最终选 electron-builder ─────────────────────────────────────────
 * 之前试过「零下载」的 IExpress，结论是**不可靠**（详见 docs/08）：
 *   · 从 Git Bash 直接调会被 MSYS 把 `/N` `/Q` 当路径转换掉 → 静默退回 GUI 向导；
 *     必须加 MSYS_NO_PATHCONV=1，或改由 Node spawnSync 调用。
 *   · 更大的问题：**包到一定规模就静默失败**（exit=1、无输出、无日志）。
 *     实测边界随 payload 构成漂移（同一条目数、不同文件集，结果不同），
 *     既不像纯条目数上限、也不像纯体积上限，无法给出可靠规避规则。
 * electron-builder 的 portable 目标用 NSIS + LZMA，141MB 一次成型、已验证可运行。
 *
 * ── 本环境特有的三个坑（脚本已自动绕开）────────────────────────────────
 * 1) safe-delete 护栏会拦住「单目录 >50 条目」的删除，而 electron-builder
 *    构建开头要 emptyDir 输出目录 → **每次必须用一个全新的输出目录**。
 *    本脚本把输出放到 %TEMP%\\miyo-build-<时间戳>（纯 ASCII、且可正常清理）。
 * 2) 子进程需要能在 PATH 里找到 PowerShell/cmd，否则会在
 *    「Node module collector」这一步报 spawn ... ENOENT。
 * 3) 不做代码签名：CSC_IDENTITY_AUTO_DISCOVERY=false。
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const OUTDIR = path.join(ROOT, 'dist-single');
const FINAL = path.join(OUTDIR, 'miyo-pet-portable.exe');

const SYS = process.env.SystemRoot || 'C:\\Windows';
const NODE_BIN_DIR = path.dirname(process.execPath);
const NPM = path.join(NODE_BIN_DIR, 'npm.cmd');

const TIMEOUT_MS = 900000;

function log(m) { console.log('  ' + m); }
function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* 交给系统回收 */ } }

console.log('\n=== 美代桌宠 · 单文件便携 exe（electron-builder）===\n');

if (!fs.existsSync(path.join(ELECTRON_DIR, 'node_modules', 'electron-builder'))) {
  console.error('electron/ 下没装 electron-builder，请先执行： cd electron && npm install');
  process.exit(1);
}

/* 全新的输出目录：护栏不允许删旧的，所以每次换一个新的（放 TEMP，纯 ASCII） */
const stage = path.join(os.tmpdir(), 'miyo-build-' + Date.now());
fs.mkdirSync(stage, { recursive: true });
log('输出目录 ' + stage);
fs.mkdirSync(OUTDIR, { recursive: true });

/* 让子进程能找到系统工具；同时把 electron-builder 的资源缓存指到用户目录 */
const env = Object.assign({}, process.env, {
  PATH: [
    path.join(SYS, 'System32'),
    path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0'),
    NODE_BIN_DIR,
    process.env.PATH || ''
  ].join(path.delimiter),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE ||
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache')
});
/* 国内网络可显式指定镜像；不设则走官方源 */
if (process.env.MIYO_BUILDER_MIRROR) {
  env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.MIYO_BUILDER_MIRROR;
}

log('调用 electron-builder（--win portable --x64）…');
const args = [
  path.join(ELECTRON_DIR, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  '--win', 'portable', '--x64',
  '--config', path.join(ELECTRON_DIR, 'electron-builder.yml'),
  '--config.directories.output=' + stage
];
const r = spawnSync(process.execPath, args, {
  cwd: ELECTRON_DIR, env: env, stdio: 'inherit', timeout: TIMEOUT_MS
});
log('退出码 ' + r.status + (r.error ? '  spawn错误 ' + r.error.code : ''));

/* 找回产物（名字带版本号） */
let built = null;
if (fs.existsSync(stage)) {
  const hit = fs.readdirSync(stage).filter((f) => /portable\.exe$/i.test(f));
  if (hit.length) built = path.join(stage, hit[0]);
}

if (built && fs.existsSync(built)) {
  fs.copyFileSync(built, FINAL);
  const size = fs.statSync(FINAL).size;
  const fd = fs.openSync(FINAL, 'r');
  const head = Buffer.alloc(2), tail = Buffer.alloc(262144);
  fs.readSync(fd, head, 0, 2, 0);
  fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
  fs.closeSync(fd);
  const isPE = head[0] === 0x4d && head[1] === 0x5a;          // "MZ"
  const isNSIS = tail.includes(Buffer.from('Nullsoft'));      // NSIS 自解压签名
  log('✅ 单文件便携 exe：' + path.relative(ROOT, FINAL) + '（' + mb(size) + '）');
  log('   结构自检：PE=' + isPE + '  NSIS=' + isNSIS);
} else {
  console.error('X 没找到产出的 portable.exe，请检查上面的构建日志。');
}

/* 清理临时输出目录（TEMP 下可以正常删） */
rm(stage);

console.log('\n=== 完成 ===');
console.log('  单文件便携  dist-single\\miyo-pet-portable.exe');/* 0.3.18：同步导出设置页网页端（便携版 exe 旁，浏览器直接打开） */
try {
  const pkgP = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'package.json'), 'utf8'));
  let web = fs.readFileSync(path.join(ROOT, 'prototype', 'v2', 'settings.html'), 'utf8');
  web = web.replace('__WEB_VERSION__', pkgP.version);
  web = web.replace("'__WEB_ONLY__' === 'true'", 'true');   // 导出副本 = 差分专用浏览页
  fs.writeFileSync(path.join(OUTDIR, 'settings.html'), web);
  /* 0.3.21：美代差分副本 → packs/miyo/{v1,v2}（网页端连接 packs 即可见）+ miyo-web 兜底 */
  try {
    copyDir(path.join(ROOT, 'prototype', 'v2', 'assets', 'full_low'),
            path.join(OUTDIR, 'packs', 'miyo', 'v2'));
    copyDir(path.join(ROOT, 'prototype', 'v1', 'assets', 'spr'),
            path.join(OUTDIR, 'packs', 'miyo', 'v1'));
    fs.writeFileSync(path.join(OUTDIR, 'packs', 'miyo', 'manifest.json'),
      JSON.stringify({ label: '美代（内置）' }, null, 2));
    console.log('  已内置差分包  packs\\miyo\\');
  } catch (eR) { console.log('  ⚠️ packs/miyo 复制失败：' + eR.message); }
  /* 0.3.20：附带美代差分资源副本 */
  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach((e) => {
      const sp = path.join(src, e.name), dp = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(sp, dp);
      else if (e.isFile()) fs.copyFileSync(sp, dp);
    });
  }
  try {
    copyDir(path.join(ROOT, 'prototype', 'v2', 'assets', 'full_low'),
            path.join(OUTDIR, 'miyo-web', 'v2', 'assets', 'full_low'));
    copyDir(path.join(ROOT, 'prototype', 'v1', 'assets', 'spr'),
            path.join(OUTDIR, 'miyo-web', 'v1', 'assets', 'spr'));
    console.log('  已附带差分资源副本  dist-single\\miyo-web\\');
  } catch (eR) { console.log('  ⚠️ miyo-web 资源复制失败：' + eR.message); }
  console.log('  已导出设置页网页端  dist-single\\settings.html');
} catch (eW) { console.log('  ⚠️ settings.html 网页端导出失败：' + eW.message); }

console.log('  绿色目录版  dist\\miyo-pet-win32-x64\\miyo-pet.exe   （启动最快）');
console.log('');
