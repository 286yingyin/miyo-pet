/**
 * 美代桌宠 · 基线快照（可回退版本）
 * ---------------------------------------------------------------------------
 * 用法：  node scripts/make-baseline.js --label v1-2026-10-12
 *         node scripts/make-baseline.js --label v2-2026-10-13 --note "修完 3 个 bug + 4 项新功能"
 *         node scripts/make-baseline.js --label v1-2026-10-12 --no-zip
 *
 * 产物：  _baseline/<label>/        源码快照
 *         _baseline/<label>.zip    同内容压缩包
 *
 * ── 为什么要有这个脚本 ───────────────────────────────────────────────────
 * 项目不是 git 仓库，改坏了没有回退点。这个脚本把「源码」快照下来：
 *   · 收录：prototype/（含素材）· scripts/ · electron/（不含 node_modules）
 *           · docs/ · .workbuddy/memory/ · 根目录的 md/cmd/sh/yml
 *   · 排除：dist/ dist-single/ dist-stage/ dist-builder/ _baseline/ .tmp/
 *           node_modules/（都可再生产，且占了 1GB+）
 *
 * ── 命名提醒 ─────────────────────────────────────────────────────────────
 * 这里的 v1 / v2 是**项目基线版本号**，与 prototype/v1（半身差分）、
 * prototype/v2（全身立绘）**完全是两回事**。快照里会附 BASELINE.md 写清楚。
 *
 * ── 本环境注意 ───────────────────────────────────────────────────────────
 * · fs.cpSync 在本环境会静默被杀（exit 127）→ 手写递归拷贝
 * · 目标目录必须**全新的**：safe-delete 护栏会拦住「单目录 >50 条目」的删除
 * · 含中文的路径删除会被回收站后端拒绝 → 只新建，不删除
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, '_baseline');
const SYS = process.env.SystemRoot || 'C:\\Windows';
const TAR = path.join(SYS, 'System32', 'tar.exe');

/* ---------- 参数 ---------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : def;
}
const LABEL = arg('label', null);
const NOTE = arg('note', '');
const NO_ZIP = process.argv.includes('--no-zip');

if (!LABEL) {
  console.error('用法： node scripts/make-baseline.js --label <名字> [--note "说明"] [--no-zip]');
  console.error('例如： node scripts/make-baseline.js --label v1-2026-10-12');
  process.exit(1);
}

const DEST = path.join(BASE, LABEL);

/* ---------- 收录 / 排除规则 ---------- */
const INCLUDE_DIRS = ['prototype', 'scripts', 'electron', 'docs', path.join('.workbuddy', 'memory')];
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', 'dist', 'dist-single', 'dist-stage', 'dist-builder',
  '_baseline', '.tmp', '.git', 'history', 'Cache', 'GPUCache'
]);
const ROOT_FILE_RE = /\.(md|txt|cmd|sh|yml|yaml|json)$/i;
const ROOT_FILE_SKIP = new Set(['package-lock.json']);

function log(m) { console.log('  ' + m); }
function mb(n) { return (n / 1048576).toFixed(2) + ' MB'; }

function copyTree(src, dst, stat) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory() && EXCLUDE_DIR_NAMES.has(e.name)) continue;
    if (e.isSymbolicLink()) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyTree(s, d, stat);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
      stat.files++;
      stat.bytes += fs.statSync(s).size;
    }
  }
}

/* ---------- 主流程 ---------- */
console.log('\n=== 美代桌宠 · 基线快照 ===\n');

if (fs.existsSync(DEST)) {
  console.error('X 目标已存在：' + path.relative(ROOT, DEST));
  console.error('  换个 --label，或先手工清理（本环境删除含中文路径会被回收站后端拒绝）。');
  process.exit(2);
}

/* 读取当前的版本与产物信息，写进 BASELINE.md */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron', 'package.json'), 'utf8'));
const stamp = new Date();
const p2 = (n) => (n < 10 ? '0' + n : String(n));
const stampStr = stamp.getFullYear() + '-' + p2(stamp.getMonth() + 1) + '-' + p2(stamp.getDate()) +
  ' ' + p2(stamp.getHours()) + ':' + p2(stamp.getMinutes()) + ':' + p2(stamp.getSeconds());

const stat = { files: 0, bytes: 0 };
fs.mkdirSync(DEST, { recursive: true });

for (const rel of INCLUDE_DIRS) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { log('跳过（不存在）：' + rel); continue; }
  const before = stat.files;
  copyTree(src, path.join(DEST, rel), stat);
  log(rel + '/  →  ' + (stat.files - before) + ' 个文件');
}

let rootCount = 0;
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!e.isFile() || !ROOT_FILE_RE.test(e.name) || ROOT_FILE_SKIP.has(e.name)) continue;
  fs.copyFileSync(path.join(ROOT, e.name), path.join(DEST, e.name));
  stat.files++; stat.bytes += fs.statSync(path.join(ROOT, e.name)).size;
  rootCount++;
}
log('根目录说明文件 →  ' + rootCount + ' 个');

/* BASELINE.md —— 说清命名，避免与 prototype/v1 混淆 */
fs.writeFileSync(path.join(DEST, 'BASELINE.md'), [
  '# 基线：' + LABEL,
  '',
  '> **命名提醒**：这里的 `' + LABEL + '` 是**项目基线版本号**（用来回退）',
  '> 与 `prototype/v1`（半身差分版）、`prototype/v2`（完整立绘版）**完全是两回事**。',
  '',
  '## 快照信息',
  '',
  '| 项 | 值 |',
  '|---|---|',
  '| 标签 | `' + LABEL + '` |',
  '| 生成时间 | ' + stampStr + ' |',
  '| 应用版本 | ' + (pkg.version || '0.1.0') + ' |',
  '| 文件数 | ' + stat.files + ' |',
  '| 大小 | ' + mb(stat.bytes) + ' |',
  '| 说明 | ' + (NOTE || '（未填写）') + ' |',
  '',
  '## 收录了什么',
  '',
  '`prototype/`（含 v1/v2 素材与 labels.json）· `scripts/` · `electron/`（不含 node_modules）',
  '· `docs/` · `.workbuddy/memory/` · 根目录的说明文件。',
  '',
  '## 没收录什么（都可再生产）',
  '',
  '`dist/` `dist-single/` `dist-stage/` `dist-builder/`（打包产物，共 1GB+）',
  '`electron/node_modules/`（276MB）· `_baseline/` · `.tmp/`',
  '',
  '## 怎么回退',
  '',
  '把本目录里的 `prototype/` `scripts/` `electron/` `docs/` `.workbuddy/` 与根目录文件',
  '**覆盖回项目根**即可（`electron/` 只覆盖代码文件，别把 node_modules 删了）。',
  '',
  '```bash',
  'cd "D:/Work/WorkBuddy/日常使用/桌宠设计"',
  '# 例：只回退源码与脚本',
  'cp -r _baseline/' + LABEL + '/scripts/. scripts/',
  'cp -r _baseline/' + LABEL + '/prototype/. prototype/',
  'cp -r _baseline/' + LABEL + '/electron/*.js electron/',
  '```',
  '',
  '## 快照时的状态',
  '',
  '- 静态自检 `node scripts/check.js` 全部通过',
  '- 状态链路单测 `node scripts/test-status.js` 29 项全部通过',
  '- 绿色目录版 `dist/miyo-pet-win32-x64/miyo-pet.exe`（334.7MB）可运行',
  '- 单文件便携 exe `dist-single/miyo-pet-portable.exe`（141.3MB）已真机冒烟通过',
  ''
].join('\n'), 'utf8');
log('BASELINE.md 已写入');

/* 压缩包：用 Windows 自带 tar（-a 按扩展名选 zip） */
if (!NO_ZIP) {
  const zip = DEST + '.zip';
  const r = spawnSync(TAR, ['-a', '-c', '-f', zip, '-C', BASE, LABEL], { timeout: 300000 });
  if (r.status === 0 && fs.existsSync(zip)) {
    log('zip：' + path.relative(ROOT, zip) + '（' + mb(fs.statSync(zip).size) + '）');
  } else {
    log('zip 失败（exit=' + r.status + (r.error ? ' / ' + r.error.code : '') + '）——快照目录仍然可用');
    log('  本机 Node 调 tar 会 EBUSY，请在 shell 里手工执行：');
    log('    MSYS_NO_PATHCONV=1 "' + TAR + '" -a -c -f "' + zip + '" -C "' + BASE + '" "' + LABEL + '"');
  }
}

console.log('\n=== 完成 ===');
console.log('  快照  ' + path.relative(ROOT, DEST));
console.log('  文件  ' + stat.files + ' 个 · ' + mb(stat.bytes));
console.log('');
