import { useMemo, useSyncExternalStore } from 'react';
import { actions } from './actions';
import { store } from './store';
import type { PunchlistActions, PunchlistSnapshot } from './types';

export type PunchlistHook = PunchlistSnapshot &
  PunchlistActions & {
    subscribe(listener: () => void): () => void;
    getSnapshot(): PunchlistSnapshot;
  };

/**
 * Observe the punchlist and call its actions.
 *
 * Calling this hook only subscribes to the store — it never claims ownership or
 * starts storage/network/listener work, so a host may call it anywhere. The
 * action functions have stable identities across renders.
 */
export function usePunchlist(): PunchlistHook {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({ ...snapshot, ...actions, subscribe: store.subscribe, getSnapshot: store.getSnapshot }),
    [snapshot],
  );
}
