/** Shared platform-layer types (imported by both `index.ts` and `index.web.ts`). */

export interface PlatformInfo {
  os: string;
  version: string;
}

export interface KeyboardFrame {
  /** Window-space Y of the keyboard top edge, or Infinity when hidden. */
  screenY: number;
  height: number;
}

export type ShareOutcome = 'shared' | 'dismissed' | 'unsupported' | 'failed';
