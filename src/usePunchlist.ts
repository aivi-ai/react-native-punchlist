import { useMemo, useSyncExternalStore } from 'react';
import { store } from './store';
import type { PunchlistSnapshot } from './types';

export type PunchlistHook = PunchlistSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PunchlistSnapshot;
  open(): boolean;
  close(): boolean;
  toggle(): boolean;
  show(): boolean;
  hide(): boolean;
  append(markdown: string): boolean;
  addTask(text?: string, context?: import('./types').Context): boolean;
  setContent(text: string): boolean;
  clear(): Promise<boolean>;
  undo(): boolean;
  flush(): Promise<void>;
  send(): Promise<import('./types').SendResult | void>;
};

/**
 * Observe the punchlist and call its actions.
 *
 * Calling this hook only subscribes to the store — it never claims ownership or
 * starts storage/network/listener work, so a host may call it anywhere.
 */
export function usePunchlist(): PunchlistHook {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({
      ...snapshot,
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,
      open: () => store.open(),
      close: () => store.close(),
      toggle: () => store.toggle(),
      show: () => store.show(),
      hide: () => store.hide(),
      append: (markdown: string) => store.append(markdown),
      addTask: (text?: string, context?: import('./types').Context) => store.addTask(text, context),
      setContent: (text: string) => store.setContent(text),
      clear: () => store.clear(),
      undo: () => store.undo(),
      flush: () => store.flush(),
      send: () => store.send(),
    }),
    [snapshot],
  );
}
