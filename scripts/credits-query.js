#!/usr/bin/env node
/* =======================================================
   credits-query.js —— 今日消耗积分读取器（sidecar，0.2.14）

   为什么存在：workbuddy.db 是 SQLite（WAL 模式），而打包用的
   Electron 33 内置 Node 20 没有 node:sqlite —— 主进程读不了。
   本脚本由主进程用本机 Node 22+（node:sqlite）spawn 执行，
   结果以一行 JSON 打到 stdout。

   口径（0.2.9 决策存档 + 0.2.14 实测）：
     session_usage(session_id, used, size, updated_at, credit_json)
     credit_json = { <消息/请求ID>: <积分> } —— 每会话累计值，
     键无时间戳 → 「今日消耗」无法从库中按时间切分，
     由主进程维护「零点基线快照」：今日 = 当前累计 − 基线。
     本脚本只负责算「当前累计」。

   用法：node credits-query.js [db路径]
   输出：{"ok":true,"total":1234.56,"n":42,"db":"..."}
   ======================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveDb() {
  if (process.argv[2]) return process.argv[2];
  const cands = [
    process.env.CODEBUDDY_CONFIG_DIR,
    process.env.WORKBUDDY_CONFIG_DIR,
    path.join(os.homedir(), '.workbuddy')
  ].filter(Boolean);
  for (const c of cands) {
    const p = path.join(c, 'workbuddy.db');
    try { if (fs.existsSync(p)) return p; } catch (e) { /* next */ }
  }
  return null;
}

function main() {
  const dbPath = resolveDb();
  if (!dbPath) {
    console.log(JSON.stringify({ ok: false, note: 'workbuddy.db 未找到' }));
    return;
  }
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) {
    console.log(JSON.stringify({ ok: false, note: 'node:sqlite 不可用（需 Node 22+）: ' + e.message }));
    return;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });   // WAL 只读连接，与 WorkBuddy 并存
  } catch (e) {
    console.log(JSON.stringify({ ok: false, note: '打开失败: ' + e.message }));
    return;
  }
  try {
    let total = 0, n = 0;
    const rows = db.prepare('SELECT credit_json FROM session_usage').all();
    for (const r of rows) {
      if (!r || !r.credit_json) continue;
      let obj;
      try { obj = JSON.parse(r.credit_json); } catch (e) { continue; }
      if (!obj || typeof obj !== 'object') continue;
      for (const k of Object.keys(obj)) {
        const v = Number(obj[k]);
        if (isFinite(v) && v > 0) { total += v; n++; }
      }
    }
    total = Math.round(total * 100) / 100;
    console.log(JSON.stringify({ ok: true, total: total, n: n, db: dbPath }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, note: '查询失败: ' + e.message }));
  } finally {
    try { db.close(); } catch (e2) { /* ignore */ }
  }
}

main();
