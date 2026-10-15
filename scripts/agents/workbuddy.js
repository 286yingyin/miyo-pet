'use strict';
const path = require('node:path');
const { snapshot } = require('./schema');

function createAdapter(options = {}) {
  const core = options.core || require('../state-core');
  const fs = options.fs || require('node:fs');
  const timers = options.timers || globalThis;
  const getConfig = options.getConfig || (() => ({}));
  let active = false, epoch = 0, emit = null;
  let poll = null, debounce = null, settle = null;
  let current = snapshot('workbuddy'), lastGood = null, baseline = null, serial = 0;
  const watchers = new Map();

  function clearWatch(key) {
    const watcher = watchers.get(key);
    if (!watcher) return;
    watchers.delete(key);
    try { watcher.handle.close(); } catch { /* Already closed after a native error. */ }
  }

  function schedule(token) {
    if (!active || token !== epoch || debounce) return;
    debounce = timers.setTimeout(() => {
      if (!active || token !== epoch) return;
      debounce = null;
      refresh();
      if (settle) timers.clearTimeout(settle);
      settle = timers.setTimeout(() => {
        if (!active || token !== epoch) return;
        settle = null;
        refresh();
      }, 300);
    }, 350);
  }

  function watch(key, dir) {
    const old = watchers.get(key);
    if (old && old.dir === dir) return;
    clearWatch(key);
    const token = epoch;
    try {
      if (!dir || !fs.existsSync(dir)) return;
      const handle = fs.watch(dir, { persistent: true }, () => {
        if (watchers.get(key)?.handle === handle) schedule(token);
      });
      handle.on('error', () => {
        if (!active || token !== epoch || watchers.get(key)?.handle !== handle) return;
        clearWatch(key);
        schedule(token);
      });
      watchers.set(key, { dir, handle });
    } catch { /* Polling retries attachment without changing task state. */ }
  }

  function readFailure(unconfigured = false) {
    baseline = null;
    return snapshot('workbuddy', {
      ...(lastGood || {}),
      health: lastGood ? 'stale' : unconfigured ? 'unconfigured' : 'error',
      completionKey: null,
      reason: !lastGood && unconfigured ? 'not_configured' : 'read_failed'
    });
  }

  async function refresh() {
    if (!active) return current;
    let raw = null, roots = null, value;
    try {
      const config = getConfig();
      roots = core.resolveRoots();
      if (!fs.existsSync(roots.tasks)) {
        value = readFailure(true);
      } else {
        raw = core.snapshot({ scope: config.scope === 'all' ? 'all' : 'current',
          dropStale: config.dropStale, approvalTtlMs: config.approvalTtlMs });
        if (!raw.ok) {
          value = readFailure();
        } else {
          // The legacy core has module-shared history. Only this lifecycle's healthy
          // observations can establish a completion; never reuse core.justDone.
          const identity = JSON.stringify([raw.session, raw.scope, config.scope,
            config.dropStale, config.approvalTtlMs]);
          const count = raw.processing + raw.pending;
          const done = baseline && baseline.identity === identity && baseline.count > 0 && count === 0;
          baseline = { identity, count };
          const phase = raw.approval > 0 ? 'awaiting_approval' : raw.processing > 0 ? 'running' : done ? 'completed' : 'idle';
          value = snapshot('workbuddy', {
            health: 'ready', phase, sessionId: raw.session || null,
            counts: { processing: raw.processing, pending: raw.pending, approval: raw.approval },
            completionKey: done ? 'workbuddy:' + epoch + ':' + (++serial) : null,
            scope: raw.scope, completed: raw.completed || 0, conversations: raw.conversations || 0
          });
          lastGood = value;
        }
      }
    } catch { value = readFailure(); }
    if (roots) {
      for (const key of ['tasks', 'sessions', 'spool', 'audit']) watch(key, roots[key]);
      watch('session', raw && raw.session ? path.join(roots.tasks, raw.session) : null);
    }
    current = snapshot('workbuddy', { ...value, observedAt: Date.now() });
    if (active && emit) emit(current);
    return current;
  }

  return {
    async start(callback) {
      if (active) return;
      active = true;
      const token = ++epoch;
      emit = callback;
      lastGood = null;
      baseline = null;
      await refresh();
      if (!active || epoch !== token) return;
      poll = timers.setInterval(() => { if (active && epoch === token) refresh(); }, 2000);
    },
    refresh,
    async stop() {
      if (!active) return;
      active = false;
      ++epoch;
      emit = null;
      baseline = lastGood = null;
      if (poll) timers.clearInterval(poll);
      if (debounce) timers.clearTimeout(debounce);
      if (settle) timers.clearTimeout(settle);
      poll = debounce = settle = null;
      for (const key of [...watchers.keys()]) clearWatch(key);
      current = snapshot('workbuddy', { reason: 'disabled' });
    }
  };
}
module.exports = { createAdapter };
