/**
 * 美代桌宠 · Electron 主进程
 * ---------------------------------------------------------------------------
 * 状态链路：来源适配器 → Agent hub（进程内单调 rev）→ toPetState → miyo-state IPC。
 * WorkBuddy 适配器拥有 watcher、350ms 去抖、300ms 收敛与 2s 轮询；禁用时全部释放。
 * 来源 health 与任务 phase 分离；页面只按 completionKey 提示完成。
 * 整点计时独立于来源，积分查询仅在 WorkBuddy 采集开启时运行。
 *
 * 其他： 透明置顶窗口 · 右键原生菜单 · 设置窗口 · 系统托盘 · 变化记录 JSONL
 * 运行： 用同目录 run.cmd / run.sh（会先清掉 ELECTRON_RUN_AS_NODE）
 * ---------------------------------------------------------------------------
 */
'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, powerMonitor, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const paths = require('./paths');
const packs = require('./character-packs');
const store = require('./config-store');
const { createHub } = require(path.join(paths.appRoot(), 'scripts/agents/hub'));
const { createAdapter } = require(path.join(paths.appRoot(), 'scripts/agents/workbuddy'));
const { toPetState } = require(path.join(paths.appRoot(), 'scripts/agents/schema'));
const changeLog = require(paths.changeLog());

/* ------------------------------------------------------------------
   运行环境兼容（两个坑，都实测踩过）
   1. ELECTRON_RUN_AS_NODE=1 时 require('electron') 退化成普通 Node 模块，
      主进程拿不到 app/ipcMain → 用 run.cmd / run.sh 启动（会清空该变量）
   2. 无可用 GPU 的环境里 GPU 进程会反复退出并 FATAL → 默认软件渲染，
      想用硬件加速设 MIYO_GPU=on；受限会话可能还需 MIYO_NO_SANDBOX=1
   ------------------------------------------------------------------ */
if ((process.env.MIYO_GPU || 'off').toLowerCase() !== 'on') {
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
}
if (process.env.MIYO_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox');
}
/* 语音自动播放：桌宠播台词语音时没有用户手势，需放开 Chromium 的 autoplay 限制 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* userData 钉成 ASCII 路径（打包版设了中文 productName 也不会偏移） */
try {
  app.setPath('userData', process.env.MIYO_USERDATA || path.join(app.getPath('appData'), 'miyo-pet'));
} catch (e) {
  console.log('[miyo-pet] userData 设置失败 ' + e.message);
}

const platformPaths = paths.resolvePaths({
  platform: process.platform,
  userDataDir: app.getPath('userData'),
  appRoot: paths.appRoot(),
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  exeDir: path.dirname(app.getPath('exe')),
  isPackaged: app.isPackaged
});

/* 窗口尺寸按「显示模式」区分：
   —— v1 是 948×948 的正方形半身差分，桌面基准宽 300px；必须给它更宽更矮的窗口，
      否则 300px 的桌宠塞进 240px 宽的窗口会被横向裁掉（这就是「半身显示不全」的根因）。
   —— v2 是 905×2477 的竖长全身立绘，沿用原来的 240×620。
   petW 必须与页面 CSS 里的 --pet-w 一致（check.js 有断言防漂移）。 */
const WIN_BY_MODE = {
  v1: { w: 320, h: 420, petW: 300 },
  v2: { w: 240, h: 620, petW: 196 }
};
const MIN_SCALE = 0.5;   // 0.3.3 取消每学生倍率后统一一套；范围放大适配不同立绘（0.3.5）
const MAX_SCALE = 5;     // 0.3.10：上限 5×（老师要求由 10 调整）
let win = null;
let settingsWin = null;
let tray = null;
let prevSnap = null;
let log = null;
let agentHub = null;
let agentSettingsKey = null;
let hourlyTimer = null;

/* =======================================================
   配置
   ======================================================= */
function defaults() {
  return {
    _v: 1,                     // 配置版本号：用于一次性迁移（见 migrateConfig）
    mode: 'v2',
    alwaysOnTop: true,
    scale: 1,
    scope: 'current',          // current | all
    dropStale: true,           // 「全部会话」下不计入 7 天前的历史残留
    showApproval: true,        // 是否显示「待批准」提示
    approvalTtlMs: 30 * 60 * 1000,

    /* 胶囊显隐（true=显示）。隐藏是「整行消失」，与「数值为 0 变灰」不是一回事。 */
    pillVisible: { working: true, asking: true, idle: true, conversations: true, scope: true },
    convWindowMs: 120000,      // 「进行中对话」的心跳新鲜窗口

    /* 今日消耗积分：本轮暂缓接入（Electron 33 内置 Node 20 没有 node:sqlite）。
       字段先留好，将来读 workbuddy.db 的 session_usage.credit_json 按 updated_at 归今日求和。 */
    usage: { enabled: false, cacheMs: 60000, dbPath: '' },

    /* 说话气泡的位置与大小 */
    bubble: { width: 196, fontScale: 1, offsetX: 0, offsetY: 0, align: 'right' },

    /* 每个状态的自定义台词（空 = 用内置台词 lineFor） */
    lines: { v1: {}, v2: {} },
    /* 语音通道：{ mode: [{ file:'<语音文件路径>', text:'<文本>' }] }。
       相对页面路径（如 ../voices/xx.ogg）或绝对路径均可；只考虑 ogg。 */
    voices: { v1: {}, v2: {} },

    /* 互动反应自定义：结构与页面内置 REACT 表同构，line 换成 lines[]（多条轮播）。
       空项 = 用内置。click 是 8 级递进的数组。 */
    reacts: { v1: {}, v2: {} },

    /* 台本系统（0.2.4）：scripts[ver][mode] = [ { voice, weight, lines:[{text, spr, sec}] } ]。
       状态触发时按 weight 随机选台本，顺序播放：每行 = 台词 + 差分 + 显示秒数。
       播完歇 scriptRestMs 再按权重重播，直到状态变化。空 = 用现有行为。 */
    scripts: { v1: {}, v2: {} },

    /* 闲置差分（0.2.12 重写）：idleSprs[ver][mode] = [差分id,…]。
       完全待机（闲置族状态、无台词/提醒/播报/互动）时显示并按 idleSprMs 轮换；
       仅闲置族状态（idle/idle_5/idle_15/idle_30）有效。旧 restSprs（单值）自动迁移。 */
    restSprs: { v1: {}, v2: {} },
    idleSprs: { v1: {}, v2: {} },
    idleSprMs: 7 * 1000,
    /* 闲置状态特效（0.2.16）：眨眼（开关/差分/间隔）与立绘摇晃（开关/方向/幅度/周期）。
       数值与 spr 的钳制在桌宠页 clean 时做，这里只保结构。 */
    idleBlink: { v1: {}, v2: {} },
    idleSway: { v1: {}, v2: {} },
    idleBreathe: { v1: {}, v2: {} },
    /* 省内存立绘（0.3.1）：默认 true（400px 副本） */
    lowMem: true,
    /* WorkBuddy 状态检测开关（0.3.2）：总开关 + 分类 */
    detect: { enabled: true, approval: true, working: true, pending: true },
    /* 差分系列（0.3.2）：packs 目录名，'miyo' = 默认 */
    series: 'miyo',
    /* 0.3.5：取消每学生倍率 —— 所有学生共用 cfg.scale 一套 */
    /* 胶囊文案自定义（0.2.16）：{n}/{secs}/{scope} 变量；缺省键走桌宠页内置默认 */
    pillText: {},
    /* 默认轮播间隔（0.2.13）：隐式台本0 每行秒数 + 默认差分轮播共用（设置页可调） */
    stateCycleMs: 7 * 1000,
    idleSecs: { idle_5: 300, idle_15: 900, idle_30: 1800 },
    scriptRestMs: 60 * 1000,

    /* 语音播放音量（0~1） */
    volume: 1,

    /* 整点播报：{ "9": { on:true, lines:[], sprs:[], voice:null, ms:12000, scripts:[] } }
       0.2.9：scripts 非空时走台本引擎（一次性播完），旧字段作为回落。 */
    hourly: { v1: {}, v2: {} },
    hourlyGraceMs: 10 * 60 * 1000,   // 整点后多久之内还补播，超过只记账不播

    /* 待办提醒（0.2.9）：[ { id, name, hh, mm, freq:'once'|'daily'|'weekly', days:[0-6],
       enabled, done, lastFired:'YYYY-M-D', scripts:[台本], ackScripts:[台本] } ]
       到点播提醒台本并循环，单击桌宠确认后播确认台本结束；调度在渲染层（心跳逐分检查）。 */
    reminders: [],

    mapping: {
      v1: { idle: ['00', '01'], processing: ['13'], pending: ['21'],
            approval: ['21'], done: ['13'], error: ['06'] },
      v2: { idle: ['Idle_01', '01'], processing: ['36'], pending: ['24'],
            approval: ['24', '21'], done: ['13'], error: ['33'],
            idle_5: ['20'], idle_15: ['18'], idle_30: ['16'] }
    }
  };
}

function configFile() {
  /* Mac config stays under userData even if a legacy per-file override is set. */
  return (process.platform !== 'darwin' && process.env.MIYO_CONFIG) || path.join(platformPaths.configDir, 'config.json');
}

let cfg = null;

function merge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = base;
  Object.keys(patch).forEach(function (k) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = merge(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  });
  return out;
}

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

/* 0.3.5 外部 packs 根（exe 同目录）候选：
   ①便携版：PORTABLE_EXECUTABLE_DIR（electron-builder portable 解压后指向 exe 所在目录）；
   ②绿色版：exe 同目录。都找不到（dev）→ 只剩内置。 */
function packsRootDirs() {
  return platformPaths.packRoots.slice();
}
function fileUrlOfDir(d) {
  try { return paths.fileUrlOfDir(d); }
  catch (e) { return ''; }
}
function extractExternalZips(root) {
  [root, path.join(root, 'v1'), path.join(root, 'v2')].forEach(function (base) {
    let zips = [];
    try { zips = fs.readdirSync(base).filter((f) => /\.zip$/i.test(f)); } catch (e) { return; }
    zips.forEach(function (z) {
      const name = z.replace(/\.zip$/i, '');
      const zPath = path.join(base, z);
      const outDir = path.join(base, name);
      try {
        if (fs.existsSync(outDir)) return;
        fs.mkdirSync(outDir, { recursive: true });
        require('child_process').execFileSync('tar', ['-xf', zPath, '-C', outDir], { stdio: 'ignore', timeout: 300000 });
      } catch (e) { /* 解压失败忽略 */ }
    });
  });
}
function normalizeConfig() {
  cfg.scale = clampNum(cfg.scale, MIN_SCALE, MAX_SCALE, 1);
  if (cfg.mode !== 'v1' && cfg.mode !== 'v2') cfg.mode = 'v2';
  /* 这里原来写的是 `cfg.scope !== 'v1'` —— 从上一行的 mode 判断复制过来的笔误。
     scope 只可能是 current|all，写成 'v1' 之后这个条件恒为真，虽然碰巧结果一样，
     但语义是错的，已改正。 */
  if (cfg.scope !== 'current' && cfg.scope !== 'all') cfg.scope = 'current';
  cfg.alwaysOnTop = !!cfg.alwaysOnTop;
  cfg.dropStale = cfg.dropStale !== false;
  cfg.showApproval = cfg.showApproval !== false;
  cfg.approvalTtlMs = clampNum(cfg.approvalTtlMs, 1000, 24 * 3600 * 1000, 30 * 60 * 1000);
  cfg.convWindowMs = clampNum(cfg.convWindowMs, 5000, 3600 * 1000, 120000);
  cfg.hourlyGraceMs = clampNum(cfg.hourlyGraceMs, 0, 3600 * 1000, 10 * 60 * 1000);

  /* --- 嵌套对象：兜底成合法结构，别让页面对 undefined 取值 --- */
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  cfg.pillVisible = Object.assign({ working: true, asking: true, idle: true, conversations: true, scope: true }, obj(cfg.pillVisible));
  Object.keys(cfg.pillVisible).forEach((k) => { cfg.pillVisible[k] = cfg.pillVisible[k] !== false; });
  cfg.usage = Object.assign({ enabled: false, cacheMs: 60000, dbPath: '' }, obj(cfg.usage));
  cfg.bubble = Object.assign({ width: 196, fontScale: 1, offsetX: 0, offsetY: 0, align: 'right',
    name: cfg.characterLabel || '', scale: 1, nameScale: 1,
    bg: '#ffffff', bgOpacity: 1, borderColor: '',
    nameColor: '', textColor: '', nameFont: '', textFont: '' }, obj(cfg.bubble));
  cfg.bubble.width = clampNum(cfg.bubble.width, 120, 420, 196);
  cfg.bubble.fontScale = clampNum(cfg.bubble.fontScale, 0.5, 2.5, 1);
  cfg.bubble.offsetX = clampNum(cfg.bubble.offsetX, -200, 200, 0);
  cfg.bubble.offsetY = clampNum(cfg.bubble.offsetY, -80, 200, 0);
  if (['left', 'center', 'right'].indexOf(cfg.bubble.align) < 0) cfg.bubble.align = 'right';
  /* 0.3.1 气泡外观：整体缩放 / 相对字号 / 颜色与字体。颜色只收 #hex 或空串（空 = 走主题） */
  cfg.bubble.scale = clampNum(cfg.bubble.scale, 0.5, 2.5, 1);
  cfg.bubble.nameScale = clampNum(cfg.bubble.nameScale, 0.5, 2.5, 1);
  cfg.bubble.bgOpacity = clampNum(cfg.bubble.bgOpacity, 0.1, 1, 1);
  cfg.bubble.name = String(cfg.bubble.name || cfg.characterLabel || '').trim().slice(0, 20);
  ['bg', 'borderColor', 'nameColor', 'textColor', 'nameFont', 'textFont'].forEach((k) => {
    if (typeof cfg.bubble[k] !== 'string') { cfg.bubble[k] = ''; return; }
    cfg.bubble[k] = cfg.bubble[k].trim().slice(0, 120);
    if (/^#[0-9a-fA-F]{3,8}$/.test(cfg.bubble[k]) || k.indexOf('Font') >= 0) return;  // hex 或字体原样
    cfg.bubble[k] = '';
  });
  /* 省内存立绘（0.3.1）：默认 true（400px 副本），false = 用原图 */
  cfg.lowMem = cfg.lowMem !== false;
  /* 检测开关（0.3.2）：只收布尔，缺省 true */
  cfg.detect = obj(cfg.detect);
  ['enabled', 'approval', 'working', 'pending'].forEach((k) => {
    if (typeof cfg.detect[k] !== 'boolean') cfg.detect[k] = true;
  });
  /* 胶囊位置/大小（0.3.6） */
  cfg.pillPos = obj(cfg.pillPos);
  cfg.pillPos.dx = clampNum(cfg.pillPos.dx, -400, 400, 0);
  cfg.pillPos.dy = clampNum(cfg.pillPos.dy, -400, 400, 0);
  cfg.pillPos.scale = clampNum(cfg.pillPos.scale, 0.6, 1.8, 1);
  const pack = packRegistry.find(p => p.id === cfg.characterId);
  cfg.packIds = { v1: [], v2: [] };
  cfg.packFileUrl = { v1: {}, v2: {} };
  cfg.packUrl = { v1: '', v2: '' };
  cfg.packDefaultId = { v1: '', v2: '' };
  for (const v of ['v1', 'v2']) {
    const mode = pack && pack.modes[v];
    if (!mode) continue;
    cfg.packIds[v] = Object.keys(mode.sprites).sort();
    cfg.packFileUrl[v] = Object.fromEntries(Object.entries(mode.sprites).map(([id, file]) => [id, paths.fileUrlOf(file)]));
    cfg.packUrl[v] = fileUrlOfDir(mode.rootDir);
    cfg.packDefaultId[v] = mode.defaultSpriteId;
  }
  cfg.configError = !pack || !pack.modes[cfg.mode] ? 'PACK_MODE_UNAVAILABLE' : null;
  cfg.packsRoot = packsRootDirs()[0] || '';
  cfg.packsRootUrl = cfg.packsRoot ? fileUrlOfDir(cfg.packsRoot) : '';
  const roots = pack ? [...new Set(Object.values(pack.modes).filter(Boolean).map(m => m.rootDir))] : [];
  const voiceDirs = roots.map(root => path.join(root, 'voice'));
  if (cfg.characterId === 'miyo') voiceDirs.push(...packsRootDirs().map(r => path.join(r, 'voice')), path.join(paths.appRoot(), 'voice'));
  cfg.voiceDirs = voiceDirs;
  cfg.voiceMap = {};
  for (const dir of voiceDirs) {
    try { for (const f of fs.readdirSync(dir)) if (/\.ogg$/i.test(f)) {
      const url = paths.fileUrlOf(path.join(dir, f));
      if (!cfg.voiceMap[f]) cfg.voiceMap[f] = url;
      if (!cfg.voiceMap[f.replace(/\.ogg$/i, '')]) cfg.voiceMap[f.replace(/\.ogg$/i, '')] = url;
    } } catch (_) { /* optional voice directory */ }
  }
  cfg.voiceRoot = voiceDirs.find(d => fs.existsSync(d)) || '';
  cfg.voiceRootUrl = cfg.voiceRoot ? fileUrlOfDir(cfg.voiceRoot) : '';
  ['lines', 'voices', 'hourly', 'mapping', 'reacts', 'scripts', 'restSprs', 'idleSprs', 'idleBlink', 'idleSway', 'idleBreathe'].forEach((k) => {
    cfg[k] = obj(cfg[k]);
    cfg[k].v1 = obj(cfg[k].v1);
    cfg[k].v2 = obj(cfg[k].v2);
  });
  /* 胶囊文案（0.2.16）：只留字符串值并限长 */
  cfg.pillText = obj(cfg.pillText);
  Object.keys(cfg.pillText).forEach((k) => {
    if (typeof cfg.pillText[k] !== 'string') delete cfg.pillText[k];
    else cfg.pillText[k] = cfg.pillText[k].slice(0, 120);
  });
  /* 旧 restSprs（0.2.8 单值）→ idleSprs（0.2.12 数组）迁移：只补缺，不删旧键
     （设置页保存时会清掉旧键；桌宠页对旧键也有读取兼容） */
  ['v1', 'v2'].forEach((v) => {
    const legacy = cfg.restSprs[v] || {};
    Object.keys(legacy).forEach((mode) => {
      const cur = cfg.idleSprs[v];
      if (!Array.isArray(cur[mode]) && legacy[mode]) cur[mode] = [legacy[mode]];
    });
  });
  cfg.volume = clampNum(cfg.volume, 0, 1, 1);
  cfg.scriptRestMs = clampNum(cfg.scriptRestMs, 0, 3600 * 1000, 60 * 1000);
  cfg.idleSprMs = clampNum(cfg.idleSprMs, 1000, 60000, 7 * 1000);
  cfg.stateCycleMs = clampNum(cfg.stateCycleMs, 1000, 60000, 7 * 1000);
  /* 待办提醒（0.2.9）：结构兜底 —— 时间不合法的整条丢弃，其余字段逐项纠正 */
  cfg.reminders = (Array.isArray(cfg.reminders) ? cfg.reminders : []).filter((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const hh = parseInt(r.hh, 10), mm = parseInt(r.mm, 10);
    return isFinite(hh) && hh >= 0 && hh <= 23 && isFinite(mm) && mm >= 0 && mm <= 59;
  }).map((r) => ({
    id: String(r.id || ('r' + Date.now())),
    name: String(r.name == null ? '' : r.name).slice(0, 60),
    hh: parseInt(r.hh, 10), mm: parseInt(r.mm, 10),
    freq: ['once', 'daily', 'weekly'].indexOf(r.freq) >= 0 ? r.freq : 'daily',
    days: (Array.isArray(r.days) ? r.days : [])
      .map((d) => parseInt(d, 10)).filter((d) => isFinite(d) && d >= 0 && d <= 6),
    enabled: r.enabled !== false,
    done: !!r.done,
    lastFired: String(r.lastFired || ''),
    scripts: Array.isArray(r.scripts) ? r.scripts : [],
    ackScripts: Array.isArray(r.ackScripts) ? r.ackScripts : []
  }));
  cfg.idleSecs = Object.assign({ idle_5: 300, idle_15: 900, idle_30: 1800 }, obj(cfg.idleSecs));
  Object.keys(cfg.idleSecs).forEach((k) => {
    cfg.idleSecs[k] = clampNum(cfg.idleSecs[k], 10, 24 * 3600, { idle_5: 300, idle_15: 900, idle_30: 1800 }[k] || 300);
  });
  return cfg;
}

let configV2 = null;
let packRegistry = [];
let configQueue = Promise.resolve();
let migrations = [];
function enqueueConfig(action) {
  const next = configQueue.catch(() => {}).then(action);
  configQueue = next;
  return next;
}
function legacyId(name) {
  return (packRegistry.find(p => p.legacyNames && p.legacyNames.includes(name)) || {}).id || packs.legacyId(name || 'miyo');
}
async function discoverCharacters() {
  if (process.platform === 'win32') packsRootDirs().forEach(extractExternalZips);
  packRegistry = await packs.discoverPacks([...packsRootDirs(), path.join(platformPaths.resourceRoot, 'packs')]);
  // Built-in files are described once, then listed and loaded through the same registry.
  const builtin = { id: 'miyo', label: '美代', defaults: {}, attribution: null, warnings: [], legacyNames: ['miyo'], modes: {} };
  for (const v of ['v1', 'v2']) {
    const root = path.join(platformPaths.resourceRoot, 'prototype', v, 'assets', v === 'v1' ? 'spr' : 'full');
    const sprites = {};
    try { for (const f of fs.readdirSync(root)) if (/\.png$/i.test(f)) sprites[f.replace(/\.png$/i, '').replace(/^.*_spr_/, '')] = path.join(root, f); } catch (_) {}
    builtin.modes[v] = Object.keys(sprites).length ? { rootDir: root, sprites, defaultSpriteId: '00' } : null;
  }
  packRegistry = [builtin, ...packRegistry.filter(p => p.id !== 'miyo')];
}
function roleDefaults(id) {
  const pack = packRegistry.find(p => p.id === id);
  const flat = defaults();
  if (id !== 'miyo') {
    for (const key of ['mapping','lines','voices','reacts','scripts','hourly','restSprs','idleSprs','idleBlink','idleSway','idleBreathe']) flat[key] = { v1: {}, v2: {} };
    flat.bubble.name = pack ? pack.label : id;
    flat.mode = pack && !pack.modes.v2 && pack.modes.v1 ? 'v1' : 'v2';
  }
  const base = store.split(flat).character;
  const supplied = pack && pack.defaults || {};
  return store.merge(store.merge(base, store.split(supplied).character), supplied.display ? { display: supplied.display } : {});
}
function projection(config) {
  const id = config.activeCharacterId;
  const globalDefaults = store.split(defaults()).global;
  const value = store.projectConfig({ ...config, global: store.merge(globalDefaults, config.global) }, id, roleDefaults(id));
  value.characterLabel = (packRegistry.find(p => p.id === id) || {}).label || id;
  const previous = cfg; cfg = value;
  try { return normalizeConfig(); } finally { cfg = previous; }
}
async function loadConfig() {
  await discoverCharacters();
  configV2 = await store.readConfig(configFile(), { resolveLegacyId: legacyId });
  cfg = projection(configV2);
  return cfg;
}
async function publishConfig(candidate) {
  for (const [id, role] of Object.entries(candidate.characters)) {
    const roleBase = roleDefaults(id);
    for (const key of Object.keys(role)) if (Object.hasOwn(roleBase, key)) {
      const remaining = store.omitDefaults(role[key], roleBase[key]);
      if (remaining === undefined) delete role[key]; else role[key] = remaining;
    }
  }
  const next = projection(candidate);
  await store.writeConfig(configFile(), candidate);
  configV2 = candidate; cfg = next;
  applyWindow(); applyTop(cfg.alwaysOnTop); sendConfig(); refreshTray();
  if (agentHub) await configureAgents();
  return { ok: true, config: cfg };
}
function submitConfig(request, targetId) {
  return enqueueConfig(async () => {
    try {
      // Internal actions bind to the committed state when their queue entry runs.
      // Renderer requests remain explicit snapshots and must pass the stale check.
      const currentRequest = typeof request === 'function' ? request() : request;
      let candidate = store.applyPatch(configV2, currentRequest);
      if (targetId) {
        const pack = packRegistry.find(p => p.id === targetId);
        if (!pack) throw Object.assign(new Error('角色包不可用'), { code: 'PACK_UNAVAILABLE' });
        candidate = store.switchCharacter(candidate, targetId);
        const mode = store.getCharacterConfig(candidate, targetId, roleDefaults(targetId)).display.mode;
        if (!pack.modes[mode]) throw Object.assign(new Error('该角色没有此模式的素材，请切换模式'), { code: 'PACK_MODE_UNAVAILABLE' });
      } else if (currentRequest.patch.mode) {
        const pack = packRegistry.find(p => p.id === candidate.activeCharacterId);
        if (!pack || !pack.modes[currentRequest.patch.mode]) throw Object.assign(new Error('该角色没有此模式的素材'), { code: 'PACK_MODE_UNAVAILABLE' });
      }
      if (targetId) {
        const pack = packRegistry.find(p => p.id === targetId);
        const mode = projection(candidate).mode;
        try { await fs.promises.access(packs.resolveSprite(pack, mode)); }
        catch (_) { throw Object.assign(new Error('角色素材已不可用'), { code: 'PACK_UNAVAILABLE' }); }
      }
      return await publishConfig(candidate);
    } catch (e) { return { ok: false, error: e.code || 'CONFIG_WRITE_FAILED', config: cfg }; }
  });
}
function saveConfig(patch) {
  const requestedPatch = JSON.parse(JSON.stringify(patch));
  return submitConfig(() => ({ characterId: cfg.characterId, baseRevision: cfg.revision, patch: requestedPatch }));
}

/* =======================================================
   窗口 / 托盘 / 菜单
   ======================================================= */
function windowSize(mode, scale) {
  const base = WIN_BY_MODE[mode] || WIN_BY_MODE.v2;
  const s = isFinite(scale) ? scale : 1;
  return { w: Math.round(base.w * s), h: Math.round(base.h * s) };
}

/* 窗口尺寸的唯一入口（单页双模式后不再换页：版本切换由页面经 onConfig 热切换）。
   —— 右下角锚点：左上角按尺寸差值回退，保证桌宠「脚」不跑
   —— 注意：绝对不要在这里用 setOpacity 做防闪帧！Windows 上对 transparent 窗口调
      setOpacity 会切到 layered 模式，软件渲染下（MIYO_GPU=off 默认值）整个窗口
      从此不再绘制（内容全空但事件/菜单正常），且冷启动就会触发。 */
function applyWindow() {
  if (!win || win.isDestroyed()) return;
  const size = windowSize(cfg.mode, cfg.scale);
  /* 0.3.9：允许窗口超出屏幕（底部锚定，放大时上半部分出屏）——
     桌宠是 bottom-right 锚定，超大时可见部分为立绘下半身，这是 10× 的预期行为 */
  const old = win.getBounds();

  if (old.width !== size.w || old.height !== size.h) {
    win.setBounds({
      x: Math.round(old.x + (old.width - size.w)),
      y: Math.round(old.y + (old.height - size.h)),
      width: size.w,
      height: size.h
    });
    console.log('[miyo-pet] 窗口重设 ' + old.width + '×' + old.height + ' → ' + size.w + '×' + size.h +
      '（模式 ' + cfg.mode + ' · 缩放 ' + cfg.scale + '×）');
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const size = windowSize(cfg.mode, cfg.scale);

  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: Math.max(0, area.width - size.w - 40),
    y: Math.max(0, area.height - size.h),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: cfg.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver');
  console.log('[miyo-pet] 窗口 ' + size.w + '×' + size.h +
    '（模式 ' + cfg.mode + ' · 缩放 ' + cfg.scale + '× · 基准 ' +
    (WIN_BY_MODE[cfg.mode] || WIN_BY_MODE.v2).w + '×' + (WIN_BY_MODE[cfg.mode] || WIN_BY_MODE.v2).h + '）');
  win.loadFile(paths.page(cfg.mode), { query: { pet: '1' } });
  win.on('closed', function () { win = null; });
  bindHealthLog();
}

function bindHealthLog() {
  win.webContents.on('did-finish-load', function () {
    sendConfig();
    if (lastCredits) send('miyo-credits', lastCredits);   // 页面重载后补发积分（0.2.14）
    if (agentHub) send('miyo-state', toPetState(agentHub.getSnapshot()));
    win.webContents.executeJavaScript(
      'JSON.stringify({' +
      ' ready: document.readyState,' +
      ' body: document.body.className,' +
      ' host: !!window.petHost,' +
      ' api: typeof (window.MiyoPet && window.MiyoPet.setState),' +
      ' mode: window.MiyoPet ? window.MiyoPet.getMode() : "-",' +
      ' state: window.MiyoPet ? window.MiyoPet.getState() : null' +
      '})'
    ).then(function (r) {
      console.log('[miyo-pet] 页面就绪 ' + r);
    }).catch(function (e) {
      console.log('[miyo-pet] 页面自检失败 ' + e.message);
    });
  });
  win.webContents.on('console-message', function (_e, level, message, line, source) {
    console.log('[page:' + level + '] ' + message + '   @' + String(source).split('/').pop() + ':' + line);
  });
  win.webContents.on('render-process-gone', function (_e, d) {
    console.log('[miyo-pet] 渲染进程结束 ' + JSON.stringify(d));
  });
  win.webContents.on('did-fail-load', function (_e, code, desc) {
    console.log('[miyo-pet] 载入失败 ' + code + ' ' + desc);
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch (e) { /* ignore */ }
  }
}
function sendConfig() { send('miyo-config', cfg); }

/* ------------------------------------------------------------------
   今日消耗积分（0.2.14）
   数据源  %CODEBUDDY_CONFIG_DIR%\workbuddy.db → session_usage.credit_json
   读取器  scripts/credits-query.js（sidecar，用本机 Node 22+ 的 node:sqlite；
          Electron 33 内置 Node 20 没有 node:sqlite，主进程读不了；
          Node 22 运行时从 binaries 目录运行时发现，不随包分发）
   口径    credit_json 是每会话累计值、键无时间戳 → 无法按时间回溯切分，
          用「零点基线快照」：今日 = 当前累计 − 当日基线；跨天时基线 =
          最后一次已知累计（夜间不用电脑则零误差），账本存 credits.json。
   ------------------------------------------------------------------ */
const { spawn } = require('child_process');
const os = require('os');
const creditsLedgerFile = path.join(app.getPath('userData'), 'credits.json');
let creditsLedger = { day: null, base: 0, lastTotal: 0 };
let creditsNode = null;              // 缓存找到的 Node 22 exe 路径
let creditsTimer = null, creditsChild = null, creditsKill = null, creditsEpoch = 0;
let lastCredits = null;              // 最近一次推送（页面 reload 后补发用）

function creditsTodayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function loadCreditsLedger() {
  try {
    const o = JSON.parse(fs.readFileSync(creditsLedgerFile, 'utf8'));
    if (o && typeof o === 'object' && o.day) creditsLedger = o;
  } catch (e) { /* 无文件/损坏 → 用默认 */ }
}
function saveCreditsLedger() {
  try { fs.writeFileSync(creditsLedgerFile, JSON.stringify(creditsLedger)); } catch (e) { /* ignore */ }
}
function findCreditsNode() {
  if (creditsNode && fs.existsSync(creditsNode)) return creditsNode;
  const dir = path.join(process.env.CODEBUDDY_CONFIG_DIR || process.env.WORKBUDDY_CONFIG_DIR ||
    path.join(os.homedir(), '.workbuddy'), 'binaries', 'node', 'versions');
  let best = null;
  try {
    for (const v of fs.readdirSync(dir)) {
      const p = path.join(dir, v, 'node.exe');
      if (!fs.existsSync(p)) continue;
      const m = v.match(/^(\d+)\./);
      if (!m || parseInt(m[1], 10) < 22) continue;      // node:sqlite 需 22.5+
      if (!best || v.localeCompare(best.v, 'en') > 0) best = { v: v, p: p };
    }
  } catch (e) { /* 目录不存在等 */ }
  creditsNode = best ? best.p : null;
  return creditsNode;
}
function pollCredits() {
  const options = agentOptions();
  if (!options.enabled || options.provider !== 'workbuddy' || creditsChild) return;
  const epoch = creditsEpoch;
  const nodeExe = findCreditsNode();
  if (!nodeExe) {
    lastCredits = { ok: false, note: '未找到 Node 22+，读不了 workbuddy.db' };
    send('miyo-credits', lastCredits);
    return;
  }
  let script = path.join(__dirname, '..', 'scripts', 'credits-query.js');
  try {
    if (typeof paths.appRoot === 'function') script = path.join(paths.appRoot(), 'scripts', 'credits-query.js');
  } catch (e) { /* 用相对布局兜底 */ }
  let out = '', done = false, child;
  try { child = spawn(nodeExe, [script], { windowsHide: true }); }
  catch (e) { lastCredits = { ok: false, note: e.message }; send('miyo-credits', lastCredits); return; }
  creditsChild = child;
  const kill = creditsKill = setTimeout(function () { try { child.kill(); } catch (e2) { /* ignore */ } }, 10000);
  child.stdout.on('data', function (d) { if (!done && epoch === creditsEpoch) out += String(d); });
  child.on('error', function (e) {
    if (done || epoch !== creditsEpoch) return; done = true; clearTimeout(kill); creditsChild = null; creditsKill = null;
    lastCredits = { ok: false, note: e.message };
    send('miyo-credits', lastCredits);
  });
  child.on('close', function () {
    if (done || epoch !== creditsEpoch) return; done = true; clearTimeout(kill); creditsChild = null; creditsKill = null;
    let r = null;
    out.split(/\r?\n/).forEach(function (line) {
      const s = line.trim();
      if (s.indexOf('{') === 0) { try { r = JSON.parse(s); } catch (e3) { /* 试下一行 */ } }
    });
    if (!r || !r.ok) {
      lastCredits = { ok: false, note: (r && r.note) || '读取失败' };
      send('miyo-credits', lastCredits);
      return;
    }
    const day = creditsTodayStr();
    if (creditsLedger.day !== day) {          // 跨天：基线 = 最后一次已知累计
      creditsLedger = { day: day, base: creditsLedger.lastTotal || r.total, lastTotal: r.total };
    } else {
      creditsLedger.lastTotal = r.total;
    }
    saveCreditsLedger();
    const today = Math.max(0, Math.round((r.total - creditsLedger.base) * 100) / 100);
    lastCredits = { ok: true, today: today, total: r.total, day: day };
    send('miyo-credits', lastCredits);
  });
}
function stopCredits() {
  ++creditsEpoch;
  if (creditsTimer) clearInterval(creditsTimer);
  if (creditsKill) clearTimeout(creditsKill);
  if (creditsChild) { try { creditsChild.kill(); } catch {} }
  creditsTimer = creditsChild = creditsKill = null;
  lastCredits = { ok: false, note: '当前来源未提供积分' };
  send('miyo-credits', lastCredits);
}
function startCredits() {
  if (creditsTimer) return;
  loadCreditsLedger();
  pollCredits();
  creditsTimer = setInterval(pollCredits, 60 * 1000);        // 每 60s 刷新（积分变化不频繁，够用）
}

function applyMode(mode) {
  if (mode === 'v1' || mode === 'v2') return saveConfig({ mode });
}

function applyTop(flag) {
  cfg.alwaysOnTop = !!flag;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver');
}

function historyDir() { return path.join(app.getPath('userData'), 'history'); }

function openHistory() {
  const d = historyDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
  shell.openPath(d).catch(function () { /* ignore */ });
}

function petMenuTemplate() {
  return [
    {
      label: win && win.isVisible() ? '隐藏桌宠' : '显示桌宠',
      click: function () { if (win && !win.isDestroyed()) { win.isVisible() ? win.hide() : win.show(); } refreshTray(); }
    },
    { type: 'separator' },
    {
      label: '模式',
      submenu: [
        { label: 'v1 · 半身差分', type: 'radio', checked: cfg.mode === 'v1', click: function () { applyMode('v1'); } },
        { label: 'v2 · 全身立绘', type: 'radio', checked: cfg.mode === 'v2', click: function () { applyMode('v2'); } }
      ]
    },
    {
      label: '统计范围',
      submenu: [
        { label: '仅当前会话', type: 'radio', checked: cfg.scope !== 'all', click: function () { setScope('current'); } },
        { label: '全部会话', type: 'radio', checked: cfg.scope === 'all', click: function () { setScope('all'); } }
      ]
    },
    { label: '设置…', click: openSettings },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: cfg.alwaysOnTop,
      click: function (item) { saveConfig({ alwaysOnTop: item.checked }); }
    },
    { label: '打开变化记录', click: openHistory },
    { type: 'separator' },
    { label: '退出', click: function () { app.quit(); } }
  ];
}

function setScope(scope) { return saveConfig({ scope: scope === 'all' ? 'all' : 'current' }); }

function popupPetMenu() {
  if (!win || win.isDestroyed()) return;
  Menu.buildFromTemplate(petMenuTemplate()).popup({ window: win });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 1160,
    height: 840,
    minWidth: 980,
    minHeight: 560,
    title: '美代桌宠 · 设置',
    autoHideMenuBar: true,
    backgroundColor: '#eef2f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(paths.settingsPage());
  settingsWin.on('closed', function () { settingsWin = null; });
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: function () { if (win && !win.isDestroyed()) { win.isVisible() ? win.hide() : win.show(); } } },
    { label: '设置…', click: openSettings },
    { type: 'separator' },
    { label: 'v1 · 半身差分', type: 'radio', checked: cfg.mode === 'v1', click: function () { applyMode('v1'); } },
    { label: 'v2 · 全身立绘', type: 'radio', checked: cfg.mode === 'v2', click: function () { applyMode('v2'); } },
    { label: '仅当前会话', type: 'radio', checked: cfg.scope !== 'all', click: function () { setScope('current'); } },
    { label: '全部会话', type: 'radio', checked: cfg.scope === 'all', click: function () { setScope('all'); } },
    { label: '始终置顶', type: 'checkbox', checked: cfg.alwaysOnTop, click: function (i) { saveConfig({ alwaysOnTop: i.checked }); } },
    { type: 'separator' },
    { label: '打开变化记录', click: openHistory },
    { label: '重新载入', click: function () { if (win && !win.isDestroyed()) win.reload(); } },
    { label: '立即刷新', click: function () { if (agentHub) agentHub.refresh(); } },
    { type: 'separator' },
    { label: '退出', click: function () { app.quit(); } }
  ]));
}

function buildTray() {
  let icon = nativeImage.createFromPath(paths.icon());
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('美代桌宠 · WorkBuddy');
  tray.on('double-click', function () { if (win && !win.isDestroyed()) { win.isVisible() ? win.hide() : win.show(); } });
  refreshTray();
}

/* =======================================================
   整点播报
   —— 调度刻意放在主进程而不是页面：
      页面在切模式时会被 loadFile 整体重载，放页面会丢掉「这一小时播过没」，
      结果同一小时反复播；主进程还能拿到 powerMonitor 做休眠唤醒补算。
   ======================================================= */
let chimeKey = null;                 // 'YYYY-M-D-H'

function hourKeyOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getHours();
}

function maybeChime(now) {
  const d = new Date(now);
  const key = hourKeyOf(d);
  if (key === chimeKey) return;

  const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
  const late = now - hourStart;
  const lateMin = Math.round(late / 60000);
  chimeKey = key;                    // 不论播不播都记账，避免同一小时反复判断

  if (late > cfg.hourlyGraceMs) {    // 超宽限（典型场景：休眠唤醒）→ 只记账不播，防刷屏
    if (log) {
      log.append({
        kind: 'chime', source: 'timer', scope: cfg.scope,
        session: prevSnap ? prevSnap.session : null, prev: null, next: null,
        reason: d.getHours() + ' 点整（迟到 ' + lateMin + ' 分钟，超过宽限，跳过）',
        degraded: false, errors: []
      });
    }
    return;
  }

  /* 0.3.6 台本合并：v1/v2 统一沿用 v2 的整点台本，不再独立设置 */
  const table = (cfg.hourly && cfg.hourly.v2) || {};
  const one = table[String(d.getHours())];
  const on = !!(one && one.on);

  if (log) {
    log.append({
      kind: 'chime', source: 'timer', scope: cfg.scope,
      session: prevSnap ? prevSnap.session : null, prev: null, next: null,
      reason: d.getHours() + ' 点整 · ' + (on ? '播报' : '未开启') +
        (late > 5000 ? '（迟到 ' + lateMin + ' 分钟）' : ''),
      degraded: false, errors: []
    });
  }
  if (!on) return;

  console.log('[miyo-pet] 整点播报 ' + d.getHours() + ' 点 · 台词 ' + (one.lines || []).length +
    ' 条 · 表情 [' + (one.sprs || []).join('/') + '] · ' + (one.ms || 12000) + 'ms' +
    (Array.isArray(one.scripts) && one.scripts.length ? ' · 台本 ' + one.scripts.length + ' 个' : ''));
  send('miyo-chime', {
    hour: d.getHours(),
    lines: one.lines || [],
    sprs: one.sprs || [],
    voice: one.voice || null,
    ms: one.ms || 12000,
    /* 0.2.9：整点台本（非空时渲染层走台本引擎，忽略旧字段） */
    scripts: (Array.isArray(one.scripts) && one.scripts.length) ? one.scripts : null
  });
}

/* =======================================================
   Agent 来源生命周期与状态投影
   ======================================================= */
function agentOptions() {
  const agent = cfg.agent || {};
  const provider = agent.activeProvider === 'codex' ? 'codex' : 'workbuddy';
  const enabled = (!agent.enabled || agent.enabled[provider] !== false) && cfg.detect.enabled !== false;
  return { provider, enabled };
}
async function configureAgents() {
  const { provider, enabled } = agentOptions();
  const key = JSON.stringify([provider, enabled, cfg.scope, cfg.dropStale, cfg.approvalTtlMs, cfg.agent]);
  if (key === agentSettingsKey) return;
  // Invalidate old callbacks and completion baselines before a configuration change.
  stopCredits();
  await agentHub.setEnabled(agentHub.getSnapshot().provider, false);
  await agentHub.setEnabled(provider, false);
  await agentHub.setActiveProvider(provider);
  await agentHub.setEnabled(provider, enabled);
  agentSettingsKey = key;
  if (provider === 'workbuddy' && enabled) startCredits();
}
async function startAgents() {
  agentHub = createHub({ adapters: { workbuddy: createAdapter({ getConfig: () => cfg }) },
    activeProvider: agentOptions().provider, onSnapshot(value) {
      const snap = toPetState(value);
      const entry = changeLog.diffEntry(prevSnap, snap, { source: value.provider, reason: value.reason || value.phase });
      if (entry && log) log.append(entry);
      prevSnap = snap;
      send('miyo-state', snap);
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('miyo-state', snap);
    } });
  await configureAgents();
  hourlyTimer = setInterval(() => maybeChime(Date.now()), 2000);
  maybeChime(Date.now());
}

/* =======================================================
   IPC
   ======================================================= */
ipcMain.on('pet-move', function (_e, d) {
  if (!win || win.isDestroyed() || !d) return;
  const pos = win.getPosition();
  win.setPosition(Math.round(pos[0] + (d.dx || 0)), Math.round(pos[1] + (d.dy || 0)));
});

ipcMain.on('pet-menu', popupPetMenu);
ipcMain.on('open-settings', openSettings);
ipcMain.on('mode-set', function (_e, mode) { applyMode(mode); });
ipcMain.on('top-set', function (_e, flag) { saveConfig({ alwaysOnTop: !!flag }); });
ipcMain.on('scope-set', function (_e, scope) { setScope(scope); });
ipcMain.on('history-open', openHistory);

/* 语音通道（预留）：现在只记日志，不播放。将来在这里做「读文件 → 交给渲染层播」。 */
ipcMain.on('pet-speak', function (_e, d) {
  console.log('[miyo-pet] 语音通道（预留，尚未播放）' + JSON.stringify(d || {}));
});

/* 设置页「试播一次」：直接把一条播报推给桌宠 */
ipcMain.on('chime-test', function (_e, d) {
  send('miyo-chime', d || { hour: new Date().getHours(), lines: [], sprs: [], ms: 12000 });
});

/* 设置页「测试」按钮：把 {sprs, lines, ms, voice} 或 {stop:true} 推给桌宠预览 */
ipcMain.on('expr-test', function (_e, d) {
  send('miyo-test', d || {});
});

/* 内置台词对照（单一真源在页面，设置页只读） */
let builtinLines = null;
ipcMain.on('builtins-report', function (_e, obj) { builtinLines = obj || null; });
ipcMain.handle('builtins-get', function () { return builtinLines; });

/* ---------- 设置预设（0.2.4）：userData/presets/<名字>.json，存整套 cfg ---------- */
function sanitizePresetName(name) {
  const s = String(name || '').trim();
  if (!s || s.length > 60) return null;
  if (/[\\/:*?"<>|]/.test(s) || s.split('..').length > 1) return null;   // 禁路径非法字符与 ..
  return s;
}
/* 0.3.18：预设目录 → exe 旁 packs/settings（与设置页网页端互通同一文件夹）；
   便携版用 PORTABLE_EXECUTABLE_DIR；dev 用 appRoot/presets。
   legacyPresetsDir() = 旧 userData/presets（只读兼容：列表合并、载入回退） */
function presetsDir() {
  return platformPaths.presetDir;
}
function legacyPresetsDir() { return path.join(app.getPath('userData'), 'presets'); }

ipcMain.handle('presets-list', function () {
  /* 0.3.18：新目录（packs/settings）优先，旧 userData/presets 合并去重（只读迁移兼容） */
  const seen = {};
  const out = [];
  [presetsDir(), legacyPresetsDir()].forEach(function (dir) {
    try {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).filter((f) => f.endsWith('.json')).forEach((f) => {
        if (seen[f]) return;
        const full = path.join(dir, f);
        let name = f.slice(0, -5);
        try { name = JSON.parse(fs.readFileSync(full, 'utf8')).presetName || name; } catch (e) { /* keep */ }
        seen[f] = 1;
        out.push({ file: f.slice(0, -5), name: name, mtime: fs.statSync(full).mtimeMs });
      });
    } catch (e) { /* next */ }
  });
  return out.sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('presets-save', async function (_e, p) {
  const name = sanitizePresetName(p && p.name);
  if (!name) return { ok: false, error: '非法预设名' };
  return enqueueConfig(async () => {
    try {
      const snapshot = store.applyPatch(configV2, { characterId: p.cfg.characterId, baseRevision: p.cfg.revision, patch: p.cfg });
      const id = snapshot.activeCharacterId;
      snapshot.characters = { [id]: snapshot.characters[id] };
      snapshot.presetName = name;
      await store.writeConfig(path.join(presetsDir(), name + '.json'), snapshot);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.code || 'PRESET_WRITE_FAILED' }; }
  });
});
async function loadPreset(name) {
  const n = sanitizePresetName(name);
  if (!n) return null;
  for (const d of [presetsDir(), legacyPresetsDir()]) {
    const file = path.join(d, n + '.json');
    if (fs.existsSync(file)) return store.readConfig(file, { resolveLegacyId: legacyId });
  }
  return null;
}
ipcMain.handle('presets-load', async (_e, name) => {
  const preset = await loadPreset(name);
  return preset ? projection(preset) : null;
});
ipcMain.handle('presets-apply', (_e, request) => enqueueConfig(async () => {
  try {
    const preset = await loadPreset(request.name);
    if (!preset) throw new Error('PRESET_MISSING');
    const next = store.applyPreset(configV2, preset, request);
    const pack = packRegistry.find(p => p.id === next.activeCharacterId);
    const projected = projection(next);
    if (!pack || !pack.modes[projected.mode]) throw new Error('PACK_UNAVAILABLE');
    return await publishConfig(next);
  } catch (e) { return { ok: false, error: e.code || e.message, config: cfg }; }
}));
ipcMain.handle('presets-delete', function (_e, name) {
  const n = sanitizePresetName(name);
  if (!n) return { ok: false, error: '非法预设名' };
  try {
    const f = path.join(presetsDir(), n + '.json');
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
/* 预设目录在资源管理器里打开（排查用） */
ipcMain.on('presets-open', function () {
  try {
    const dir = presetsDir();
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  } catch (e) { /* ignore */ }
});

ipcMain.handle('config-get', function () { return cfg; });

/* Pure URL conversion only: sandboxed preload has no Node pathToFileURL.
   Synchronous reply keeps audio selection ordered; this handler performs no I/O. */
ipcMain.on('file-url', function (event, file) {
  let url = '';
  if (typeof file === 'string' && path.isAbsolute(file)) {
    try { url = paths.fileUrlOf(file); } catch (e) { /* invalid path */ }
  }
  event.returnValue = url;
});

ipcMain.handle('packs-list', function () {
  const out = { v1: [], v2: [] };
  for (const pack of packRegistry) for (const ver of ['v1', 'v2']) if (pack.modes[ver]) {
    const mode = pack.modes[ver];
    out[ver].push({ id: pack.id, dir: pack.id, label: pack.label, ids: Object.keys(mode.sprites).sort(),
      urls: Object.fromEntries(Object.entries(mode.sprites).map(([id, file]) => [id, paths.fileUrlOf(file)])), warnings: pack.warnings });
  }
  return out;
});
ipcMain.handle('state-refresh', async function () { if (agentHub) await agentHub.refresh(); return agentHub ? toPetState(agentHub.getSnapshot()) : null; });
ipcMain.handle('state-get', function () { return agentHub ? toPetState(agentHub.getSnapshot()) : null; });
/* 应用版本（0.2.10）：设置页显示，方便核对跑的是新包还是旧包 */
ipcMain.handle('app-version', function () { return app.getVersion(); });
ipcMain.handle('history-tail', function (_e, n) { return log ? log.tail(n || 100) : []; });
ipcMain.handle('history-stats', function () { return log ? log.stats() : null; });

ipcMain.handle('config-save', (_e, request) => submitConfig(request));
ipcMain.handle('character-switch', (_e, request) => submitConfig(request, request.targetId));
ipcMain.handle('config-reset', (_e, request) => enqueueConfig(async () => {
  try {
    store.applyPatch(configV2, { ...request, patch: {} });
    const next = JSON.parse(JSON.stringify(configV2));
    next.characters[next.activeCharacterId] = {}; next.revision++;
    return await publishConfig(next);
  } catch (e) { return { ok: false, error: e.code || 'CONFIG_WRITE_FAILED', config: cfg }; }
}));

/* =======================================================
   启动
   ======================================================= */
app.whenReady().then(async function () {
  try { await loadConfig(); }
  catch (e) {
    const result = await dialog.showMessageBox({ type: 'error', title: '配置需要恢复',
      message: '配置未被覆盖：' + (e.code || 'CONFIG_READ_FAILED'),
      detail: '原文件及首次读取的 .bak 备份保留在配置目录。关闭桌宠后，可复制备份为 config.json 再启动。',
      buttons: ['打开配置目录', '退出'] });
    if (result.response === 0) await shell.openPath(path.dirname(configFile()));
    app.quit(); return;
  }
  log = changeLog.createLog(historyDir());
  log.prune();
  log.append({
    kind: 'boot', source: 'boot', scope: cfg.scope, session: null,
    prev: null, next: null,
    reason: '启动 · Agent 来源 ' + agentOptions().provider, degraded: false, errors: []
  });
  if (migrations.length) {                 // 一次性配置迁移：留痕，方便回溯「数字为什么变了」
    log.append({
      kind: 'migration', source: 'boot', scope: cfg.scope, session: null,
      prev: null, next: null, reason: migrations.join('；'), degraded: false, errors: []
    });
    console.log('[miyo-pet] 配置迁移 ' + migrations.join('；'));
  }

  /* 重启不重播：从变化记录里找回「最近一次播报是哪一小时」。
     ⚠️ 必须在 startAgents() 之前做 —— 它会启动独立整点时钟并触发 maybeChime，
     放在后面就会先播一次再恢复状态（踩过这个坑）。 */
  try {
    const last = log.tail(200).find(function (r) { return r && r.kind === 'chime'; });
    if (last && last.ts) chimeKey = hourKeyOf(new Date(last.ts));
  } catch (e) { /* ignore */ }

  createWindow();
  buildTray();
  await startAgents();

  /* 休眠唤醒后补算一次（配合宽限窗口，睡太久就只记账不播） */
  try {
    if (powerMonitor && typeof powerMonitor.on === 'function') {
      powerMonitor.on('resume', function () { setTimeout(function () { maybeChime(Date.now()); }, 3000); });
    }
  } catch (e) { /* ignore */ }

  app.on('activate', function () { if (!win) createWindow(); });
});

app.on('window-all-closed', function () {
  if (hourlyTimer) clearInterval(hourlyTimer);
  stopCredits();
  if (agentHub) agentHub.dispose().finally(() => app.quit()); else app.quit();
});
