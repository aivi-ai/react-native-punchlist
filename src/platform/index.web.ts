import type { PlatformInfo, ShareOutcome } from './types';

/**
 * Web platform layer. Guards every browser global so the module can be imported
 * during SSR (no `window`, `document`, `navigator`) without side effects.
 */

function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

function getWindow(): (Window & typeof globalThis) | null {
  return typeof window === 'undefined' ? null : window;
}

export function platformInfo(): PlatformInfo {
  return { os: 'web', version: '' };
}

export function confirmClear(message: string): Promise<boolean> {
  const win = getWindow();
  if (!win || typeof win.confirm !== 'function') return Promise.resolve(false);
  return Promise.resolve(win.confirm(message));
}

export function subscribeLifecycle(onFlush: (reason: string) => void): () => void {
  const doc = getDocument();
  const win = getWindow();
  const onVisibility = () => onFlush(doc && doc.visibilityState === 'hidden' ? 'pagehide' : 'visibility');
  const onPageHide = () => onFlush('pagehide');
  if (doc) doc.addEventListener('visibilitychange', onVisibility);
  if (win) win.addEventListener('pagehide', onPageHide);
  return () => {
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    if (win) win.removeEventListener('pagehide', onPageHide);
  };
}

export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav || typeof nav.share !== 'function') return 'unsupported';
  try {
    await nav.share({ text, title });
    return 'shared';
  } catch (error) {
    return error instanceof Error && /abort|cancel/i.test(error.message) ? 'dismissed' : 'failed';
  }
}

export async function copyText(text: string): Promise<boolean> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const isSecure = getWindow()?.isSecureContext === true;
  if (!nav?.clipboard || !isSecure) return false;
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const HOTKEY = { key: '.', code: 'Period' } as const;

export function subscribeHotkey(handler: () => void): () => void {
  const doc = getDocument();
  if (!doc) return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== HOTKEY.key && event.code !== HOTKEY.code) return;
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    event.preventDefault();
    handler();
  };
  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

/** Focus trap for the open sheet: keeps Tab inside `container`. */
export function trapFocus(container: HTMLElement): () => void {
  const doc = getDocument();
  if (!doc) return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const focusable = container.querySelectorAll<HTMLElement>(
      'input,textarea,button,[tabindex]:not([tabindex="-1"]),[role="button"]',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = doc.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}

export function openUrl(url: string): boolean {
  const win = getWindow();
  if (!win) return false;
  win.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
