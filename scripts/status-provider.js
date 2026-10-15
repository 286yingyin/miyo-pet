#!/usr/bin/env node
/**
 * WorkBuddy → 桌宠 状态桥（零依赖）
 * ---------------------------------------------------------------------------
 * 定时读取 ~/.workbuddy/tasks，写出 status.json，桌宠轮询同目录的 status.json 即自动生效。
 * 原子写入（先写 .tmp 再 rename），避免桌宠读到半截 JSON。
 *
 * 用法
 *   node scripts/status-provider.js                     默认写 v1/v2 两个目录，2 秒一次
 *   node scripts/status-provider.js --interval 1000
 *   node scripts/status-provider.js --out prototype/v2/status.json
 *   node scripts/status-provider.js --once              只跑一次并打印
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('./task-status');

const ROOT = path.resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const HAS = (name) => process.argv.includes('--' + name);

const INTERVAL = Math.max(200, parseInt(arg('interval', '2000'), 10) || 2000);
const OUTS = (() => {
  const one = arg('out', null);
  if (one) return [path.resolve(ROOT, one)];
  return [
    path.join(ROOT, 'prototype', 'v1', 'status.json'),
    path.join(ROOT, 'prototype', 'v2', 'status.json')
  ];
})();

function stamp(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

let lastPayload = '';

function writeOnce(quiet) {
  const snap = ts.snapshot();
  const payload = JSON.stringify({
    processing: snap.processing,
    pending: snap.pending,
    completed: snap.completed,
    total: snap.total,
    sessions: snap.sessions,
    active: snap.active,
    ts: snap.ts
  });

  if (payload !== lastPayload) {
    for (const f of OUTS) {
      const tmp = f + '.tmp';
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(tmp, payload, 'utf8');
        fs.renameSync(tmp, f);
      } catch (e) {
        console.error('[status] 写入失败 ' + f + ' → ' + e.message);
      }
    }
    lastPayload = payload;
    if (!quiet) {
      console.log('[status] ' + stamp() + '  处理中 ' + snap.processing +
                  '  待确认 ' + snap.pending + '  （任务总数 ' + snap.total + '）');
    }
  }
  return snap;
}

if (HAS('once')) {
  console.log(JSON.stringify(writeOnce(true), null, 2));
  process.exit(0);
}

console.log('[status] 数据源   ' + ts.TASKS_DIR);
console.log('[status] 输出     ' + OUTS.join('   |   '));
console.log('[status] 轮询间隔 ' + INTERVAL + 'ms（Ctrl+C 退出）');
writeOnce(false);
setInterval(() => writeOnce(false), INTERVAL);
