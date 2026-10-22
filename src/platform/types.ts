/** Shared platform-layer types (imported by both `index.ts` and `index.web.ts`). */

export interface PlatformInfo {
  os: string;
  version: string;
}

export type ShareOutcome = 'shared' | 'dismissed' | 'unsupported' | 'failed';
