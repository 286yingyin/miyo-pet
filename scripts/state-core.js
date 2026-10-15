/**
 * 美代桌宠 · 状态内核（唯一真源读取器）
 * ---------------------------------------------------------------------------
 * 数据源（全部实测）：
 *   %CODEBUDDY_CONFIG_DIR%\tasks\<会话ID>\<任务ID>.json
 *       { subject, description, activeForm, status, id, createdAt, updatedAt[, metadata] }
 *       status ∈ in_progress | pending | completed ；取消在 metadata.cancelled（status 仍可能是 in_progress）
 *   %CODEBUDDY_CONFIG_DIR%\sessions\<pid>.json
 *       { pid, lastHeartbeat, sessionId, cwd, kind, ... }   心跳秒级刷新
 *   %CODEBUDDY_CONFIG_DIR%\audit-log\{spool\*.jsonl,YYYY-MM-DD.jsonl}
 *       权限确认的 needs-approval / approved / approval-timeout 成对事件
 *
 * 产出：PetSnapshot{ rev, ok, degraded, error, justDone, scope, session,
 *                    processing, pending, approval, completed, stale, total,
 *                    conversations, conversationsNote, usage, active[] }
 *
 * 设计要点
 *   1) 只有 ok===true 的快照才允许产生 justDone —— 避免「读失败被误判成任务完成」
 *   2) 读失败一律沿用上一次已知值（lastGood 粘性缓存），绝不归零
 *   3) rev 只在「关键投影」变化时自增，主进程据此去重，避免每 2 秒都推 IPC
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const approvals = require('./approval-status');

/* =======================================================
   0. 小工具
   ======================================================= */
function sleepSync(ms) {
  if (!ms || ms <= 0) return;
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch (e) {
    const t = Date.now();
    while (Date.now() - t < ms) { /* busy wait fallback */ }
  }
}

/** 容错读 JSON：0 字节 / 半截写入 / BOM / 占用 → 重试 */
function readJsonSafe(file, opts) {
  const tries = (opts && opts.tries) || 3;
  const delayMs = (opts && opts.delayMs) || 20;
  let lastErr = 'unknown';
  for (let i = 0; i < tries; i++) {
    try {
      const buf = fs.readFileSync(file);
      if (!buf || buf.length === 0) throw new Error('文件为空(0 字节)');
      let txt = buf.toString('utf8');
      if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);      // strip BOM
      txt = txt.replace(/\u0000+$/g, '').trim();                  // 尾部 0x00 填充
      if (!txt) throw new Error('文件内容为空');
      return { ok: true, value: JSON.parse(txt) };
    } catch (e) {
      lastErr = e && (e.code ? e.code + ' ' + e.message : e.message) || String(e);
      if (i < tries - 1) sleepSync(delayMs);
    }
  }
  return { ok: false, error: lastErr };
}

/* =======================================================
   1. 根目录解析（多级兜底）
   ======================================================= */
function mkRoot(r) {
  return {
    root: r,
    tasks: path.join(r, 'tasks'),
    sessions: path.join(r, 'sessions'),
    audit: path.join(r, 'audit-log'),
    spool: path.join(r, 'audit-log', 'spool')
  };
}

function resolveRoots() {
  // 1) 显式指定 tasks 目录
  const explicit = process.env.WORKBUDDY_TASKS_DIR;
  if (explicit) return mkRoot(path.dirname(path.resolve(explicit)));
  // 2) 环境变量里的配置根（实测本机为 CODEBUDDY_CONFIG_DIR）
  const cands = [
    process.env.CODEBUDDY_CONFIG_DIR,
    process.env.WORKBUDDY_CONFIG_DIR,
    path.join(os.homedir(), '.workbuddy')
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.existsSync(path.join(c, 'tasks'))) return mkRoot(c); } catch (e) { /* next */ }
  }
  for (const c of cands) {
    try { if (fs.existsSync(c)) return mkRoot(c); } catch (e) { /* next */ }
  }
  return mkRoot(cands[cands.length - 1]);
}

/* =======================================================
   2. 任务读取与归类
   ======================================================= */
function bucketOf(status, cancelled) {
  if (cancelled) return 'cancelled';
  const s = String(status || '').toLowerCase();
  if (s === 'in_progress' || s === 'running' || s === 'active') return 'processing';
  if (s === 'pending' || s === 'todo' || s === 'not_started') return 'pending';
  if (s === 'completed' || s === 'done') return 'completed';
  return 'unknown';
}

function normalizeTask(j, session, file, filePath) {
  const cancelled = !!(j.metadata && (j.metadata.cancelled === true || j.metadata.cancelledAt || j.metadata.cancelReason));
  const status = String(j.status || 'unknown').toLowerCase();
  let mtime = 0;
  try { mtime = fs.statSync(filePath).mtimeMs; } catch (e) { /* ignore */ }
  const updatedAt = Number(j.updatedAt) || mtime || 0;
  return {
    id: j.id != null ? String(j.id) : file.replace(/\.json$/, ''),
    session: session,
    subject: j.subject || j.title || '',
    activeForm: j.activeForm || '',
    status: status,
    cancelled: cancelled,
    bucket: bucketOf(status, cancelled),
    createdAt: Number(j.createdAt) || 0,
    updatedAt: updatedAt,
    mtime: mtime || updatedAt,
    file: filePath
  };
}

/**
 * 扫描单个 tasks 目录
 * @param {string} dir
 * @param {object} cache  lastGood 粘性缓存 { 绝对路径 -> task }
 */
function readTasks(dir, cache) {
  const out = [];
  let readErrors = 0;
  let sessions;
  try {
    sessions = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { list: [], ok: false, readErrors: 0, error: 'tasks 目录不可读：' + (e.code || e.message) };
  }
  for (const s of sessions) {
    if (!s.isDirectory()) continue;
    const sd = path.join(dir, s.name);
    let files;
    try { files = fs.readdirSync(sd); } catch (e) { readErrors++; continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(sd, f);
      const r = readJsonSafe(p);
      if (r.ok && r.value && typeof r.value === 'object') {
        const t = normalizeTask(r.value, s.name, f, p);
        out.push(t);
        if (cache) cache[p] = t;
      } else {
        readErrors++;
        if (cache && cache[p]) {
          out.push(Object.assign({}, cache[p], { staleRead: true }));   // 沿用上次已知值
        } else {
          out.push(normalizeTask({}, s.name, f, p));
        }
      }
    }
  }
  return { list: out, ok: readErrors === 0, readErrors: readErrors };
}

/* =======================================================
   3. 当前会话判定
   ======================================================= */
const FRESH_MS = 120000;              // 心跳新鲜窗口：2 分钟
const SESSION_HOLD_MS = 5 * 60000;    // 滞后锁定宽限：心跳断了也先沿用这么久再改选

let held = { session: null, lastSeen: 0 };     // 滞后锁定（跨调用保持）

/**
 * 读 sessions 目录 → 归一化条目。
 * sessions 是「CLI 宿主进程注册表」：实测 120 个文件 / 90 个唯一 sessionId，
 * 同一对话被多个 pid 反复登记 —— 必须去重，否则每 2 秒会在重复条目间跳。
 * 同时排除：0 字节坏文件、prewarm 预热、sessionId 形如 interactive-<pid> 的宿主占位。
 */
function readSessionEntries(roots) {
  let files;
  try {
    files = fs.readdirSync(roots.sessions);
  } catch (e) {
    return { ok: false, error: 'sessions 目录不可读：' + (e.code || e.message), entries: [] };
  }
  const isTemp = (c) => /[\\/]Temp[\\/]|[\\/]tmp[\\/]/i.test(c || '');
  const raw = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(roots.sessions, f);
    const r = readJsonSafe(p, { tries: 2 });
    if (!r.ok || !r.value || !r.value.sessionId) continue;      // 0 字节坏文件在此被跳过
    const j = r.value;
    const sid = String(j.sessionId);
    if (/^interactive-\d+$/i.test(sid)) continue;               // CLI 宿主占位，不是真对话
    raw.push({
      file: p,
      sessionId: sid,
      heartbeat: Number(j.lastHeartbeat) || 0,
      cwd: j.cwd || '',
      kind: j.kind || '',
      temp: isTemp(j.cwd),
      hasTasks: fs.existsSync(path.join(roots.tasks, sid))
    });
  }
  const byId = new Map();
  for (const e of raw) {
    const cur = byId.get(e.sessionId);
    if (!cur ||
      (e.hasTasks && !cur.hasTasks) ||
      (e.hasTasks === cur.hasTasks && e.heartbeat > cur.heartbeat)) {
      byId.set(e.sessionId, e);
    }
  }
  return { ok: true, entries: [...byId.values()], rawCount: raw.length };
}

/** 进行中对话数：交互式 + 心跳新鲜 + 有 tasks 目录 + 不在临时目录（条目已去重） */
function countActiveConversations(entries, now, windowMs) {
  const win = windowMs || FRESH_MS;
  return (entries || []).filter((e) =>
    e.kind !== 'prewarm' && e.hasTasks && !e.temp && (now - e.heartbeat) < win
  ).length;
}

function resolveCurrentSession(roots, now) {
  now = now || Date.now();
  const rr = readSessionEntries(roots);
  if (!rr.ok) return { session: null, reason: rr.error, entries: [], activeConversations: 0, conversationsNote: '' };

  const entries = rr.entries;
  const activeConversations = countActiveConversations(entries, now);
  const conversationsNote = 'interactive · 心跳<' + Math.round(FRESH_MS / 1000) + 's · 有任务目录 · 已按会话去重';

  function done(session, reason, e) {
    return {
      session: session, reason: reason,
      file: e ? e.file : undefined, cwd: e ? e.cwd : '', heartbeat: e ? e.heartbeat : 0,
      entries: entries, activeConversations: activeConversations, conversationsNote: conversationsNote
    };
  }
  function lock(e, reason) {
    held = { session: e.sessionId, lastSeen: now };
    return done(e.sessionId, reason, e);
  }

  /* --- 0) 滞后锁定 ---------------------------------------------------------
     实测当前项目下有**两个会话的 cwd 完全相同**（60d8f0c0 与 294ad3e9），
     只按「心跳最新」会在这两者之间来回跳，数字跟着抖。
     所以一旦选中，只要它还活着就一直沿用；心跳断了也给 5 分钟宽限再改选。 */
  if (held.session) {
    const still = entries.find((e) => e.sessionId === held.session);
    if (still && (now - still.heartbeat) < FRESH_MS) {
      held.lastSeen = now;
      return done(still.sessionId,
        '沿用锁定的会话（心跳 ' + Math.round((now - still.heartbeat) / 1000) + 's 前）', still);
    }
    if (still && (now - held.lastSeen) < SESSION_HOLD_MS) {
      return done(still.sessionId,
        '锁定会话心跳中断，宽限期内沿用（已中断 ' + Math.round((now - held.lastSeen) / 1000) + 's）', still);
    }
    if (!still) held = { session: null, lastSeen: 0 };
  }

  const fresh = entries.filter((e) => e.kind !== 'prewarm' && (now - e.heartbeat) < FRESH_MS);
  const pool = (fresh.filter((e) => e.hasTasks).length ? fresh.filter((e) => e.hasTasks) : entries.filter((e) => e.hasTasks));
  pool.sort((a, b) => b.heartbeat - a.heartbeat);

  const proj = process.env.MIYO_PROJECT_DIR || process.env.CODEBUDDY_PROJECT_DIR || '';
  if (proj) {
    const want = path.resolve(proj).toLowerCase();
    const hit = pool.find((e) => e.cwd && path.resolve(e.cwd).toLowerCase() === want);
    if (hit) return lock(hit, 'cwd 命中当前项目');
  }
  const nonTemp = pool.find((e) => e.cwd && !e.temp);
  if (nonTemp) return lock(nonTemp, '心跳最新（排除 Temp 会话）');

  // 心跳都不新鲜 → 取 tasks 下最近改动且含未完成的会话
  const byTasks = newestSessionByTasks(roots);
  if (byTasks) {
    if (byTasks.session) held = { session: byTasks.session, lastSeen: now };
    return done(byTasks.session, byTasks.reason);
  }

  // 环境变量兜底
  const envSid = process.env.CODEBUDDY_SESSION_ID;
  if (envSid && fs.existsSync(path.join(roots.tasks, envSid))) {
    held = { session: String(envSid), lastSeen: now };
    return done(String(envSid), 'CODEBUDDY_SESSION_ID 兜底');
  }
  return done(null, '无法判定当前会话（将退回全部会话）');
}

function newestSessionByTasks(roots) {
  let dirs;
  try { dirs = fs.readdirSync(roots.tasks, { withFileTypes: true }); } catch (e) { return null; }
  let best = null;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const sd = path.join(roots.tasks, d.name);
    let files;
    try { files = fs.readdirSync(sd).filter((f) => f.endsWith('.json')); } catch (e) { continue; }
    let newest = 0, hasOpen = false;
    for (const f of files) {
      const p = path.join(sd, f);
      let mt = 0;
      try { mt = fs.statSync(p).mtimeMs; } catch (e) { continue; }
      if (mt > newest) newest = mt;
      const r = readJsonSafe(p, { tries: 1 });
      if (r.ok && r.value) {
        const b = bucketOf(r.value.status, false);
        if (b === 'processing' || b === 'pending') hasOpen = true;
      }
    }
    if (!best || (hasOpen && !best.hasOpen) || newest > best.newest) {
      best = { session: d.name, newest: newest, hasOpen: hasOpen };
    }
  }
  if (best) return { session: best.session, reason: 'tasks 最近改动的会话（兜底）' };
  return null;
}

/* =======================================================
   4. 汇总
   ======================================================= */
function summarize(list, opts) {
  opts = opts || {};
  const scope = opts.scope === 'all' ? 'all' : 'current';
  const session = opts.session || null;
  const now = opts.now || Date.now();
  const freshMs = opts.freshMs || 7 * 24 * 3600 * 1000;     // 7 天
  const dropStale = opts.dropStale !== false;               // 默认丢历史残留

  let pool = list;
  if (scope === 'current') {
    pool = session ? list.filter((t) => t.session === session) : [];
  }

  const c = { processing: 0, pending: 0, completed: 0, cancelled: 0, unknown: 0 };
  let stale = 0;
  const active = [];
  for (const t of pool) {
    const open = t.bucket === 'processing' || t.bucket === 'pending';
    const isStale = open && (now - (t.updatedAt || t.mtime || 0)) > freshMs;
    if (open && isStale && dropStale) { stale++; continue; }
    c[t.bucket] = (c[t.bucket] || 0) + 1;
    if (open) active.push(t);
  }
  active.sort((a, b) => (b.updatedAt || b.mtime) - (a.updatedAt || a.mtime));

  return {
    scope: scope,
    session: session,
    processing: c.processing,
    pending: c.pending,
    completed: c.completed,
    cancelled: c.cancelled,
    unknown: c.unknown,
    stale: stale,
    total: pool.length,
    active: active.slice(0, 12).map((t) => ({
      id: t.id, subject: t.subject, status: t.status, session: t.session, updatedAt: t.updatedAt
    })),
    ts: now
  };
}

/* =======================================================
   5. 对外主入口
   ======================================================= */
const cache = Object.create(null);        // lastGood 粘性缓存
let rev = 0;
let lastSig = null;
let lastActive = 0;
let lastScope = null;
let failStreak = 0;

function signature(s) {
  return [s.scope, s.session, s.processing, s.pending, s.approval, s.completed,
    s.conversations, s.ok, s.error].join('|');
}

/**
 * 取一次快照
 * @param {object} opts { scope:'current'|'all', dropStale:boolean, now:number }
 */
function snapshot(opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const roots = opts.roots || resolveRoots();
  const scope = opts.scope === 'all' ? 'all' : 'current';
  const errors = [];

  // --- 会话判定 ---
  const cur = resolveCurrentSession(roots, now);
  let session = cur.session;
  let scopeUsed = scope;
  let sessionFallback = false;
  if (scope === 'current' && !session) {
    scopeUsed = 'all';                 // 判不出会话 → 退回全部，并标记降级
    sessionFallback = true;
    errors.push('未锁定当前会话：' + cur.reason);
  }

  // --- 任务 ---
  const tr = readTasks(roots.tasks, cache);
  if (tr.error) errors.push(tr.error);
  if (tr.readErrors) errors.push(tr.readErrors + ' 个任务文件读取失败（已沿用上次值）');

  const sum = summarize(tr.list, { scope: scopeUsed, session: session, now: now, freshMs: opts.freshMs, dropStale: opts.dropStale });

  // --- 权限确认 ---
  const ap = approvals.readApprovals(roots, {
    now: now,
    session: scopeUsed === 'current' ? session : null,
    ttlMs: opts.approvalTtlMs
  });
  if (ap.error) errors.push(ap.error);

  const ok = tr.ok && !sessionFallback && ap.ok !== false;
  const degraded = !ok;
  failStreak = ok ? 0 : failStreak + 1;

  const snap = {
    rev: 0,
    ts: now,
    ok: ok,
    degraded: degraded,
    error: failStreak >= 3,                 // 连续 3 拍读不到 → 进错误态
    justDone: false,
    scope: scopeUsed,
    session: session,
    sessionReason: cur.reason,
    processing: sum.processing,
    pending: sum.pending,
    approval: ap.count,                     // 可能为 null（未知）
    completed: sum.completed,
    stale: sum.stale,
    total: sum.total,
    /* 进行中对话数（纯读 sessions 目录，零额外 IO —— 复用会话判定的那次读取） */
    conversations: cur.activeConversations || 0,
    conversationsNote: cur.conversationsNote || '',
    /* 今日消耗积分：本轮暂缓接入（Electron 33 内置 Node 20 无 node:sqlite）。
       槽位先留好，字段与口径已定：读 workbuddy.db 的 session_usage.credit_json 按 updated_at 归今日。 */
    usage: { ok: false, reason: '未启用（本轮暂缓）', approx: true },
    active: sum.active,
    approvalList: ap.open,
    errors: errors
  };

  /* --- justDone：只在「健康的快照」上，且未完成**任务**由 >0 变 0 ---
     刻意不把 approval 计入：待批准是「等老师点允许」这个另一维度的事，
     桌上活干完了就该开心一下；approval>0 时界面本来就由 approval 态优先接管。 */
  const active = snap.processing + snap.pending;
  if (ok && lastScope === snap.scope && lastActive > 0 && active === 0) snap.justDone = true;
  lastActive = active;
  lastScope = snap.scope;

  // --- rev：仅在关键投影变化时自增 ---
  const sig = signature(snap);
  if (sig !== lastSig) { rev++; lastSig = sig; }
  snap.rev = rev;
  return snap;
}

/** 仅供测试：重置内部状态 */
function _reset() {
  rev = 0; lastSig = null; lastActive = 0; lastScope = null; failStreak = 0;
  held = { session: null, lastSeen: 0 };
  for (const k of Object.keys(cache)) delete cache[k];
}

module.exports = {
  resolveRoots, resolveCurrentSession, readSessionEntries, countActiveConversations,
  readTasks, summarize, bucketOf, readJsonSafe, sleepSync, snapshot, _reset,
  FRESH_MS, SESSION_HOLD_MS,
  get CACHE() { return cache; }
};

/* 直接运行：打印一次快照，方便手工核对 */
if (require.main === module) {
  const r = resolveRoots();
  console.log('[state-core] 数据根 ' + r.root);
  const cs = resolveCurrentSession(r);
  console.log('[state-core] 会话   ' + JSON.stringify({
    session: cs.session, reason: cs.reason, cwd: cs.cwd,
    heartbeat: cs.heartbeat, activeConversations: cs.activeConversations
  }));
  console.log('[state-core] 会话条目 ' + (cs.entries || []).length + ' 条（已按 sessionId 去重）');
  console.log(JSON.stringify(snapshot({ scope: process.argv[2] === 'all' ? 'all' : 'current' }), null, 2));
}
