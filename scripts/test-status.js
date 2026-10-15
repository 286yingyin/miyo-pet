/**
 * 美代桌宠 · 状态链路单测（零依赖）
 * ---------------------------------------------------------------------------
 * 用法： node scripts/test-status.js
 *
 * 用 os.tmpdir() 造一棵假的 WorkBuddy 数据树，覆盖 7 组断言：
 *   ① 会话判定：跳过「心跳最新但没有 tasks 目录」的陷阱会话，选中真会话
 *   ② 0 字节文件 → degraded，且**不产生** justDone
 *   ③ 任务由未完成变为全部完成 → justDone = true（健康快照）
 *   ④ 读失败（文件损坏）→ degraded，且**不误判**成完成  ← 关键回归
 *   ⑤ 权限信号：同 requestId 多 toolCallId 的配对；已批准的不计数
 *   ⑥ scope=all 时历史残留进 stale，不计入 pending
 *   ⑦ 变化记录：写入 / tail / 裁剪
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('./state-core');
const approvals = require('./approval-status');
const changeLog = require('./change-log');

let pass = 0, fail = 0;
function ok(m) { console.log('  \u2713 ' + m); pass++; }
function bad(m) { console.log('  \u2717 ' + m); fail++; }
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label + ' = ' + JSON.stringify(actual));
  else bad(label + ' 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

/* ---------- 造假树 ---------- */
const N = Date.now();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-'));
const T = path.join(ROOT, 'tasks');
const S = path.join(ROOT, 'sessions');
const A = path.join(ROOT, 'audit-log');
const SP = path.join(A, 'spool');
[T, S, A, SP].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });
const roots = { root: ROOT, tasks: T, sessions: S, audit: A, spool: SP };

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const TRAP = 'interactive-99999';
const OLD = 'bbbbbbbb-1111-2222-3333-444444444444';
const DAY = (function () {
  const d = new Date(N), p = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();

const F = {
  done: path.join(T, SID, '1.json'),
  doing: path.join(T, SID, '2.json'),
  todo: path.join(T, SID, '3.json'),
  broken: path.join(T, SID, '4.json'),
  old: path.join(T, OLD, '1.json')
};
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj), 'utf8'); }
function writeLines(p, arr) { fs.writeFileSync(p, arr.map(function (o) { return JSON.stringify(o); }).join('\n') + '\n', 'utf8'); }

writeJson(F.done, { subject: '已完成的任务', status: 'completed', id: '1', createdAt: N - 5000, updatedAt: N - 4000 });
writeJson(F.doing, { subject: '正在处理的任务', status: 'in_progress', id: '2', createdAt: N - 5000, updatedAt: N - 1000 });
writeJson(F.todo, { subject: '待办任务', status: 'pending', id: '3', createdAt: N - 5000, updatedAt: N - 900 });
fs.writeFileSync(F.broken, Buffer.alloc(0));                     // 0 字节
writeJson(F.old, { subject: '9 月的历史残留', status: 'pending', id: '1', createdAt: N - 30 * 86400000, updatedAt: N - 30 * 86400000 });

/* 陷阱会话：心跳最新，但 sessionId 没有对应的 tasks 目录 */
writeJson(path.join(S, '99999.json'), { pid: 99999, lastHeartbeat: N, sessionId: TRAP, cwd: path.join(os.tmpdir(), 'x'), kind: 'interactive' });
/* 真会话：心跳稍旧，但 cwd 命中项目、且有 tasks 目录 */
writeJson(path.join(S, '1234.json'), { pid: 1234, lastHeartbeat: N - 3000, sessionId: SID, cwd: process.env.MIYO_PROJECT_DIR || os.tmpdir(), kind: 'interactive' });
/* 0 字节的会话文件（实测本机就有） */
fs.writeFileSync(path.join(S, '20920.json'), Buffer.alloc(0));

/* audit：req-A 已被批准（3 个 toolCallId）；req-B 仍未决（2 个 toolCallId） */
writeLines(path.join(SP, 'audit-spool-1234-' + DAY + '.jsonl'), [
  { sessionId: SID, requestId: 'req-A', toolCallId: 'call-a1', category: 'file-safety', eventType: 'file-safety.bulk-delete.needs-approval', decision: 'info', timestamp: N - 9000 },
  { sessionId: SID, requestId: 'req-A', toolCallId: 'call-a2', category: 'file-safety', eventType: 'file-safety.bulk-delete.needs-approval', decision: 'info', timestamp: N - 9000 },
  { sessionId: SID, requestId: 'req-A', toolCallId: 'call-a3', category: 'file-safety', eventType: 'file-safety.bulk-delete.needs-approval', decision: 'info', timestamp: N - 9000 },
  { sessionId: SID, requestId: 'req-A', toolCallId: 'call-a1', category: 'file-safety', eventType: 'file-safety.bulk-delete.approved', decision: 'approved', timestamp: N - 8000 },
  { sessionId: SID, requestId: 'req-B', toolCallId: 'call-b1', category: 'sensitive-protection', eventType: 'sensitive-protection.detected', decision: 'info', timestamp: N - 5000 },
  { sessionId: SID, requestId: 'req-B', toolCallId: 'call-b2', category: 'sensitive-protection', eventType: 'sensitive-protection.detected', decision: 'info', timestamp: N - 5000 }
]);

console.log('\n=== 美代桌宠 · 状态链路单测 ===');
console.log('  临时数据树 ' + ROOT + '\n');

/* ---------- ① 会话判定 ---------- */
console.log('[1] 会话判定');
{
  const cur = core.resolveCurrentSession(roots, N);
  eq(cur.session, SID, '选中会话');
  if (/cwd|心跳/.test(cur.reason || '')) ok('判定依据：' + cur.reason);
  else bad('判定依据可疑：' + cur.reason);
  if (cur.session !== TRAP) ok('已跳过陷阱会话 ' + TRAP);
  else bad('错误地选中了陷阱会话');
}

/* ---------- ② 0 字节文件 → 降级且不误报完成 ---------- */
console.log('\n[2] 0 字节文件');
core._reset();
{
  const s = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq(s.degraded, true, 'degraded');
  eq(s.justDone, false, 'justDone');
  eq(s.ok, false, 'ok');
  if (s.errors.length) ok('错误摘要：' + s.errors[0]);
  else bad('没有给出错误摘要');
}

/* ---------- ③ 全部完成 → justDone ---------- */
console.log('\n[3] 完成态判定');
core._reset();
{
  fs.rmSync(F.broken);                                     // 移走坏文件，恢复健康
  let s1 = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq(s1.ok, true, '健康快照 ok');
  eq([s1.processing, s1.pending], [1, 1], '[处理中, 待办]');

  writeJson(F.doing, { subject: '正在处理的任务', status: 'completed', id: '2', createdAt: N - 5000, updatedAt: N });
  let s2 = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq(s2.justDone, false, '还剩待办时 justDone');

  writeJson(F.todo, { subject: '待办任务', status: 'completed', id: '3', createdAt: N - 5000, updatedAt: N });
  let s3 = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq([s3.processing, s3.pending], [0, 0], '[处理中, 待办]');
  eq(s3.justDone, true, '全部完成 justDone');
}

/* ---------- ④ 读失败不得误判成完成（关键回归） ---------- */
console.log('\n[4] 防误判（读失败 ≠ 完成）');
core._reset();
{
  writeJson(F.doing, { subject: '正在处理的任务', status: 'in_progress', id: '2', createdAt: N - 5000, updatedAt: N });
  let a = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq(a.processing, 1, '恢复：处理中');

  fs.writeFileSync(F.doing, '{ 这不是合法 JSON');           // 读失败
  let b = core.snapshot({ roots: roots, scope: 'current', now: N });
  eq(b.degraded, true, 'degraded');
  eq(b.justDone, false, 'justDone（绝不能被读失败触发）');
  eq(b.processing, 1, '处理中数字沿用上次已知值（不归零）');
}

/* ---------- ⑤ 权限信号配对 ---------- */
console.log('\n[5] 权限信号');
{
  const ap = approvals.readApprovals(roots, { now: N, session: SID });
  eq(ap.count, 2, '未决数量（req-B 的 2 个 toolCallId；req-A 已批准不计）');
  const reqs = [...new Set(ap.open.map(function (x) { return x.requestId; }))];
  eq(reqs, ['req-B'], '未决请求');
  const all = approvals.readApprovals(roots, { now: N });
  eq(all.count, 2, '不限定会话时同样为 2');
  const ttl = approvals.readApprovals(roots, { now: N + 3600000, session: SID });
  eq(ttl.count, 0, '超过 TTL 视为过期');
}

/* ---------- ⑥ 全部会话 + 历史过滤 ---------- */
console.log('\n[6] 统计范围与历史过滤');
core._reset();
{
  const all = core.snapshot({ roots: roots, scope: 'all', now: N, dropStale: true });
  if (all.stale >= 1) ok('历史残留进了 stale = ' + all.stale);
  else bad('历史残留没有被识别为 stale');
  eq(all.pending, 0, 'pending 不含历史残留');
  const raw = core.snapshot({ roots: roots, scope: 'all', now: N, dropStale: false });
  eq(raw.pending, 1, '关掉过滤后 pending 含历史残留');
}

/* ---------- ⑦ 变化记录 ---------- */
console.log('\n[7] 变化记录');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyo-log-'));
  const lg = changeLog.createLog(dir);
  const a = { processing: 1, pending: 2, approval: 0, completed: 0, rev: 1 };
  const b = { processing: 1, pending: 0, approval: 1, completed: 2, rev: 2 };
  eq(changeLog.diffEntry(a, a, { source: 'poll' }), null, '无变化 → null');
  lg.append(changeLog.diffEntry(a, b, { source: 'watch', reason: '测试' }));
  lg.append(null);
  eq(lg.stats().written, 1, '实际写入条数');
  const t = lg.tail(5);
  eq(t.length, 1, 'tail 条数');
  eq(t[0].next.approval, 1, 'tail[0].next.approval');
  if (/^\d{4}-\d{2}-\d{2}T/.test(t[0].iso || '')) ok('iso 时间戳：' + t[0].iso);
  else bad('iso 时间戳格式不对：' + t[0].iso);
  eq(typeof lg.prune().removed, 'number', 'prune 可执行');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- 收尾 ---------- */
fs.rmSync(ROOT, { recursive: true, force: true });
console.log('\n=== ' + (fail ? '未通过：' + fail + ' 项' : '全部通过 \u2713（' + pass + ' 项）') + ' ===\n');
process.exit(fail ? 1 : 0);
