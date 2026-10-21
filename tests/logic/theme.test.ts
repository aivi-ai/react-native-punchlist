import { contrastRatio, parseColor, resolveTheme } from '../../src/ui/theme';
import type { PunchlistTheme } from '../../src/types';

/** The shape React Navigation hands out for its default light/dark themes. */
const NAV_LIGHT: PunchlistTheme = {
  dark: false,
  colors: { primary: 'rgb(0, 122, 255)', background: 'rgb(242, 242, 242)', card: 'rgb(255, 255, 255)', text: 'rgb(28, 28, 30)', border: 'rgb(216, 216, 216)', notification: 'rgb(255, 59, 48)' },
  fonts: { regular: { fontFamily: 'System' } },
};
const NAV_DARK: PunchlistTheme = {
  dark: true,
  colors: { primary: 'rgb(10, 132, 255)', background: 'rgb(1, 1, 1)', card: 'rgb(18, 18, 18)', text: 'rgb(229, 229, 231)', border: 'rgb(39, 39, 41)' },
};
const BRANDED: PunchlistTheme = {
  dark: false,
  colors: { primary: '#ff5a1f', background: '#fff4ec', card: '#fffaf6', text: '#3a2618', border: '#f0d9c8' },
  fonts: { regular: { fontFamily: 'Brand Sans' } },
};
/** Pale grey text on white: a typical accidental host palette. */
const LOW_CONTRAST: PunchlistTheme = {
  dark: false,
  colors: { primary: '#bdbdbd', background: '#ffffff', card: '#ffffff', text: '#cfcfcf', border: '#eeeeee' },
};

describe('parseColor', () => {
  it('reads hex and rgb() forms and rejects the rest', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#1e2027')).toEqual([30, 32, 39]);
    expect(parseColor('#1e202780')).toEqual([30, 32, 39]);
    expect(parseColor('rgb(0, 122, 255)')).toEqual([0, 122, 255]);
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('red')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('resolveTheme with the built-in modes', () => {
  it('keeps the existing light and dark palettes', () => {
    expect(resolveTheme('light', null).background).toBe('#ffffff');
    expect(resolveTheme('dark', null).background).toBe('#15161a');
    expect(resolveTheme('auto', 'dark').scheme).toBe('dark');
    expect(resolveTheme('auto', undefined).scheme).toBe('light');
    expect(resolveTheme('light', null, '#ff0000').accent).toBe('#ff0000');
    expect(resolveTheme('light', null, 'not-a-color').accent).toBe('#2563eb');
  });
});

describe('resolveTheme with a host (navigation-style) theme', () => {
  it('maps the host palette onto the sheet', () => {
    const colors = resolveTheme(NAV_LIGHT, 'dark');
    expect(colors.scheme).toBe('light'); // the host theme wins over the system scheme
    expect(colors.accent).toBe('rgb(0, 122, 255)');
    expect(colors.background).toBe('rgb(255, 255, 255)'); // card → sheet surface
    expect(colors.editor).toBe('rgb(242, 242, 242)'); // background → editor
    expect(colors.border).toBe('rgb(216, 216, 216)');
    expect(colors.text).toBe('rgb(28, 28, 30)');
    expect(colors.fontFamily).toBe('System');
  });

  it('lets accentColor override the host primary', () => {
    expect(resolveTheme(NAV_LIGHT, null, '#00aa55').accent).toBe('#00aa55');
  });

  it('omits fontFamily when the host provides none', () => {
    expect('fontFamily' in resolveTheme(NAV_DARK, null)).toBe(false);
  });

  it.each([
    ['navigation light', NAV_LIGHT],
    ['navigation dark', NAV_DARK],
    ['branded', BRANDED],
    ['low contrast', LOW_CONTRAST],
  ])('keeps every text pair readable (AA) for %s', (_name, theme) => {
    const colors = resolveTheme(theme, null);
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.danger, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accentText, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, colors.editor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, colors.elevated)).toBeGreaterThanOrEqual(4.5);
  });

  it('replaces an unreadable host text color instead of rendering it', () => {
    const colors = resolveTheme(LOW_CONTRAST, null);
    expect(colors.text).not.toBe('#cfcfcf');
    expect(colors.text).toBe('#111114');
  });

  it('falls back to the system scheme for an unusable host theme', () => {
    const broken = { dark: true, colors: { primary: 'nope', background: 'x', card: 'y', text: 'z', border: 'w' } };
    expect(resolveTheme(broken, 'dark')).toEqual(resolveTheme('auto', 'dark'));
  });
});
