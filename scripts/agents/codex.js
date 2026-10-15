'use strict';
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { snapshot } = require('./schema');
const { parseLine, normalizeThreadId, SUPPORTED_VERSION, MAX_LINE_BYTES } = require('../codex-event');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function createAdapter(options = {}) {
  const fs = options.fs || require('node:fs'), io = fs.promises;
  const timers = options.timers || globalThis;
  const getConfig = options.getConfig || (() => ({}));
  let active = false, epoch = 0, emit, poll, debounce, watcher, queue = Promise.resolve();
  let current = snapshot('codex'), lastGood, home, threadId, file, summaryFile;
  let streamId, readOffset, offset, pending, skipping, skippedBytes, anchor, metadata, blocked, fault, initial, historyBoundary;
  let turns, terminal, ordinal, ambiguous, completedKeys;
  function live(token) { return active && epoch === token; }
  function reset() {
    streamId = null; readOffset = offset = skippedBytes = 0; pending = Buffer.alloc(0); skipping = false;
    anchor = null; metadata = null; blocked = null; fault = null; initial = true; historyBoundary = 0;
    turns = []; terminal = new Set(); ordinal = null; ambiguous = false;
  }
  function publish(value, token) {
    if (live(token)) { current = snapshot('codex', { ...value, observedAt: Date.now() }); if (emit) emit(current); }
    return current;
  }
  function failure(reason, token, unconfigured = false) {
    // Read failures cannot confirm whether an old running turn survived.
    for (const turn of turns) turn.live = false;
    return publish({ ...(lastGood || {}), health: lastGood ? 'stale' : unconfigured ? 'unconfigured' : 'error',
      completionKey: null, reason }, token);
  }
  async function findFile(dir, token) {
    if (!live(token)) return null;
    let entries;
    try { entries = await io.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!live(token)) return null;
    let best = null;
    const names = new Set(entries.filter(e => e.isFile()).map(e => e.name));
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const pattern = new RegExp('^rollout-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})-' + threadId + '(?:_(' + uuid + '))?\\.jsonl$', 'i');
    for (const entry of entries) {
      const compressed = entry.name.endsWith('.jsonl.zst');
      const logical = compressed ? entry.name.slice(0, -4) : entry.name;
      if (!logical.startsWith('rollout-') || !logical.endsWith('.jsonl') || compressed && names.has(logical)) continue;
      const match = entry.isFile() && pattern.exec(logical);
      if (match) {
        const iso = match[1].slice(0, 11) + match[1].slice(11).replaceAll('-', ':') + '.000Z';
        const time = Date.parse(iso);
        if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) continue;
        const key = match[1] + ':' + (match[2] || threadId).toLowerCase();
        if (!best || key > best.key) best = { key, file: path.join(dir, entry.name), compressed };
      }
    }
    // Only directory names are enumerated. No other chat's file is opened.
    for (const entry of entries) if (entry.isDirectory()) {
      const found = await findFile(path.join(dir, entry.name), token);
      if (found && (!best || found.key > best.key)) best = found;
    }
    return best;
  }
  function closeWatch() { if (watcher) { watcher.close(); watcher = null; } }
  function attach(token) {
    if (!live(token) || !file || watcher) return;
    try {
      const handle = fs.watch(path.dirname(file), () => {
        if (!live(token) || watcher !== handle || debounce) return;
        debounce = timers.setTimeout(() => {
          if (!live(token)) return;
          debounce = null; refresh();
        }, 100);
      });
      watcher = handle;
      handle.on('error', () => { if (live(token) && watcher === handle) closeWatch(); });
    } catch { /* The owned interval retries attachment. */ }
  }
  function consume(event, historical) {
    if (event.kind === 'rollback') {
      turns.splice(Math.max(0, turns.length - event.count));
      for (const turn of turns) turn.live = false;
      ambiguous = false;
      return true;
    }
    if (event.sourceSequence !== null) {
      if (ordinal !== null && event.sourceSequence <= ordinal) return false;
      ordinal = event.sourceSequence;
    }
    let id = event.turnId;
    if (id === null) {
      const open = turns.filter(t => t.phase === 'running');
      if (open.length !== 1) { ambiguous = true; return false; }
      id = open[0].id;
    }
    let turn = turns.find(t => t.id === id);
    if (terminal.has(id)) return false;
    if (!turn && turns.length && event.kind !== 'turn_started') { terminal.add(id); return false; }
    if (!turn) { turn = { id, phase: 'unknown', live: false }; turns.push(turn); }
    if (event.kind === 'turn_started') {
      if (turn.phase !== 'running') { turn.phase = 'running'; turn.live = !historical; }
      ambiguous = false;
    } else {
      turn.phase = { turn_completed: 'completed', turn_failed: 'failed', turn_interrupted: 'interrupted' }[event.kind];
      terminal.add(id);
      if (turn === turns.at(-1)) ambiguous = false;
    }
    return false;
  }
  async function persist(token, value, keys) {
    if (!live(token)) return false;
    if (!summaryFile) throw new Error('persist_failed');
    await io.mkdir(path.dirname(summaryFile), { recursive: true });
    if (!live(token)) return false;
    const temp = summaryFile + '.tmp-' + randomUUID();
    const bytes = JSON.stringify({ schemaVersion: 1, sessionId: threadId, streamId, offset,
      turnId: value.turnId, phase: value.phase, completedKeys: [...keys] }) + '\n';
    try {
      await io.writeFile(temp, bytes, { flag: 'wx' });
      if (!live(token)) return false;
      await io.rename(temp, summaryFile);
      return live(token);
    } finally { await io.rm(temp, { force: true }).catch(() => {}); }
  }
  async function scan(token) {
    if (!live(token)) return current;
    if (!threadId) return publish({ reason: 'not_configured' }, token);
    let handle;
    try {
      // Revert creates a new filename for the same thread. Rediscover names only;
      // choose the official (filename timestamp, rollout UUID) maximum, not mtime.
      const selected = await findFile(path.join(home, 'sessions'), token);
      if (!live(token)) return current;
      if (selected?.file !== file) { closeWatch(); file = selected?.file || null; }
      if (!file) return failure('source_missing', token, true);
      if (selected.compressed) return publish({ health: 'error', reason: 'unsupported_compression' }, token);
      handle = await io.open(file, 'r');
      if (!live(token)) return current;
      const stat = await handle.stat();
      if (!live(token)) return current;
      const identity = hash(`${file}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`);
      let rebuilt = identity !== streamId || stat.size < readOffset;
      if (!rebuilt && anchor && offset) {
        const bytes = Buffer.alloc(Math.min(offset, 256));
        await handle.read(bytes, 0, bytes.length, offset - bytes.length);
        if (!live(token)) return current;
        rebuilt = hash(bytes) !== anchor;
      }
      if (rebuilt) { reset(); streamId = identity; historyBoundary = stat.size; }
      if (blocked) return publish({ health: 'error', reason: blocked }, token);
      let history = initial, rolledBack = false, changed = false;
      const completions = new Set();
      fault = null;
      while (readOffset < stat.size && live(token) && !blocked) {
        const bytes = Buffer.alloc(Math.min(64 * 1024, stat.size - readOffset));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, readOffset);
        if (!live(token)) return current;
        if (!bytesRead) break;
        readOffset += bytesRead;
        const chunk = Buffer.concat([pending, bytes.subarray(0, bytesRead)]);
        pending = Buffer.alloc(0);
        let start = 0, newline;
        while ((newline = chunk.indexOf(10, start)) !== -1) {
          const lineOffset = offset;
          offset += skippedBytes + newline - start + 1; skippedBytes = 0;
          const line = chunk.subarray(start, newline); start = newline + 1;
          if (skipping || line.length > MAX_LINE_BYTES) { skipping = false; fault = 'line_too_large'; continue; }
          try {
            const event = parseLine(line.toString('utf8'), { sessionId: threadId, streamId, offset: lineOffset, observedAt: Date.now() });
            if (!event) continue;
            if (event.kind === 'session_meta') {
              if (metadata || event.sessionId !== threadId || !event.root) { blocked = 'identity_mismatch'; break; }
              if (!event.supported) { blocked = 'unsupported_version'; break; }
              metadata = event; continue;
            }
            if (!metadata) { blocked = 'identity_mismatch'; break; }
            rolledBack = consume(event, history || lineOffset < historyBoundary) || rolledBack;
            if (rolledBack) history = true;
            const latest = turns.at(-1);
            if (!history && event.kind === 'turn_completed' && latest?.id === event.turnId && latest.live && latest.phase === 'completed') {
              const key = threadId + ':' + latest.id;
              if (!completedKeys.has(key)) completions.add(key);
            }
            changed = true;
          } catch (error) { fault = error.code || 'invalid_event'; }
        }
        const rest = chunk.subarray(start);
        if (skipping || rest.length > MAX_LINE_BYTES) {
          // Discard oversized contents but keep its byte position until newline.
          skipping = true; fault = 'line_too_large'; skippedBytes += rest.length;
        } else pending = Buffer.from(rest);
      }
      if (!live(token)) return current;
      if (offset) {
        const bytes = Buffer.alloc(Math.min(offset, 256));
        await handle.read(bytes, 0, bytes.length, offset - bytes.length);
        if (!live(token)) return current;
        anchor = hash(bytes);
      }
      attach(token);
      if (blocked) return publish({ health: 'error', reason: blocked }, token);
      if (!metadata) return failure('metadata_missing', token);
      const turn = turns.at(-1);
      const uncertain = ambiguous || turn?.phase === 'running' && !turn.live;
      const value = { health: uncertain ? 'stale' : 'ready', phase: uncertain ? 'unknown' : turn?.phase || 'idle',
        sessionId: threadId, turnId: turn?.id || null, completionKey: null,
        reason: uncertain ? 'previous_turn_unconfirmed' : null, cliVersion: SUPPORTED_VERSION };
      const key = turn ? threadId + ':' + turn.id : null;
      if (!history && !rolledBack && !fault && changed && turn?.phase === 'completed' && turn.live && !completedKeys.has(key)) value.completionKey = key;
      // Historical and suppressed completions are consumed too; recovery never replays them.
      for (const item of turns) if (item.phase === 'completed') completedKeys.add(threadId + ':' + item.id);
      initial = false;
      if (fault) { for (const item of turns) item.live = false; value.health = 'stale'; value.reason = fault; value.completionKey = null; }
      try { if (!await persist(token, value, completedKeys)) return current; }
      catch { value.health = 'stale'; value.reason = 'persist_failed'; value.completionKey = null; }
      if (!history && !rolledBack && !fault && value.health === 'ready') {
        for (const completed of completions) if (completed !== value.completionKey) {
          publish({ ...value, phase: 'completed', turnId: completed.slice(threadId.length + 1), completionKey: completed }, token);
        }
      }
      if (value.health === 'ready') lastGood = snapshot('codex', value);
      return publish(value, token);
    } catch {
      if (!live(token)) return current;
      return failure('read_failed', token, !lastGood);
    } finally { if (handle) await handle.close().catch(() => {}); }
  }
  function refresh() {
    if (!active) return Promise.resolve(current);
    const token = epoch;
    const task = queue.catch(() => {}).then(() => live(token) ? scan(token) : current);
    queue = task; return task;
  }
  return {
    async start(callback) {
      if (active) return;
      active = true; const token = ++epoch; emit = callback;
      reset(); lastGood = null; completedKeys = new Set(); file = null;
      const binding = getConfig().agent?.codex || {};
      home = typeof binding.codexHome === 'string' && binding.codexHome.trim() ? path.resolve(binding.codexHome.trim()) : path.join(os.homedir(), '.codex');
      try { threadId = binding.threadId ? normalizeThreadId(binding.threadId) : null; }
      catch { threadId = null; publish({ health: 'error', reason: 'invalid_thread' }, token); return; }
      summaryFile = options.eventDir && threadId ? path.join(options.eventDir, 'codex-' + threadId + '.json') : null;
      if (summaryFile) {
        try {
          const prior = JSON.parse(await io.readFile(summaryFile, 'utf8'));
          if (prior.schemaVersion === 1 && prior.sessionId === threadId && Array.isArray(prior.completedKeys)) {
            for (const key of prior.completedKeys) if (typeof key === 'string' && key.startsWith(threadId + ':') && /^[a-zA-Z0-9_-]{1,128}$/.test(key.slice(threadId.length + 1))) completedKeys.add(key);
          }
        } catch { /* Historical rebuild also deduplicates when no valid summary exists. */ }
      }
      if (!live(token)) return;
      await refresh();
      if (live(token) && threadId) poll = timers.setInterval(() => { if (live(token)) refresh(); }, 1000);
    },
    refresh,
    async stop() {
      if (!active) return;
      active = false; ++epoch; emit = null;
      if (poll) timers.clearInterval(poll);
      if (debounce) timers.clearTimeout(debounce);
      poll = debounce = null; closeWatch();
      await queue.catch(() => {});
      current = snapshot('codex', { reason: 'disabled' });
    }
  };
}
module.exports = { createAdapter };
