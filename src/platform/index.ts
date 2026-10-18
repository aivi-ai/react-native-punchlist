import { Alert, AppState, Keyboard, Linking, Platform, Share } from 'react-native';
import type { KeyboardFrame, PlatformInfo, ShareOutcome } from './types';

/**
 * Native platform layer. Every platform-sensitive capability the UI/store needs
 * is behind this module (and its `.web.ts` sibling), so the published core has
 * exactly one place that touches native APIs.
 */

export function platformInfo(): PlatformInfo {
  return { os: Platform.OS, version: String(Platform.Version ?? '') };
}

/** Confirm a destructive action with the platform's own dialog. */
export function confirmClear(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Clear punch list',
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Clear', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Flush-on-background hook (the OS gives no guaranteed time on suspend). */
export function subscribeLifecycle(onFlush: (reason: string) => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') onFlush('background');
  });
  return () => subscription.remove();
}

/** Keyboard frame changes, normalized to "top edge in window coordinates". */
export function subscribeKeyboardFrames(onChange: (frame: KeyboardFrame) => void): () => void {
  const show = Keyboard.addListener('keyboardDidShow', (event) => {
    onChange({ screenY: event.endCoordinates.screenY, height: event.endCoordinates.height });
  });
  const hide = Keyboard.addListener('keyboardDidHide', () => onChange({ screenY: Number.POSITIVE_INFINITY, height: 0 }));
  const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
    onChange({ screenY: event.endCoordinates.screenY, height: event.endCoordinates.height });
  });
  return () => {
    show.remove();
    hide.remove();
    change.remove();
  };
}

export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  if (typeof Share?.share !== 'function') return 'unsupported';
  try {
    await Share.share({ message: text, title });
    return 'shared';
  } catch (error) {
    return error instanceof Error && /dismiss/i.test(error.message) ? 'dismissed' : 'failed';
  }
}

/** Native clipboard is not part of the core API surface (web-only, guarded). */
export async function copyText(_text: string): Promise<boolean> {
  return false;
}

/** No hardware hotkey on native. */
export function subscribeHotkey(_handler: () => void): () => void {
  return () => undefined;
}

export function openUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  void Linking.openURL(url).catch(() => undefined);
  return true;
}
