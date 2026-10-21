import type { PunchlistTheme } from '../types';

export interface ThemeColors {
  scheme: 'light' | 'dark';
  background: string;
  elevated: string;
  /** Behind the editor and the preview. */
  editor: string;
  text: string;
  muted: string;
  border: string;
  backdrop: string;
  accent: string;
  accentText: string;
  danger: string;
  codeBackground: string;
  /** Host UI font for labels and the toolbar; the editor always keeps the system font. */
  fontFamily?: string;
}

type Palette = Omit<ThemeColors, 'scheme' | 'accent' | 'fontFamily'>;

const LIGHT: Palette = {
  background: '#ffffff',
  elevated: '#f4f4f6',
  editor: '#ffffff',
  text: '#111114',
  muted: '#5b5b66',
  border: '#dcdce2',
  backdrop: 'rgba(12,12,16,0.20)',
  accentText: '#ffffff',
  danger: '#b3261e',
  codeBackground: '#f1f1f4',
};

const DARK: Palette = {
  background: '#15161a',
  elevated: '#1e2027',
  editor: '#15161a',
  text: '#f4f4f7',
  muted: '#a5a5b0',
  border: '#33353d',
  backdrop: 'rgba(0,0,0,0.45)',
  accentText: '#0b0b0f',
  danger: '#ff8a80',
  codeBackground: '#23252c',
};

const DEFAULT_ACCENT = { light: '#2563eb', dark: '#93b4ff' } as const;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** WCAG AA for body text. */
const AA = 4.5;

type Rgb = [number, number, number];

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; anything else is unusable. */
export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length <= 4) digits = digits.replace(/./g, (char) => char + char);
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as Rgb;
  }
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(text);
  if (fn) return [fn[1], fn[2], fn[3]].map((part) => Math.min(255, Number(part))) as Rgb;
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: string, b: string): number {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return 0;
  const [high, low] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** `preferred` when it reads on `surface`, otherwise whichever fallback reads best. */
function readable(preferred: string, surface: string, fallbacks: string[]): string {
  if (contrastRatio(preferred, surface) >= AA) return preferred;
  return fallbacks.reduce((best, candidate) =>
    contrastRatio(candidate, surface) > contrastRatio(best, surface) ? candidate : best,
  );
}

function hostPalette(host: PunchlistTheme): { scheme: 'light' | 'dark'; palette: Palette } | null {
  const colors = host.colors;
  if (!colors || !parseColor(colors.card) || !parseColor(colors.text) || !parseColor(colors.primary)) return null;
  const scheme: 'light' | 'dark' = host.dark ? 'dark' : 'light';
  const builtIn = scheme === 'dark' ? DARK : LIGHT;
  const surface = colors.card;
  const text = readable(colors.text, surface, [LIGHT.text, DARK.text]);
  const page = parseColor(colors.background) ? colors.background : surface;
  return {
    scheme,
    palette: {
      ...builtIn,
      background: surface,
      editor: page,
      elevated: page === surface ? builtIn.elevated : page,
      text,
      muted: readable(builtIn.muted, surface, [text]),
      border: parseColor(colors.border) ? colors.border : builtIn.border,
      accentText: '#ffffff',
      danger: readable(builtIn.danger, surface, [LIGHT.danger, DARK.danger]),
    },
  };
}

export function resolveTheme(
  mode: 'auto' | 'light' | 'dark' | PunchlistTheme,
  systemScheme: 'light' | 'dark' | null | undefined,
  accentColor?: string,
): ThemeColors {
  const accentOverride = accentColor && HEX.test(accentColor) ? accentColor : undefined;
  if (typeof mode === 'object' && mode !== null) {
    const host = hostPalette(mode);
    if (host) {
      const accent = accentOverride ?? mode.colors.primary;
      const fontFamily = mode.fonts?.regular?.fontFamily;
      return {
        scheme: host.scheme,
        ...host.palette,
        accent,
        accentText: readable('#ffffff', accent, ['#ffffff', '#0b0b0f']),
        ...(fontFamily ? { fontFamily } : {}),
      };
    }
    // Unusable host theme: behave as `'auto'` rather than render unreadable text.
    return resolveTheme('auto', systemScheme, accentColor);
  }
  const scheme: 'light' | 'dark' = mode === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const base = scheme === 'dark' ? DARK : LIGHT;
  const accent = accentOverride ?? DEFAULT_ACCENT[scheme];
  return { scheme, accent, ...base, accentText: scheme === 'dark' && !accentColor ? '#0b0b0f' : base.accentText };
}
