'use strict';
const CAPABILITIES = {
  workbuddy: { lifecycle: true, waitingApproval: true, waitingInput: false, sessionClosed: false },
  codex: { lifecycle: true, waitingApproval: false, waitingInput: false, sessionClosed: false }
};
function snapshot(provider, fields = {}) {
  const value = { schemaVersion: 1, provider, health: 'unconfigured', sessionId: null,
    turnId: null, phase: 'unknown', completionKey: null, observedAt: Date.now(), rev: 0,
    reason: null, ...fields,
    counts: Object.freeze({ processing: null, pending: null, approval: null, ...fields.counts }),
    capabilities: Object.freeze({ ...CAPABILITIES[provider], ...fields.capabilities }) };
  return Object.freeze(value);
}
function toPetState(s) {
  return { ...s, normalizedAgent: true, processing: s.counts.processing || 0,
    pending: s.counts.pending || 0, approval: s.counts.approval || 0,
    completed: s.completed || 0, conversations: s.conversations || 0, session: s.sessionId,
    scope: s.scope || 'current', ts: s.observedAt,
    ok: s.health === 'ready', degraded: s.health === 'stale' || s.health === 'error',
    error: s.health === 'ready' && s.phase === 'failed',
    justDone: s.health === 'ready' && s.phase === 'completed' && !!s.completionKey,
    errors: s.reason ? [s.reason] : [] };
}
module.exports = { snapshot, toPetState };
