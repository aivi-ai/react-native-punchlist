import { isFiniteNumber } from './util';

/**
 * Small, bounded, deterministic markdown subset parser/renderer shared by the
 * preview UI and (in spirit) the receiver. No regex with nested quantifiers:
 * every inline construct is found with `indexOf`, so worst case is linear in
 * the source length and nothing can backtrack catastrophically.
 *
 * Supported: h1–h3, bullets, ordered lists, task checks, bold, italic,
 * inline/fenced code, HTTP(S) links, horizontal rules. Everything else — raw
 * HTML included — is literal text.
 */

export type InlineSpan =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'bold'; text: string; start: number; end: number }
  | { kind: 'italic'; text: string; start: number; end: number }
  | { kind: 'code'; text: string; start: number; end: number }
  | { kind: 'link'; text: string; start: number; end: number; url: string };

export interface TaskMarker {
  checked: boolean;
  /** Absolute source offsets of the `[ ]` / `[x]` bracket pair (inclusive start, exclusive end). */
  span: { start: number; end: number };
}

export interface ListItem {
  ordered: boolean;
  index: number;
  indent: number;
  marker: string;
  task: TaskMarker | null;
  spans: InlineSpan[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; lang: string | null; text: string }
  | { kind: 'hr' };

export interface MarkdownDocument {
  blocks: Block[];
  /** True when the renderer downgraded to plain text for bounded cost. */
  plainFallback: boolean;
}

/** Above this size the preview degrades to a single plain-text paragraph. */
export const MAX_RENDER_CHARS = 100_000;
const MAX_INLINE_DEPTH = 3;
const MAX_LIST_DEPTH = 4;

const BULLET_RE = /^ {0,8}([-*+])(?: +|$)/;
const ORDERED_RE = /^ {0,8}(\d{1,9})([.)])(?: +|$)/;
const TASK_RE = /^\[([ xX])\](?: +|$)/;

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s<>"']+$/i.test(url);
}

function pushText(spans: InlineSpan[], text: string, start: number, end: number): void {
  if (text === '') return;
  const last = spans[spans.length - 1];
  if (last && last.kind === 'text' && last.end === start) {
    spans[spans.length - 1] = { kind: 'text', text: last.text + text, start: last.start, end };
    return;
  }
  spans.push({ kind: 'text', text, start, end });
}

/**
 * Parse inline markup in `text`, which occupies `[offset, offset + text.length)`
 * in the original source. Nesting is limited to `MAX_INLINE_DEPTH`.
 */
export function parseInline(text: string, offset: number, depth = 0): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let bufferStart = 0;
  let i = 0;

  const flush = (end: number) => {
    pushText(spans, text.slice(bufferStart, end), offset + bufferStart, offset + end);
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '\\' && i + 1 < text.length) {
      // Escaped metacharacter: emit the literal next char, drop the backslash.
      flush(i);
      pushText(spans, text[i + 1], offset + i + 1, offset + i + 2);
      i += 2;
      bufferStart = i;
      continue;
    }

    if (char === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        flush(i);
        spans.push({ kind: 'code', text: text.slice(i + 1, close), start: offset + i, end: offset + close + 1 });
        i = close + 1;
        bufferStart = i;
        continue;
      }
    }

    if (char === '[' && text[i - 1] !== '!') {
      // `![alt](src)` is an image: unsupported, so it stays literal text.
      const close = text.indexOf(']', i + 1);
      if (close > i + 1 && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close + 2) {
          const url = text.slice(close + 2, paren);
          if (isHttpUrl(url)) {
            flush(i);
            spans.push({
              kind: 'link',
              text: text.slice(i + 1, close),
              start: offset + i,
              end: offset + paren + 1,
              url,
            });
            i = paren + 1;
            bufferStart = i;
            continue;
          }
        }
      }
    }

    if (depth < MAX_INLINE_DEPTH) {
      if (char === '*' && text[i + 1] === '*') {
        const close = text.indexOf('**', i + 2);
        if (close > i + 2) {
          flush(i);
          const inner = text.slice(i + 2, close);
          spans.push({ kind: 'bold', text: inner, start: offset + i, end: offset + close + 2 });
          i = close + 2;
          bufferStart = i;
          continue;
        }
      }
      if ((char === '*' || char === '_') && !(char === '_' && isWordChar(text[i - 1]) && isWordChar(text[i + 1]))) {
        const close = text.indexOf(char, i + 1);
        if (close > i + 1) {
          flush(i);
          spans.push({ kind: 'italic', text: text.slice(i + 1, close), start: offset + i, end: offset + close + 1 });
          i = close + 1;
          bufferStart = i;
          continue;
        }
      }
    }

    i++;
  }
  flush(text.length);
  return spans;
}

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[0-9A-Za-z]/.test(char);
}

function isFence(line: string): boolean {
  return /^ {0,3}(`{3,}|~{3,})/.test(line);
}

function fenceInfo(line: string): { marker: string; lang: string | null } {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/);
  if (!match) return { marker: '```', lang: null };
  const lang = match[2].trim();
  return { marker: match[1][0].repeat(3), lang: lang === '' ? null : lang };
}

function indentOf(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') count++;
  return Math.min(Math.floor(count / 2), MAX_LIST_DEPTH);
}

/** Parse a document into a bounded block list. */
export function parseDocument(source: string): MarkdownDocument {
  if (source.length > MAX_RENDER_CHARS) {
    return { blocks: [{ kind: 'paragraph', spans: [{ kind: 'text', text: source, start: 0, end: source.length }] }], plainFallback: true };
  }

  const blocks: Block[] = [];
  const lines: Array<{ text: string; start: number }> = [];
  {
    let cursor = 0;
    for (const raw of source.split('\n')) {
      lines.push({ text: raw, start: cursor });
      cursor += raw.length + 1;
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const text = line.text;

    if (isFence(text)) {
      const info = fenceInfo(text);
      const fenceChar = info.marker[0];
      i++;
      let body = '';
      let closed = false;
      while (i < lines.length) {
        const inner = lines[i];
        if (isFence(inner.text) && inner.text.trim().startsWith(fenceChar + fenceChar + fenceChar)) {
          closed = true;
          i++;
          break;
        }
        body += inner.text + (i + 1 < lines.length ? '\n' : '');
        i++;
      }
      if (!closed) body = body.replace(/\n$/, '');
      blocks.push({ kind: 'code', lang: info.lang, text: body });
      continue;
    }

    if (text.trim() === '') {
      i++;
      continue;
    }

    const heading = text.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, spans: parseInline(heading[2], line.start + heading[1].length + 1) });
      i++;
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    const bullet = BULLET_RE.exec(text);
    const ordered = ORDERED_RE.exec(text);
    if (bullet || ordered) {
      const listStart = i;
      const orderedList = Boolean(ordered);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const currentText = current.text;
        const currentBullet = BULLET_RE.exec(currentText);
        const currentOrdered = ORDERED_RE.exec(currentText);
        if (currentText.trim() === '' || (!currentBullet && !currentOrdered) || Boolean(currentOrdered) !== orderedList) break;
        // Keep the trailing space in the marker so the task brackets are detected.
        const marker = orderedList ? currentOrdered![0] : currentBullet![0];
        const body = currentText.slice(marker.length);
        const markerEnd = current.start + marker.length;
        let task: TaskMarker | null = null;
        let contentStart = markerEnd;
        const taskMatch = TASK_RE.exec(body);
        if (taskMatch) {
          const bracketStart = markerEnd;
          task = { checked: taskMatch[1].toLowerCase() === 'x', span: { start: bracketStart, end: bracketStart + 3 } };
          contentStart = bracketStart + taskMatch[0].length;
        }
        items.push({
          ordered: orderedList,
          index: items.length,
          indent: indentOf(currentText),
          marker: marker + (task ? taskMatch![0] : ' '),
          task,
          spans: parseInline(currentText.slice(contentStart - current.start), contentStart),
        });
        i++;
        if (items.length > 2000) break;
      }
      if (items.length === 0) {
        i = listStart + 1;
        blocks.push({ kind: 'paragraph', spans: parseInline(text, line.start) });
        continue;
      }
      blocks.push({ kind: 'list', ordered: orderedList, items });
      continue;
    }

    // Paragraph: consecutive plain lines.
    const paraStart = i;
    let paraText = text;
    i++;
    while (i < lines.length) {
      const next = lines[i].text;
      if (
        next.trim() === '' ||
        isFence(next) ||
        /^(#{1,3})\s+/.test(next) ||
        BULLET_RE.test(next) ||
        ORDERED_RE.test(next) ||
        /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(next)
      ) {
        break;
      }
      paraText += '\n' + next;
      i++;
    }
    blocks.push({ kind: 'paragraph', spans: parseInline(paraText, lines[paraStart].start) });
  }

  return { blocks, plainFallback: false };
}

/** Count open/done tasks, excluding fenced code. */
export function countTasks(source: string): { openTasks: number; doneTasks: number } {
  const { blocks } = parseDocument(source);
  let openTasks = 0;
  let doneTasks = 0;
  for (const block of blocks) {
    if (block.kind !== 'list') continue;
    for (const item of block.items) {
      if (!item.task) continue;
      if (item.task.checked) doneTasks++;
      else openTasks++;
    }
  }
  return { openTasks, doneTasks };
}

/**
 * Toggle a task checkbox by absolute source span. Returns null when the span no
 * longer holds a checkbox (caller must treat that as a stale revision).
 */
export function toggleTask(source: string, span: { start: number; end: number }, checked: boolean): string | null {
  const current = source.slice(span.start, span.end);
  if (!/^\[[ xX]\]$/.test(current)) return null;
  const next = checked ? '[x]' : '[ ]';
  if (current === next) return source;
  return source.slice(0, span.start) + next + source.slice(span.end);
}

/** True when `index` sits inside a fenced code block. */
export function isInsideFence(source: string, index: number): boolean {
  let open = false;
  let cursor = 0;
  while (true) {
    const next = source.indexOf('\n', cursor);
    const lineEnd = next === -1 ? source.length : next;
    if (cursor > index) break;
    if (isFence(source.slice(cursor, lineEnd))) open = !open;
    if (next === -1) break;
    cursor = next + 1;
  }
  return open;
}

/** Number of chars/bytes for the payload stats. */
export function statsFor(source: string, bytes: number): { openTasks: number; doneTasks: number; chars: number; bytes: number } {
  const tasks = countTasks(source);
  return { openTasks: tasks.openTasks, doneTasks: tasks.doneTasks, chars: source.length, bytes };
}

/** True when the document has no meaningful content to send. */
export function isSendableContent(source: string, trackedPrefix?: string | null): boolean {
  const trimmed = source.trim();
  if (trimmed === '') return false;
  // An untouched generated draft (optionally with a blank task marker) is not content.
  const lines = trimmed.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return false;
  const onlyDrafts = lines.every((line) => {
    const bare = line.replace(/\s+$/u, '');
    return bare === '- [ ]' || (trackedPrefix ? bare === trackedPrefix.replace(/\s+$/u, '') : false);
  });
  return !onlyDrafts;
}

export { isFiniteNumber };
