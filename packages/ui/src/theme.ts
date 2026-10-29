// Builds Folio's Fluent theme from Windows' own accent shades, following Windows 11's
// conventions: in light mode filled controls use the darker accent with white text; in dark
// mode they use a light accent with dark text.

import {
  type BrandVariants,
  type Theme,
  createDarkTheme,
  createLightTheme,
  teamsHighContrastTheme,
} from '@fluentui/react-components';
import { contrast, fromOklab, mixLab, parseHex, toHex, toOklab, type Lab } from './color';

/** What Rust reports about Windows' appearance (`folio://system`). */
export type SystemColors = {
  /** Dark3, Dark2, Dark1, Accent, Light1, Light2, Light3. */
  accent: string[];
  dark: boolean;
  highContrast: boolean;
  /** Windows' "Transparency effects" setting. */
  transparency: boolean;
};

export type ThemeMode = 'light' | 'dark';

const STOPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;

/** Where Windows' seven accent shades sit on Fluent's 16-step brand ramp. */
const ANCHORS: ReadonlyArray<readonly [stop: number, shade: number]> = [
  [40, 0],
  [60, 1],
  [80, 2],
  [100, 3],
  [120, 4],
  [130, 5],
  [150, 6],
];

/** Background behind text in each mode (Windows 11's solid base and layer colors). */
export const PAGE_BACKGROUND: Record<ThemeMode, string> = { light: '#f9f9f9', dark: '#2b2b2b' };

/** Windows' seven shades derived from one accent color, for when only that one is known. */
export function shadesFromAccent(accent: string): string[] {
  const base = toOklab(parseHex(accent));
  const offsets = [-0.27, -0.18, -0.09, 0, 0.09, 0.18, 0.26];
  return offsets.map((dL) => {
    const L = Math.min(0.97, Math.max(0.08, base.L + dL));
    const chroma = dL > 0 ? 1 - dL * 1.2 : 1;
    return toHex(fromOklab({ L, a: base.a * chroma, b: base.b * chroma }));
  });
}

/** Fluent's 16-step brand ramp, anchored on Windows' accent shades. */
export function brandRamp(accent: readonly string[]): BrandVariants {
  const shades = accent.length === 7 ? accent : shadesFromAccent(accent[0] ?? '#0078d4');
  const lab = (hex: string) => toOklab(parseHex(hex));
  const darkest = lab(shades[0]!);
  const lightest = lab(shades[6]!);
  const anchors: Array<[number, Lab]> = [
    [10, { L: darkest.L * 0.35, a: darkest.a * 0.5, b: darkest.b * 0.5 }],
    ...ANCHORS.map(([stop, shade]): [number, Lab] => [stop, lab(shades[shade]!)]),
    [160, { L: Math.max(0.97, lightest.L), a: lightest.a * 0.3, b: lightest.b * 0.3 }],
  ];
  const exact = new Map(ANCHORS.map(([stop, shade]) => [stop, shades[shade]!.toLowerCase()]));
  const ramp: Record<number, string> = {};
  for (const stop of STOPS) {
    // Windows' own shades are used as-is; the stops between them are interpolated.
    const known = exact.get(stop);
    if (known) {
      ramp[stop] = known;
      continue;
    }
    const upper = anchors.findIndex(([s]) => s >= stop);
    const [s1, c1] = anchors[Math.max(0, upper - 1)]!;
    const [s2, c2] = anchors[upper]!;
    const t = s2 === s1 ? 0 : (stop - s1) / (s2 - s1);
    ramp[stop] = toHex(fromOklab(mixLab(c1, c2, t)));
  }
  return ramp as unknown as BrandVariants;
}

const FONTS = {
  fontFamilyBase: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  fontFamilyMonospace: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  fontFamilyNumeric: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
};

/** Picks the first ramp stop (walking in `direction`) whose contrast with `against` reaches `min`. */
function readableStop(ramp: BrandVariants, from: number, direction: 1 | -1, against: string, min: number): string {
  const values = ramp as unknown as Record<number, string>;
  for (let stop = from; stop >= 10 && stop <= 160; stop += 10 * direction) {
    if (contrast(values[stop]!, against) >= min) return values[stop]!;
  }
  return direction === 1 ? '#ffffff' : '#000000';
}

export function createFolioTheme(system: SystemColors, mode: ThemeMode): Theme {
  if (system.highContrast) return { ...teamsHighContrastTheme, ...FONTS };
  const ramp = brandRamp(system.accent);
  const brand = ramp as unknown as Record<number, string>;
  const page = PAGE_BACKGROUND[mode];
  const theme: Theme = { ...(mode === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp)), ...FONTS };

  if (mode === 'dark') {
    Object.assign(theme, {
      colorBrandBackground: brand[130],
      colorBrandBackgroundHover: brand[120],
      colorBrandBackgroundPressed: brand[110],
      colorBrandBackgroundSelected: brand[120],
      colorCompoundBrandBackground: brand[130],
      colorCompoundBrandBackgroundHover: brand[120],
      colorCompoundBrandBackgroundPressed: brand[110],
      colorCompoundBrandStroke: brand[130],
      colorCompoundBrandStrokeHover: brand[120],
      colorBrandStroke1: brand[130],
      colorNeutralForegroundOnBrand: '#000000',
      colorBrandForeground1: readableStop(ramp, 140, 1, page, 4.5),
      colorBrandForeground2: readableStop(ramp, 150, 1, page, 4.5),
      colorBrandForegroundLink: readableStop(ramp, 140, 1, page, 4.5),
      colorBrandForegroundLinkHover: readableStop(ramp, 150, 1, page, 4.5),
      colorBrandForegroundLinkPressed: readableStop(ramp, 130, 1, page, 4.5),
    });
  } else {
    Object.assign(theme, {
      colorBrandForeground1: readableStop(ramp, 70, -1, page, 4.5),
      colorBrandForeground2: readableStop(ramp, 60, -1, page, 4.5),
      colorBrandForegroundLink: readableStop(ramp, 70, -1, page, 4.5),
      colorBrandForegroundLinkHover: readableStop(ramp, 60, -1, page, 4.5),
      colorBrandForegroundLinkPressed: readableStop(ramp, 50, -1, page, 4.5),
    });
  }

  // Text on filled brand controls must stay readable whatever the accent (yellow, lime...).
  const fill = theme.colorBrandBackground;
  if (contrast(fill, theme.colorNeutralForegroundOnBrand) < 4.5) {
    theme.colorNeutralForegroundOnBrand = contrast(fill, '#000000') >= contrast(fill, '#ffffff') ? '#000000' : '#ffffff';
  }
  if (contrast(fill, theme.colorNeutralForegroundOnBrand) < 4.5) {
    const darker = readableStop(ramp, mode === 'dark' ? 130 : 80, -1, '#ffffff', 4.5);
    Object.assign(theme, {
      colorBrandBackground: darker,
      colorCompoundBrandBackground: darker,
      colorNeutralForegroundOnBrand: '#ffffff',
    });
  }
  return theme;
}
