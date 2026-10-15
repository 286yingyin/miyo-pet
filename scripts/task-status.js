/**
 * WorkBuddy 任务状态读取（兼容层）
 * ---------------------------------------------------------------------------
 * ⚠️ 本文件已**不再自己实现读取逻辑** —— 真正的实现搬到 `scripts/state-core.js`
 *    （根目录多级兜底、会话判定、lastGood 粘性缓存、ok/degraded 健康度）。
 *    这里保留旧签名，是为了不打断已有的调用方（status-provider 等）。
 *
 * 旧签名仍可用：
 *   listTaskFiles(dir)  readTasks(dir)  summarize(list)  snapshot()
 * 新代码请优先用 state-core：
 *   const core = require('./state-core');
 *   core.snapshot({ scope:'current' })   // → PetSnapshot（含 approval / ok / degraded / justDone / rev）
 *
 * 可用环境变量覆盖（state-core 同样识别）：
 *   WORKBUDDY_TASKS_DIR   直接指定 tasks 目录
 *   CODEBUDDY_CONFIG_DIR  实测本机的配置根（优先级最高）
 *   WORKBUDDY_CONFIG_DIR  /  WORKBUDDY_HOME   兼容旧名
 * ---------------------------------------------------------------------------
 */
'use strict';

const core = require('./state-core');

/* 兼容旧导出名 */
const HOME = core.resolveRoots().root;
const TASKS_DIR = core.resolveRoots().tasks;

/**
 * 旧版结构读取：返回平铺的任务数组
 * 新版增加了 cancelled / updatedAt / createdAt，并带 lastGood 粘性缓存
 */
function readTasks(dir) {
  const roots = core.resolveRoots();
  const target = dir || roots.tasks;
  const r = core.readTasks(target, core.CACHE);
  return r.list;
}

function listTaskFiles(dir) {
  return readTasks(dir).map((t) => t.file);
}

function bucketOf(status, cancelled) {
  return core.bucketOf(status, cancelled);
}

/** 旧版汇总：保留 processing/pending/completed/total/sessions/active/ts 字段 */
function summarize(list) {
  const sessions = new Set();
  const c = { processing: 0, pending: 0, completed: 0, cancelled: 0, unknown: 0 };
  for (const t of list) {
    c[t.bucket] = (c[t.bucket] || 0) + 1;
    sessions.add(t.session);
  }
  const active = list
    .filter((t) => t.bucket === 'processing' || t.bucket === 'pending')
    .sort((a, b) => (b.updatedAt || b.mtime || 0) - (a.updatedAt || a.mtime || 0))
    .slice(0, 12)
    .map((t) => ({ id: t.id, subject: t.subject, status: t.status }));
  return {
    processing: c.processing,
    pending: c.pending,
    completed: c.completed,
    cancelled: c.cancelled,
    total: list.length,
    sessions: sessions.size,
    active: active,
    ts: Date.now()
  };
}

/** 旧版快照：默认统计全部会话（保持旧行为）；要「当前会话」请直接用 state-core */
function snapshot() {
  const s = core.snapshot({ scope: 'all', dropStale: false });
  const sessions = new Set();
  for (const t of core.readTasks(core.resolveRoots().tasks, core.CACHE).list) sessions.add(t.session);
  return {
    processing: s.processing,
    pending: s.pending,
    completed: s.completed,
    total: s.total,
    sessions: sessions.size,
    active: s.active,
    ts: s.ts,
    // 新增（向后兼容地附在后面）
    ok: s.ok,
    degraded: s.degraded,
    approval: s.approval,
    session: s.session,
    scope: s.scope
  };
}

module.exports = {
  HOME, TASKS_DIR,
  bucketOf, listTaskFiles, readTasks, summarize, snapshot,
  // 顺手把新内核也透传出来，方便调用方只 require 一个模块
  core: core
};

/* 单跑： node scripts/task-status.js */
if (require.main === module) {
  const s = snapshot();
  console.log('数据源: ' + TASKS_DIR);
  console.log(JSON.stringify(s, null, 2));
}
