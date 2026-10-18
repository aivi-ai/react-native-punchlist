import { taskPrefix } from '../../src/capture';
import {
  applySmartList,
  lineBoundsAt,
  planCloseRemoval,
  planOpenInsertion,
  stampLine,
} from '../../src/insertion';
import { countTasks, parseDocument, toggleTask } from '../../src/markdown';

const A = taskPrefix('CheckoutScreen');
const B = taskPrefix('OrdersScreen');

describe('open() insertion rules', () => {
  it('puts the draft at offset zero in an empty document', () => {
    const plan = planOpenInsertion('', A, { sameScreen: false, ownsDraft: false });
    expect(plan.content).toBe(A);
    expect(plan.selection).toEqual({ start: A.length, end: A.length });
    expect(plan.draft).toEqual({ start: 0, end: A.length, prefix: A });
  });

  it('reuses a bare empty task marker on the last line', () => {
    const plan = planOpenInsertion('note\n- [ ]', A, { sameScreen: false, ownsDraft: false });
    expect(plan.content).toBe(`note\n${A}`);
    expect(plan.appended).toBe(false);
    expect(plan.selection.start).toBe(plan.content.length);
  });

  it('reuses a same-screen prefix-only draft without duplicating it', () => {
    const first = planOpenInsertion('', A, { sameScreen: false, ownsDraft: false });
    const second = planOpenInsertion(first.content, A, { sameScreen: true, ownsDraft: true, previousPrefix: A });
    expect(second.content).toBe(A);
    expect(second.appended).toBe(false);
    expect(second.selection).toEqual({ start: A.length, end: A.length });
  });

  it('replaces its own untouched draft when the screen changed', () => {
    const first = planOpenInsertion('', A, { sameScreen: false, ownsDraft: false });
    const second = planOpenInsertion(first.content, B, { sameScreen: false, ownsDraft: true, previousPrefix: A });
    expect(second.content).toBe(B);
    expect(second.appended).toBe(false);
  });

  it('appends a fresh task when the draft is not the current session version', () => {
    const second = planOpenInsertion(A + '\n' + A, B, { sameScreen: false, ownsDraft: false });
    expect(second.content).toBe(`${A}\n${A}\n${B}`);
    expect(second.appended).toBe(true);
  });

  it('never treats an arbitrary user-authored last line as disposable', () => {
    const plan = planOpenInsertion('user wrote this', A, { sameScreen: true, ownsDraft: true, previousPrefix: A });
    expect(plan.content).toBe(`user wrote this\n${A}`);
    expect(plan.appended).toBe(true);
  });
});

describe('close() removal', () => {
  it('removes only a provably untouched generated draft', () => {
    const plan = planOpenInsertion('note', A, { sameScreen: false, ownsDraft: false });
    const closed = planCloseRemoval(plan.content, plan.draft);
    expect(closed.removed).toBe(true);
    expect(closed.content).toBe('note');
  });

  it('keeps the line when the user typed anything', () => {
    const plan = planOpenInsertion('note', A, { sameScreen: false, ownsDraft: false });
    const closed = planCloseRemoval(`${plan.content}fix the copy`, plan.draft);
    expect(closed.removed).toBe(false);
    expect(closed.content).toContain('fix the copy');
  });

  it('removes the draft when it is the whole document', () => {
    const plan = planOpenInsertion('', A, { sameScreen: false, ownsDraft: false });
    expect(planCloseRemoval(plan.content, plan.draft).content).toBe('');
  });
});

describe('smart list continuation', () => {
  const options = { taskPrefix: A, trackedPrefix: A };

  const type = (prev: string, index: number) => prev.slice(0, index) + '\n' + prev.slice(index);

  it('continues a task with the frozen screen prefix', () => {
    const prev = `${A}first item`;
    const index = prev.length;
    const result = applySmartList(prev, type(prev, index), options);
    expect(result).not.toBeNull();
    expect(result!.content).toBe(`${prev}\n${A}`);
    expect(result!.selection.start).toBe(result!.content.length);
  });

  it('exits the list when Enter is pressed on an empty task', () => {
    const prev = '- [ ] ';
    const result = applySmartList(prev, type(prev, prev.length), { taskPrefix: '- [ ] ' });
    expect(result).not.toBeNull();
    expect(result!.content).toBe('\n');
  });

  it('exits the list on the untouched tracked prefix-only draft', () => {
    const prev = A;
    const result = applySmartList(prev, type(prev, prev.length), options);
    expect(result!.content).toBe('\n');
  });

  it('continues bullets and ordered lists', () => {
    const bullet = '- one';
    expect(applySmartList(bullet, type(bullet, bullet.length), options)!.content).toBe('- one\n- ');
    const ordered = '3. three';
    expect(applySmartList(ordered, type(ordered, ordered.length), options)!.content).toBe('3. three\n4. ');
    const paren = '9) nine';
    expect(applySmartList(paren, type(paren, paren.length), options)!.content).toBe('9) nine\n10) ');
  });

  it('passes through a newline inside the middle of a line', () => {
    const prev = 'hello world';
    expect(applySmartList(prev, type(prev, 5), options)).toBeNull();
  });

  it('passes through multi-character insertions (paste, IME, selected-text replacement)', () => {
    const prev = '- one';
    const pasted = '- one\n- two\n- three';
    expect(applySmartList(prev, pasted, options)).toBeNull();
    const selected = '- one two';
    expect(applySmartList(selected, '- one\ntwo', options)).toBeNull();
  });

  it('passes through newlines inside fenced code blocks', () => {
    const prev = '```\n- not a list item';
    expect(applySmartList(prev, type(prev, prev.length), options)).toBeNull();
  });

  it('passes through when the newline is inside a line (emoji composition)', () => {
    const prev = '😀 task';
    expect(applySmartList(prev, type(prev, 2), options)).toBeNull();
  });
});

describe('toolbar insertions', () => {
  it('keeps line bounds correct for a mid-document caret', () => {
    const content = 'one\ntwo\nthree';
    const bounds = lineBoundsAt(content, 5);
    expect(bounds.text).toBe('two');
    expect(bounds.start).toBe(4);
  });

  it('builds a stamped context line with label, platform and local time', () => {
    const stamp = stampLine('CheckoutScreen', 'ios 18.0', new Date(2026, 9, 18, 9, 5));
    expect(stamp).toBe('_CheckoutScreen · ios 18.0 · 2026-10-18 09:05_');
    expect(stampLine(null, 'web', new Date(2026, 0, 2, 3, 4))).toBe('_web · 2026-01-02 03:04_');
  });
});

describe('checkbox spans', () => {
  it('offers exact source offsets for each task and toggles them', () => {
    const source = '- [ ] first\n  text\n- [x] second';
    const document = parseDocument(source);
    const items = document.blocks.flatMap((block) => (block.kind === 'list' ? block.items : []));
    expect(items).toHaveLength(2);
    const firstSpan = items[0].task!.span;
    expect(source.slice(firstSpan.start, firstSpan.end)).toBe('[ ]');
    const toggled = toggleTask(source, firstSpan, true);
    expect(toggled).toContain('- [x] first');
    expect(countTasks(toggled!)).toEqual({ openTasks: 0, doneTasks: 2 });
  });

  it('refuses a stale span', () => {
    expect(toggleTask('- [ ] first', { start: 0, end: 3 }, true)).toBeNull();
  });
});
