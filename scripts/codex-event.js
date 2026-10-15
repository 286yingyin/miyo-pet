'use strict';
// Source lines contain dialogue. Only this whitelist may cross the parser boundary.
const SUPPORTED_VERSION = '0.162.0-alpha.17.2';
const MAX_LINE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
function invalid(code = 'invalid_event') { throw Object.assign(new Error(code), { code }); }
function normalizeThreadId(value) {
  if (typeof value !== 'string') return invalid('CODEX_THREAD_INVALID');
  let id = value.trim();
  if (id.startsWith('codex://')) {
    // Queries may contain remote access credentials. Reject them, never store them.
    const match = /^codex:\/\/threads\/([^/?#]+)$/.exec(id);
    if (!match) return invalid('CODEX_THREAD_INVALID');
    id = match[1];
  }
  if (!UUID.test(id)) return invalid('CODEX_THREAD_INVALID');
  return id.toLowerCase();
}
function parseLine(line, context = {}) {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) return invalid('line_too_large');
  let row;
  try { row = JSON.parse(line); } catch { return invalid(); }
  if (!row || typeof row !== 'object' || typeof row.type !== 'string') return invalid();
  const p = row.payload;
  if (row.type === 'session_meta') {
    if (!p || !UUID.test(p.id || '')) return invalid('identity_mismatch');
    return { kind: 'session_meta', sessionId: p.id.toLowerCase(),
      supported: p.cli_version === SUPPORTED_VERSION,
      root: (p.thread_source === 'user' || p.thread_source === 'agent_created_thread') && p.source === 'vscode' &&
        !p.parent_thread_id && !p.parent_id && !p.parent,
      forked: !!p.forked_from_id };
  }
  if (row.type !== 'event_msg') return null;
  if (!p || typeof p.type !== 'string') return invalid();
  if (p.type === 'thread_rolled_back') {
    if (!Number.isSafeInteger(p.num_turns) || p.num_turns < 0) return invalid();
    return { kind: 'rollback', count: p.num_turns };
  }
  const kinds = { task_started: 'turn_started', turn_started: 'turn_started',
    task_complete: 'turn_completed', turn_complete: 'turn_completed', turn_aborted: 'turn_interrupted' };
  if (!Object.hasOwn(kinds, p.type)) return null;
  let kind = kinds[p.type];
  const turnId = p.turn_id == null ? null : p.turn_id;
  if (turnId === null ? kind !== 'turn_interrupted' : typeof turnId !== 'string' || !ID.test(turnId)) return invalid();
  if (row.ordinal != null && (!Number.isSafeInteger(row.ordinal) || row.ordinal < 0)) return invalid();
  if (kind === 'turn_completed' && p.error != null) kind = 'turn_failed';
  return { schemaVersion: 1, provider: 'codex', sessionId: context.sessionId || null,
    turnId, kind, eventId: `${context.streamId}:${context.offset}:${kind}`,
    sourceTime: typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) ? Date.parse(row.timestamp) : null,
    sourceSequence: row.ordinal ?? null, streamId: context.streamId || null,
    observedAt: context.observedAt ?? Date.now() };
}
module.exports = { parseLine, normalizeThreadId, SUPPORTED_VERSION, MAX_LINE_BYTES };
