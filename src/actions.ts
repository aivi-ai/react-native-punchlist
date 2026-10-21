import { store } from './store';
import type { Context, PunchlistActions } from './types';

/**
 * One frozen action surface shared by the singleton, the hook and the ref
 * handle, so every consumer sees stable function identities.
 */
export const actions: PunchlistActions = Object.freeze({
  open: () => store.open(),
  close: () => store.close(),
  toggle: () => store.toggle(),
  show: () => store.show(),
  hide: () => store.hide(),
  append: (markdown: string) => store.append(markdown),
  addTask: (text?: string, context?: Context) => store.addTask(text, context),
  setContent: (text: string) => store.setContent(text),
  clear: () => store.clear(),
  undo: () => store.undo(),
  flush: () => store.flush(),
  send: () => store.send(),
});

/** Imperative API (`punchlist.open()`, …) delegating to the singleton. */
export const punchlist: PunchlistActions = actions;
