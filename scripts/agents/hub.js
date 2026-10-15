'use strict';
const { snapshot } = require('./schema');

function createHub({ adapters, activeProvider = 'workbuddy', onSnapshot = () => {} }) {
  let provider = activeProvider, current = snapshot(provider), rev = 0, generation = 0;
  let running = null, disposed = false, queue = Promise.resolve();
  const enabled = new Map();

  function publish(value) {
    current = snapshot(provider, { ...value, provider, rev: ++rev });
    onSnapshot(current);
  }

  function enqueue(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }

  async function reconcile(force = false) {
    if (disposed) return;
    const desired = enabled.get(provider) !== false ? adapters[provider] : null;
    if (running === desired && !force && running) return;
    const epoch = ++generation;
    if (running) await running.stop();
    running = null;
    publish(snapshot(provider, { reason: enabled.get(provider) === false ? 'disabled' : 'not_configured' }));
    if (!desired) return;
    running = desired;
    try {
      await desired.start(value => {
        if (!disposed && generation === epoch && running === desired) publish(value);
      });
    } catch {
      if (generation === epoch) {
        ++generation;
        running = null;
        try { await desired.stop(); } catch { /* Surface the startup failure below. */ }
        publish(snapshot(provider, { health: 'error', reason: 'start_failed' }));
      }
    }
  }

  return {
    setActiveProvider(id) {
      return enqueue(async () => {
        if (disposed) return;
        const changed = id !== provider;
        provider = id;
        await reconcile(changed);
      });
    },
    setEnabled(id, value) {
      return enqueue(async () => {
        if (disposed) return;
        const changed = enabled.get(id) !== !!value;
        enabled.set(id, !!value);
        if (id === provider && changed) await reconcile();
      });
    },
    // Manual refresh uses the same queue and cannot bypass disabled/disposed state.
    refresh() {
      return enqueue(async () => { if (!disposed && running) await running.refresh(); });
    },
    getSnapshot() { return current; },
    dispose() {
      return enqueue(async () => {
        if (disposed) return;
        disposed = true;
        ++generation;
        if (running) await running.stop();
        running = null;
      });
    }
  };
}
module.exports = { createHub };
