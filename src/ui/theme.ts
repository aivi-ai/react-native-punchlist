export interface ThemeColors {
  scheme: 'light' | 'dark';
  background: string;
  elevated: string;
  text: string;
  muted: string;
  border: string;
  backdrop: string;
  accent: string;
  accentText: string;
  danger: string;
  codeBackground: string;
}

const LIGHT: Omit<ThemeColors, 'scheme' | 'accent'> = {
  background: '#ffffff',
  elevated: '#f4f4f6',
  text: '#111114',
  muted: '#5b5b66',
  border: '#dcdce2',
  backdrop: 'rgba(12,12,16,0.20)',
  accentText: '#ffffff',
  danger: '#b3261e',
  codeBackground: '#f1f1f4',
};

const DARK: Omit<ThemeColors, 'scheme' | 'accent'> = {
  background: '#15161a',
  elevated: '#1e2027',
  text: '#f4f4f7',
  muted: '#a5a5b0',
  border: '#33353d',
  backdrop: 'rgba(0,0,0,0.45)',
  accentText: '#0b0b0f',
  danger: '#ff8a80',
  codeBackground: '#23252c',
};

const DEFAULT_ACCENT = { light: '#2563eb', dark: '#93b4ff' } as const;

export function resolveTheme(
  mode: 'auto' | 'light' | 'dark',
  systemScheme: 'light' | 'dark' | null | undefined,
  accentColor?: string,
): ThemeColors {
  const scheme: 'light' | 'dark' = mode === 'auto' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const base = scheme === 'dark' ? DARK : LIGHT;
  const accent = accentColor && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(accentColor) ? accentColor : DEFAULT_ACCENT[scheme];
  return { scheme, accent, ...base, accentText: scheme === 'dark' && !accentColor ? '#0b0b0f' : base.accentText };
}
