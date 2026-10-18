import {
  captureNow,
  escapeMarkdownLabel,
  isBlankTaskLine,
  isPrefixOnlyDraft,
  normalizeLabel,
  sanitizeContext,
  taskPrefix,
} from '../../src/capture';

describe('label resolution', () => {
  it('prefers component over screen and escapes markdown metacharacters', () => {
    const capture = captureNow(() => ({ screen: 'Checkout', component: 'Checkout*Screen_[1]' }), true);
    expect(capture.label).toBe('Checkout*Screen_[1]');
    expect(capture.prefix).toBe('- [ ] Checkout\\*Screen\\_\\[1\\]: ');
  });

  it('falls back to screen and never to route/url', () => {
    const capture = captureNow(() => ({ route: '(shop)/checkout' }), true);
    expect(capture.label).toBeNull();
    expect(capture.prefix).toBe('- [ ] ');
  });

  it('degrades to plain capture when the resolver throws', () => {
    const capture = captureNow(() => {
      throw new Error('navigation not ready');
    }, true);
    expect(capture.label).toBeNull();
    expect(capture.prefix).toBe('- [ ] ');
    expect(capture.meta).toEqual({});
  });

  it('returns a plain prefix when prefillScreen is disabled', () => {
    const capture = captureNow(() => ({ screen: 'Home' }), false);
    expect(capture.label).toBeNull();
    expect(capture.prefix).toBe('- [ ] ');
    expect(capture.meta).toEqual({ screen: 'Home' });
  });

  it('works with no resolver at all (cold start / no navigation library)', () => {
    expect(captureNow(undefined, true).prefix).toBe('- [ ] ');
  });
});

describe('normalisation', () => {
  it('collapses to a single line, strips control characters and trims', () => {
    expect(normalizeLabel('  Check\u0000out\n\tScreen  ')).toBe('Check out Screen');
    expect(normalizeLabel('   ')).toBeNull();
    expect(normalizeLabel(42)).toBeNull();
  });

  it('caps labels at 120 unicode code points without splitting surrogate pairs', () => {
    const emoji = '😀'.repeat(200);
    const normalized = normalizeLabel(emoji);
    expect(normalized).not.toBeNull();
    expect(Array.from(normalized as string)).toHaveLength(120);
    expect(normalized).toBe('😀'.repeat(120));
  });

  it('escapes every markdown metacharacter that could change rendering', () => {
    expect(escapeMarkdownLabel('a*b_c[d]e`f#g+h!i|j~k>l\\m')).toBe('a\\*b\\_c\\[d\\]e\\`f\\#g\\+h\\!i\\|j\\~k\\>l\\\\m');
  });
});

describe('context sanitisation', () => {
  it('keeps primitives, drops invalid values and normalises strings', () => {
    const meta = sanitizeContext({
      screen: 'Checkout\nScreen',
      tab: 2,
      modal: true,
      nothing: null,
      missing: undefined,
      bad: Number.NaN,
      nested: { a: 1 } as never,
    });
    expect(meta).toEqual({ screen: 'Checkout Screen', tab: 2, modal: true, nothing: null });
  });

  it('handles null/undefined contexts', () => {
    expect(sanitizeContext(null)).toEqual({});
    expect(sanitizeContext(undefined)).toEqual({});
  });
});

describe('draft detection', () => {
  const prefix = taskPrefix('CheckoutScreen');

  it('detects a bare task marker', () => {
    expect(isBlankTaskLine('- [ ]')).toBe(true);
    expect(isBlankTaskLine('- [ ] ')).toBe(true);
    expect(isBlankTaskLine('- [ ] typed')).toBe(false);
  });

  it('detects an untouched generated draft', () => {
    expect(isPrefixOnlyDraft(prefix, prefix)).toBe(true);
    expect(isPrefixOnlyDraft('- [ ] CheckoutScreen:', prefix)).toBe(true);
    expect(isPrefixOnlyDraft('- [ ] CheckoutScreen: note', prefix)).toBe(false);
  });
});
