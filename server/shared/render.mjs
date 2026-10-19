/**
 * Safe HTML renderer.
 *
 * Guarantees enforced here (and covered by tests):
 *   - every text node and every attribute value is HTML-escaped
 *   - only http(s) links are emitted as <a>, always rel="noopener noreferrer"
 *   - raw HTML in the note is escaped and shown as literal text
 *   - no <img>, <script>, <style>, <iframe>, <object>, event handlers, or
 *     javascript:/data: URLs can be produced from note content
 *   - fenced-code content is emitted as escaped text inside <pre><code>
 *   - static inline styling only (compatible with the strict CSP)
 *
 * The page itself contains no <script>, matching the CSP in headers.mjs.
 */
import { parseMarkdown, parseInline, normalizeMarkdown } from './markdown.mjs';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for an HTML text node or attribute value. */
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const STYLE = [
  ':root{color-scheme:light dark}',
  '*{box-sizing:border-box}',
  'body{margin:0;padding:1.25rem;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
  'main{max-width:52rem;margin:0 auto}',
  'h1,h2,h3{line-height:1.25}',
  'ul,ol{padding-left:1.35rem}',
  'li.task{list-style:none;margin-left:-1.35rem}',
  'li.task input{margin-right:.5rem}',
  'pre{background:#f4f4f5;padding:.75rem;border-radius:6px;overflow:auto}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95em}',
  'hr{border:0;border-top:1px solid #d4d4d8}',
  'dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:1.5rem 0}',
  'dl.meta dt{font-weight:600}',
  'dl.meta dd{margin:0;overflow-wrap:anywhere}',
  'footer{margin-top:2rem;border-top:1px solid #d4d4d8;padding-top:.75rem;font-size:.875rem;opacity:.8}',
  '@media (prefers-color-scheme:dark){pre{background:#27272a}hr,footer{border-color:#3f3f46}}',
].join('');

/**
 * Render inline nodes to HTML. Link hrefs are re-validated here even though
 * parseInline already rejected non-http(s) schemes.
 * @param {Array<any>} nodes
 */
function renderInline(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'code':
        out += `<code>${escapeHtml(node.text)}</code>`;
        break;
      case 'strong':
        out += `<strong>${renderInline(parseInline(node.text))}</strong>`;
        break;
      case 'em':
        out += `<em>${renderInline(parseInline(node.text))}</em>`;
        break;
      case 'link': {
        const href = /^https?:\/\//i.test(node.href) ? node.href : null;
        if (!href) {
          out += escapeHtml(node.text);
          break;
        }
        out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${renderInline(
          parseInline(node.text)
        )}</a>`;
        break;
      }
      default:
        out += escapeHtml(node.text);
    }
  }
  return out;
}

/**
 * Render parsed blocks to HTML.
 * @param {Array<any>} blocks
 */
function renderBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const tag = `h${Math.min(Math.max(block.level, 1), 3)}`;
        parts.push(`<${tag}>${renderInline(parseInline(block.text))}</${tag}>`);
        break;
      }
      case 'hr':
        parts.push('<hr>');
        break;
      case 'code':
        parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const startAttr = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
        const items = block.items.map((item) => {
          if (item.checked === null) {
            return `<li>${renderInline(parseInline(item.text))}</li>`;
          }
          return `<li class="task"><input type="checkbox" disabled${
            item.checked ? ' checked' : ''
          }> ${renderInline(parseInline(item.text))}</li>`;
        });
        parts.push(`<${tag}${startAttr}>${items.join('')}</${tag}>`);
        break;
      }
      default:
        parts.push(`<p>${renderInline(parseInline(block.text)).replace(/\n/g, '<br>')}</p>`);
    }
  }
  return parts.join('\n');
}

/**
 * Render the standalone note page.
 *
 * @param {object} record stored note record
 * @param {string} baseUrl configured PUBLIC_BASE_URL (never the Host header)
 * @returns {string} complete HTML document
 */
export function renderNoteHtml(record, baseUrl) {
  const content = normalizeMarkdown(record.content);
  const { blocks } = parseMarkdown(content);
  const created = new Date(record.createdAt).toISOString();
  const expires = new Date(record.expiresAt).toISOString();
  const stats = record.stats || {};

  const metaRows = Object.entries(record.meta || {}).map(
    ([key, value]) =>
      `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(
        value === null ? 'null' : String(value)
      )}</dd>`
  );

  const title = `Punchlist note ${record.id}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<dl class="meta">
<dt>appId</dt><dd>${escapeHtml(record.appId)}</dd>
<dt>created</dt><dd>${escapeHtml(created)}</dd>
<dt>expires</dt><dd>${escapeHtml(expires)}</dd>
<dt>tasks</dt><dd>${escapeHtml(
    `${stats.openTasks ?? 0} open, ${stats.doneTasks ?? 0} done`
  )}</dd>
<dt>size</dt><dd>${escapeHtml(`${stats.chars ?? 0} chars, ${stats.bytes ?? 0} bytes`)}</dd>
<dt>json</dt><dd><a href="${escapeHtml(`${baseUrl}/n/${record.id}.json`)}" rel="noopener noreferrer">${escapeHtml(
    `${baseUrl}/n/${record.id}.json`
  )}</a></dd>
<dt>plain</dt><dd><a href="${escapeHtml(`${baseUrl}/n/${record.id}.md`)}" rel="noopener noreferrer">${escapeHtml(
    `${baseUrl}/n/${record.id}.md`
  )}</a></dd>
</dl>
${metaRows.length ? `<dl class="meta">${metaRows.join('')}</dl>` : ''}
<article>
${renderBlocks(blocks)}
</article>
<footer>This link is bearer-accessible until it expires and cannot be revoked from copies others have saved.</footer>
</main>
</body>
</html>
`;
}
