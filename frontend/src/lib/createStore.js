// Minimal external store for React (useSyncExternalStore), so state can be read and changed
// from event handlers, timers and imperative helpers without prop drilling.
import { useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  // store.use is itself a hook (only called from components); the lint rule only recognises names starting with "use"
  // eslint-disable-next-line react-hooks/rules-of-hooks
  store.use = (selector = (s) => s) => useSyncExternalStore(store.subscribe, () => selector(state));
  return store;
}
