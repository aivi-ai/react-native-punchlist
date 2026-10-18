import { MAX_LABEL_CODE_POINTS } from './constants';
import type { Context } from './types';
import { truncateCodePoints } from './util';

/**
 * Pure screen-capture helpers. Capture happens on a successful FAB activation
 * (tap or accessibility activation) — never on pointer-down, never on a
 * cancelled drag/long-press — and the resolver is called synchronously exactly
 * once, then frozen for the whole editor session.
 */

const MD_META = /[\\`*_{}[\]()#+.!|~>]/g;

/** Escape markdown metacharacters so a host-supplied name renders literally. */
export function escapeMarkdownLabel(label: string): string {
  return label.replace(MD_META, (char) => `\\${char}`);
}

/** Collapse to a single line, strip control characters, trim, cap at 120 code points. */
export function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code === 0x2028 || code === 0x2029 || code === 0x20) {
      out += ' ';
    } else if (code < 0x20 || code === 0x7f) {
      // Other control characters become a space so words are not joined.
      out += ' ';
    } else {
      out += raw[i];
    }
  }
  const single = out.replace(/\s+/g, ' ').trim();
  if (single.length === 0) return null;
  return truncateCodePoints(single, MAX_LABEL_CODE_POINTS);
}

function sanitizeValue(value: unknown): string | number | boolean | null | undefined {
  // eslint-disable-next-line no-control-regex -- control characters must be stripped before display
  if (typeof value === 'string') return truncateCodePoints(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), 200);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (value === null) return null;
  return undefined;
}

/** Sanitized, frozen copy of a host context. Unknown/undefined values are dropped. */
export function sanitizeContext(context: Context | null | undefined): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!context || typeof context !== 'object') return out;
  for (const key of Object.keys(context)) {
    const value = sanitizeValue((context as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface CaptureSnapshot {
  /** Escaped label used inside the task prefix, or null when unavailable/disabled. */
  label: string | null;
  /** Full markdown task prefix, e.g. `- [ ] CheckoutScreen: ` or `- [ ] `. */
  prefix: string;
  /** Sanitized context frozen at capture time (payload metadata). */
  meta: Record<string, string | number | boolean | null>;
  /** Monotonic id so the store can tell one activation from the next. */
  generation: number;
}

let captureGeneration = 0;

/** Escape-marked label suitable for a payload's `meta`/`label`. */
export function captureLabelFor(context: Context | null | undefined): string | null {
  return normalizeLabel(context?.component) ?? normalizeLabel(context?.screen);
}

/** Build the markdown task prefix for a capture. */
export function taskPrefix(label: string | null): string {
  if (!label) return '- [ ] ';
  return `- [ ] ${escapeMarkdownLabel(label)}: `;
}

/**
 * Capture the current screen. The resolver is host-owned and synchronous; a
 * throwing resolver degrades to plain capture instead of failing the tap.
 */
export function captureNow(
  getContext: (() => Context | null | undefined) | undefined,
  prefillScreen: boolean,
): CaptureSnapshot {
  captureGeneration += 1;
  const generation = captureGeneration;
  let context: Context | null | undefined;
  try {
    context = getContext ? getContext() : undefined;
  } catch {
    context = undefined;
  }
  const meta = sanitizeContext(context);
  if (!prefillScreen) return { label: null, prefix: taskPrefix(null), meta, generation };
  const rawLabel = captureLabelFor(context);
  return { label: rawLabel, prefix: taskPrefix(rawLabel), meta, generation };
}

/** A line that is exactly an empty task marker. */
export function isBlankTaskLine(line: string): boolean {
  return line.replace(/\s+$/u, '') === '- [ ]';
}

/** A line that consists only of the generated, untouched draft prefix. */
export function isPrefixOnlyDraft(line: string, prefix: string): boolean {
  return line.replace(/\s+$/u, '') === prefix.replace(/\s+$/u, '');
}
