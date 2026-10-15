/**
 * 美代桌宠 · 状态变化记录（JSONL）
 * ---------------------------------------------------------------------------
 * 位置：<userData>/history/changes-YYYY-MM-DD.jsonl   （userData 已被钉成 %APPDATA%\miyo-pet）
 *
 * 单行结构
 *   { ts, iso, seq, kind, source, scope, session,
 *     prev:{processing,pending,approval,completed,rev},
 *     next:{processing,pending,approval,completed,rev},
 *     reason, degraded, errors:[] }
 *   kind ∈ state | health | session | approval | boot
 *   source ∈ watch | poll | manual | boot
 *
 * 策略
 *   · 只追加整行（appendFileSync），不做 read-modify-write
 *   · 只记「有变化」或 health/session/approval 的边缘事件，避免刷爆
 *   · 轮转：单文件 > 2MB 换 .1 / .2 …；保留最新 30 个文件、最多 14 天
 *   · 磁盘不可写 → 降级到内存（保留最近 200 条），并暴露 lastError 供界面提示
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_DAYS = 14;
const MEM_CAP = 200;

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dayStr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function isoOf(ts) {
  const d = new Date(ts);
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const a = Math.abs(tz);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

const FILE_RE = /^changes-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;

function createLog(dir) {
  const log = {
    dir: dir,
    seq: 0,
    mem: [],
    lastError: null,
    written: 0,
    skipped: 0
  };

  function ensureDir() {
    try { fs.mkdirSync(dir, { recursive: true }); return true; }
    catch (e) { log.lastError = '历史目录不可写：' + (e.code || e.message); return false; }
  }

  /** 当前要写的文件（超过阈值就换分片） */
  function currentFile(ts) {
    const day = dayStr(ts);
    let k = 0;
    for (;;) {
      const name = k === 0 ? 'changes-' + day + '.jsonl' : 'changes-' + day + '.' + k + '.jsonl';
      const p = path.join(dir, name);
      let size = 0;
      try { size = fs.statSync(p).size; } catch (e) { size = 0; }
      if (size < MAX_FILE_BYTES) return p;
      k++;
      if (k > 50) return p;                       // 极端兜底
    }
  }

  /** 追加一条（自动补 ts/iso/seq）。传入 null/非对象时安全返回 false（无变化时不写） */
  function append(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const ts = entry.ts || Date.now();
    const row = Object.assign({ ts: ts, iso: isoOf(ts), seq: ++log.seq }, entry);
    const line = JSON.stringify(row);
    if (ensureDir()) {
      try {
        fs.appendFileSync(currentFile(ts), line + '\n', 'utf8');
        log.written++;
        log.lastError = null;
        return true;
      } catch (e) {
        log.lastError = '历史写入失败：' + (e.code || e.message);
      }
    }
    // 降级：内存
    log.mem.push(row);
    if (log.mem.length > MEM_CAP) log.mem.shift();
    return false;
  }

  /** 裁剪：超过天数的先删，再保证文件数不超过 MAX_FILES */
  function prune(now) {
    now = now || Date.now();
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return { removed: 0 }; }
    const items = [];
    for (const n of names) {
      const m = FILE_RE.exec(n);
      if (!m) continue;
      items.push({ name: n, date: m[1], k: m[2] ? Number(m[2]) : 0 });
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.k - b.k));
    const cutoff = dayStr(now - MAX_DAYS * 86400000);
    let removed = 0;
    const keep = items.filter((it) => it.date >= cutoff);
    const drop = items.filter((it) => it.date < cutoff);
    while (keep.length > MAX_FILES) drop.push(keep.shift());
    for (const it of drop) {
      try { fs.rmSync(path.join(dir, it.name), { force: true }); removed++; } catch (e) { /* ignore */ }
    }
    return { removed: removed, kept: keep.length };
  }

  /** 读最近 n 条（新→旧） */
  function tail(n) {
    n = Math.min(Math.max(1, n || 100), 500);
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    const items = [];
    for (const nm of names) {
      const m = FILE_RE.exec(nm);
      if (m) items.push({ name: nm, date: m[1], k: m[2] ? Number(m[2]) : 0 });
    }
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.k - a.k));   // 新文件在前
    const out = [];
    for (const it of items) {
      let lines;
      try { lines = fs.readFileSync(path.join(dir, it.name), 'utf8').split('\n'); }
      catch (e) { continue; }
      for (let i = lines.length - 1; i >= 0; i--) {
        const s = lines[i].trim();
        if (!s) continue;
        try { out.push(JSON.parse(s)); } catch (e) { /* 跳过坏行 */ }
        if (out.length >= n) return out;
      }
    }
    // 磁盘为空时把内存里的补上
    if (!out.length && log.mem.length) {
      return log.mem.slice(-n).reverse();
    }
    return out;
  }

  function stats() {
    let files = 0, bytes = 0;
    try {
      for (const n of fs.readdirSync(dir)) {
        if (!FILE_RE.test(n)) continue;
        files++;
        try { bytes += fs.statSync(path.join(dir, n)).size; } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    return { dir: dir, files: files, bytes: bytes, written: log.written, memHeld: log.mem.length, lastError: log.lastError };
  }

  return { append: append, prune: prune, tail: tail, stats: stats, dir: dir };
}

/** 便捷：从两份快照生成一条变化记录（无变化返回 null） */
function diffEntry(prev, next, meta) {
  meta = meta || {};
  const proj = (s) => s ? {
    processing: s.processing, pending: s.pending,
    approval: s.approval, completed: s.completed, rev: s.rev
  } : null;
  const a = proj(prev), b = proj(next);
  const same = a && b && a.processing === b.processing && a.pending === b.pending &&
    a.approval === b.approval && a.completed === b.completed;
  if (same && !meta.force) return null;
  return {
    kind: meta.kind || 'state',
    source: meta.source || 'poll',
    scope: next ? next.scope : (prev ? prev.scope : null),
    session: next ? next.session : (prev ? prev.session : null),
    prev: a,
    next: b,
    reason: meta.reason || '',
    degraded: !!(next && next.degraded),
    errors: (next && next.errors) || []
  };
}

module.exports = { createLog, diffEntry, dayStr, isoOf, MAX_FILES, MAX_DAYS, MEM_CAP };
