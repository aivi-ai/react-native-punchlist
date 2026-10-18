/**
 * One bounded, deterministic markdown parser shared by both receivers.
 *
 * The client-side preview uses its own implementation in the RN package; this
 * module is the *server* half of the same subset contract:
 *   h1-h3, bullets, ordered lists, task checks, bold, italic, inline/fenced
 *   code, HTTP(S) links, horizontal rules.
 * Anything unsupported or malformed is literal text. Raw HTML is never
 * interpreted here — the renderer escapes it.
 *
 * Safety properties, all enforced without backtracking-prone regexes:
 *   - single linear scan per line, no nested quantifiers
 *   - hard cap on lines scanned (TASK_SCAN_MAX_LINES)
 *   - hard cap on fenced-code accumulation
 *   - no recursion at all, so no stack blow-up on adversarial input
 */
import { TASK_SCAN_MAX_LINES } from './limits.mjs';
import { utf8ByteLength } from './validate.mjs';

/** @typedef {{type:'heading',level:number,text:string}} HeadingBlock */
/** @typedef {{type:'hr'}} HrBlock */
/** @typedef {{type:'code',lang:string,text:string}} CodeBlock */
/** @typedef {{type:'list',ordered:boolean,start:number,items:Array<{checked:boolean|null,text:string}>}} ListBlock */
/** @typedef {{type:'paragraph',text:string}} ParagraphBlock */

/** Normalize line endings and strip a UTF-8 BOM. */
export function normalizeMarkdown(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

const BULLET_RE = /^(\s{0,3})[-*+][ \t]+(.*)$/;
const ORDERED_RE = /^(\s{0,3})(\d{1,9})[.)][ \t]+(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]?(.*)$/;
const HEADING_RE = /^(#{1,3})(?:[ \t]+(.*))?$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;

/**
 * Parse markdown into a bounded block list.
 * @param {string} text
 * @returns {{blocks: Array<HeadingBlock|HrBlock|CodeBlock|ListBlock|ParagraphBlock>, truncated: boolean}}
 */
export function parseMarkdown(text) {
  const src = normalizeMarkdown(text);
  const lines = src.split('\n');
  const truncated = lines.length > TASK_SCAN_MAX_LINES;
  const limit = truncated ? TASK_SCAN_MAX_LINES : lines.length;

  /** @type {Array<any>} */
  const blocks = [];
  /** @type {any} pending paragraph buffer */
  let paragraph = [];
  /** @type {any} pending list buffer */
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (let i = 0; i < limit; i++) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const marker = fence[2][0];
      const lang = fence[3] || '';
      const body = [];
      i++;
      for (; i < limit; i++) {
        const candidate = lines[i];
        const closing = FENCE_RE.exec(candidate);
        if (closing && closing[2][0] === marker && closing[3] === '') break;
        body.push(candidate);
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'hr' });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] || '' });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const rawText = bullet ? bullet[2] : ordered[3];
      const start = ordered ? Math.min(Number.parseInt(ordered[2], 10) || 1, 999999999) : 1;
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { type: 'list', ordered: isOrdered, start, items: [] };
      }
      let checked = null;
      let itemText = rawText;
      const task = TASK_RE.exec(rawText);
      if (task) {
        checked = task[1].toLowerCase() === 'x';
        itemText = task[2];
      }
      list.items.push({ checked, text: itemText });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  if (truncated) {
    blocks.push({ type: 'paragraph', text: `[note truncated at ${TASK_SCAN_MAX_LINES} lines]` });
  }

  return { blocks, truncated };
}

/**
 * Deterministic task counter derived from the parsed blocks, excluding fenced
 * code. Shares the parser with the route contract so the numbers the receiver
 * returns always match the markdown it stored.
 *
 * @param {Array<any>} blocks
 * @returns {{openTasks:number,doneTasks:number}}
 */
export function countTasks(blocks) {
  let openTasks = 0;
  let doneTasks = 0;
  for (const block of blocks) {
    if (block.type !== 'list') continue;
    for (const item of block.items) {
      if (item.checked === true) doneTasks++;
      else if (item.checked === false) openTasks++;
    }
  }
  return { openTasks, doneTasks };
}

/**
 * stats for a stored note, recomputed server-side from the content.
 * @param {string} content
 */
export function computeStats(content) {
  const normalized = normalizeMarkdown(content);
  const { blocks } = parseMarkdown(normalized);
  const { openTasks, doneTasks } = countTasks(blocks);
  return {
    openTasks,
    doneTasks,
    chars: normalized.length,
    bytes: utf8ByteLength(normalized),
  };
}

/* ------------------------------------------------------------------ */
/* Inline parsing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parse an inline run into nodes. Never throws, never recurses, linear scan.
 * @param {string} text
 * @returns {Array<{type:'text',text:string}|{type:'code',text:string}|{type:'strong',text:string}|{type:'em',text:string}|{type:'link',text:string,href:string}>}
 */
export function parseInline(text) {
  const src = typeof text === 'string' ? text : '';
  const nodes = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };
  const indexOfFrom = (needle, from) => src.indexOf(needle, from);

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < src.length && '`*_[\\]'.includes(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = indexOfFrom('`', i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '*' && src[i + 1] === '*') {
      const end = indexOfFrom('**', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ type: 'strong', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '_' && src[i + 1] === '_') {
      const end = indexOfFrom('__', i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ type: 'strong', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const end = indexOfFrom(ch, i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'em', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = indexOfFrom('](', i + 1);
      if (close > i) {
        const end = indexOfFrom(')', close + 2);
        if (end > close + 2) {
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, end).trim();
          const safe = /^https?:\/\//i.test(href) && href.length <= 2048 ? href : null;
          flush();
          if (safe) {
            nodes.push({ type: 'link', text: label, href: safe });
          } else {
            /* Unsafe scheme: render the whole construct as literal text. */
            nodes.push({ type: 'text', text: src.slice(i, end + 1) });
          }
          i = end + 1;
          continue;
        }
      }
    }

    buffer += ch;
    i++;
  }

  flush();
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Representations                                                     */
/* ------------------------------------------------------------------ */

/** Plain-text (text/plain) representation: the markdown source itself. */
export function toPlainText(record) {
  return normalizeMarkdown(record.content);
}

/** Canonical markdown representation. */
export function toMarkdown(record) {
  return normalizeMarkdown(record.content);
}

/**
 * JSON representation. Deliberately flat and small: the client only reads
 * optional `{url,id,expiresAt}` on POST, and this body is what a human (or a
 * script) gets from GET /n/:id.json.
 */
export function toJson(record, baseUrl) {
  const content = normalizeMarkdown(record.content);
  return {
    id: record.id,
    appId: record.appId,
    version: record.version,
    content,
    url: baseUrl ? `${baseUrl}/n/${record.id}` : undefined,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    sentAt: record.sentAt || null,
    updatedAt: record.updatedAt || null,
    stats: record.stats,
    meta: record.meta,
  };
}
