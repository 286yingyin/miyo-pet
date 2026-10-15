/**
 * 美代桌宠 · 权限确认信号（audit-log 读取器）
 * ---------------------------------------------------------------------------
 * 实测的数据源与字段：
 *   %CODEBUDDY_CONFIG_DIR%\audit-log\spool\audit-spool-<pid>-<YYYY-MM-DD>.jsonl   ← 实时流（最全）
 *   %CODEBUDDY_CONFIG_DIR%\audit-log\YYYY-MM-DD.jsonl  (+ .N 分片)                ← 当日归档
 *
 *   每条事件都带： sessionId / requestId / toolCallId / category / eventType /
 *                 decision / messageKey / messageParams / timestamp
 *   个别事件另有： commandPreview / commandHash
 *   ⚠️ 没有 sequence 字段，所以不能靠它排序，只能按文件行序（= 时间序）
 *
 * 事件语义（实测）
 *   「等待批准」： eventType 命中 needs-approval / *.detected  且 decision === 'info'
 *   「已收尾」  ： eventType 命中 approved / approval-resolved / approval-timeout / original-reused
 *                或 decision === 'approved'
 *
 * 配对规则（关键）
 *   同一个 requestId 下可能有多个 toolCallId（实测一条 requestId 对应 3 个 toolCallId），
 *   而收尾事件往往只带一个 toolCallId —— 因此：
 *     · 有 toolCallId → 按 toolCallId 精确收尾
 *     · 同时按 requestId 收尾该请求下所有未决项
 *
 * 输出：{ count, open[], expired, ok, files, lines }
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OPEN_RE = /needs-approval|\.detected$/i;
const RESOLVED_RE = /approved$/i;
const RESOLVED_ANY = /approval-resolved|approval-timeout|original-reused/i;
const DEFAULT_TTL_MS = 30 * 60 * 1000;     // 超过 30 分钟还没收尾的，视为已过期（不弹）
const MAX_BYTES = 512 * 1024;              // 每个文件只读尾部 512KB

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dayStr(d) {
  const t = (d instanceof Date) ? d : new Date(Number(d) || Date.now());   // 兼容 Date 与毫秒时间戳
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
}

/** 只读文件尾部，返回整行数组 */
function tailLines(file, maxBytes) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return [];
    const start = Math.max(0, st.size - (maxBytes || MAX_BYTES));
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    let txt = buf.toString('utf8');
    if (start > 0) {                                  // 丢掉可能被截断的首行
      const i = txt.indexOf('\n');
      txt = i >= 0 ? txt.slice(i + 1) : '';
    }
    return txt.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
  }
}

/** 候选文件：当日归档（旧）+ 实时 spool（新） */
function candidateFiles(roots, now) {
  const day = dayStr(now);
  const out = [];
  try {
    for (const f of fs.readdirSync(roots.audit)) {
      if (f.startsWith(day) && f.endsWith('.jsonl')) out.push(path.join(roots.audit, f));
    }
  } catch (e) { /* audit-log 不存在 */ }
  try {
    for (const f of fs.readdirSync(roots.spool)) {
      if (f.endsWith('.jsonl')) out.push(path.join(roots.spool, f));
    }
  } catch (e) { /* spool 不存在 */ }
  return out;
}

/**
 * @param {object} roots  由 state-core.resolveRoots() 给出
 * @param {object} opts   { now, session, ttlMs }
 */
function readApprovals(roots, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const ttl = opts.ttlMs || DEFAULT_TTL_MS;

  if (!roots || !roots.audit) return { count: 0, open: [], expired: 0, ok: true, files: 0, lines: 0 };
  if (!fs.existsSync(roots.audit)) {
    return { count: 0, open: [], expired: 0, ok: true, files: 0, lines: 0, note: 'audit-log 目录不存在' };
  }

  const files = candidateFiles(roots, now);
  const pending = new Map();          // key -> entry
  const resolvedReq = new Set();
  const resolvedCall = new Set();
  let lines = 0, badLines = 0, readFail = 0;

  for (const f of files) {
    let rows;
    try { rows = tailLines(f, MAX_BYTES); }
    catch (e) { readFail++; continue; }

    for (const line of rows) {
      let e;
      try { e = JSON.parse(line); } catch (err) { badLines++; continue; }
      if (!e || !e.eventType) continue;
      lines++;

      const rid = e.requestId || '';
      const cid = e.toolCallId || '';
      const key = cid || rid;

      if (RESOLVED_RE.test(e.eventType) || RESOLVED_ANY.test(e.eventType) || e.decision === 'approved') {
        if (rid) resolvedReq.add(rid);
        if (cid) resolvedCall.add(cid);
        for (const [k, v] of pending) {
          if ((rid && v.requestId === rid) || (cid && k === cid)) pending.delete(k);
        }
        continue;
      }

      if (OPEN_RE.test(e.eventType) && e.decision === 'info') {
        if ((rid && resolvedReq.has(rid)) || (cid && resolvedCall.has(cid))) continue;
        pending.set(key, {
          key: key,
          toolCallId: cid,
          requestId: rid,
          sessionId: e.sessionId || '',
          category: e.category || '',
          eventType: e.eventType,
          ts: Number(e.timestamp) || 0,
          preview: String(e.commandPreview || e.messageKey || '').slice(0, 160)
        });
      }
    }
  }

  let open = Array.from(pending.values());
  if (opts.session) open = open.filter((x) => x.sessionId === opts.session);

  const fresh = open.filter((x) => !x.ts || (now - x.ts) < ttl);
  const expired = open.length - fresh.length;
  fresh.sort((a, b) => b.ts - a.ts);

  return {
    count: fresh.length,
    open: fresh.slice(0, 8),
    expired: expired,
    ok: readFail === 0,
    files: files.length,
    lines: lines,
    badLines: badLines
  };
}

module.exports = { readApprovals, tailLines, candidateFiles, dayStr, DEFAULT_TTL_MS, OPEN_RE, RESOLVED_RE, RESOLVED_ANY };

if (require.main === module) {
  const core = require('./state-core');
  const roots = core.resolveRoots();
  const cur = core.resolveCurrentSession(roots);
  console.log('[approval] audit  ' + roots.audit);
  console.log('[approval] 会话   ' + cur.session);
  console.log('[approval] current ' + JSON.stringify(readApprovals(roots, { session: cur.session }), null, 2));
  console.log('[approval] all     ' + JSON.stringify(readApprovals(roots, {}), null, 2));
}
