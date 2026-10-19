import { countTasks, isHttpUrl, isInsideFence, MAX_RENDER_CHARS, parseDocument } from '../../src/markdown';

describe('markdown subset parser', () => {
  it('parses headings, lists, tasks, rules and code', () => {
    const source = [
      '# Title',
      '',
      '## Section',
      '',
      '- [ ] open task',
      '- [x] done task',
      '- plain bullet',
      '1. first',
      '2. second',
      '',
      '---',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');
    const document = parseDocument(source);
    const kinds = document.blocks.map((block) => block.kind);
    expect(kinds).toEqual(['heading', 'heading', 'list', 'list', 'hr', 'code']);
    const bullets = document.blocks[2];
    expect(bullets.kind === 'list' && bullets.items[0].task?.checked).toBe(false);
    expect(bullets.kind === 'list' && bullets.items[1].task?.checked).toBe(true);
    expect(bullets.kind === 'list' && bullets.items[2].task).toBeNull();
    const ordered = document.blocks[3];
    expect(ordered.kind === 'list' && ordered.ordered).toBe(true);
  });

  it('supports bold, italic, inline code and http(s) links only', () => {
    const document = parseDocument('plain **bold** _italic_ `code` [ok](https://x.test) [bad](javascript:alert(1)) ![img](https://x.test/a.png)');
    const paragraph = document.blocks[0];
    expect(paragraph.kind).toBe('paragraph');
    if (paragraph.kind !== 'paragraph') throw new Error('expected paragraph');
    const kinds = paragraph.spans.map((span) => span.kind);
    expect(kinds).toContain('bold');
    expect(kinds).toContain('italic');
    expect(kinds).toContain('code');
    expect(kinds).toContain('link');
    const links = paragraph.spans.filter((span) => span.kind === 'link');
    expect(links).toHaveLength(1);
    const literal = paragraph.spans.map((span) => span.text).join('');
    expect(literal).toContain('javascript:alert(1)');
  });

  it('keeps raw HTML and malformed markup as literal text', () => {
    const document = parseDocument('<img src=x onerror="alert(1)"> <script>alert(2)</script> **unclosed');
    const paragraph = document.blocks[0];
    if (paragraph.kind !== 'paragraph') throw new Error('expected paragraph');
    const text = paragraph.spans.map((span) => span.text).join('');
    expect(text).toContain('<script>');
    expect(text).toContain('**unclosed');
    expect(paragraph.spans.every((span) => span.kind === 'text')).toBe(true);
  });

  it('treats #### and deeper as literal text', () => {
    const document = parseDocument('#### not a supported heading');
    expect(document.blocks[0].kind).toBe('paragraph');
  });

  it('handles an unclosed fence without hanging', () => {
    const document = parseDocument('```\nstill code');
    expect(document.blocks[0]).toMatchObject({ kind: 'code', text: 'still code' });
  });

  it('degrades to plain text above the render budget', () => {
    const document = parseDocument('x'.repeat(MAX_RENDER_CHARS + 1));
    expect(document.plainFallback).toBe(true);
  });

  it('parses a large nested document without catastrophic backtracking', () => {
    const source = Array.from({ length: 1200 }, (_, index) => `- [ ] item ${index} with *stars* and [link](https://x.test/${index})`).join('\n');
    const started = Date.now();
    const counts = countTasks(source);
    const elapsed = Date.now() - started;
    expect(counts.openTasks).toBe(1200);
    expect(elapsed).toBeLessThan(4000);
  });
});

describe('task counting', () => {
  it('excludes fenced code blocks', () => {
    const source = '- [ ] real\n\n```\n- [x] fake\n- [ ] fake\n```\n- [x] real done';
    expect(countTasks(source)).toEqual({ openTasks: 1, doneTasks: 1 });
  });

  it('ignores checkbox-like text in paragraphs', () => {
    expect(countTasks('the [ ] marker in prose is not a task')).toEqual({ openTasks: 0, doneTasks: 0 });
  });
});

describe('helpers', () => {
  it('recognises safe links only', () => {
    expect(isHttpUrl('https://a.test/x')).toBe(true);
    expect(isHttpUrl('http://a.test')).toBe(true);
    expect(isHttpUrl('javascript:1')).toBe(false);
    expect(isHttpUrl('data:text/html,1')).toBe(false);
  });

  it('reports fenced-code positions', () => {
    const source = 'a\n```\n- [ ] x\n```\nb';
    expect(isInsideFence(source, 6)).toBe(true);
    expect(isInsideFence(source, 0)).toBe(false);
    expect(isInsideFence(source, source.length - 1)).toBe(false);
  });
});
