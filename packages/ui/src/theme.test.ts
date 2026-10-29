import { describe, expect, it } from 'vitest';
import { contrast } from './color';
import { PAGE_BACKGROUND, brandRamp, createFolioTheme, shadesFromAccent } from './theme';

// The 48 accent colors in Windows' Settings > Personalization > Colors palette.
const WINDOWS_ACCENTS = [
  '#FFB900', '#FF8C00', '#F7630C', '#CA5010', '#DA3B01', '#EF6950', '#D13438', '#FF4343',
  '#E74856', '#E81123', '#EA005E', '#C30052', '#E3008C', '#BF0077', '#C239B3', '#9A0089',
  '#0078D7', '#0063B1', '#8E8CD8', '#6B69D6', '#8764B8', '#744DA9', '#B146C2', '#881798',
  '#0099BC', '#2D7D9A', '#00B7C3', '#038387', '#00B294', '#018574', '#00CC6A', '#10893E',
  '#7A7574', '#5D5A58', '#68768A', '#515C6B', '#567C73', '#486860', '#498205', '#107C10',
  '#767676', '#4C4A48', '#69797E', '#4A5459', '#647C64', '#525E54', '#847545', '#7E735F',
];

describe('accent themes', () => {
  it('covers all 48 Windows accent colors', () => {
    expect(new Set(WINDOWS_ACCENTS).size).toBe(48);
  });

  for (const mode of ['light', 'dark'] as const) {
    it.each(WINDOWS_ACCENTS)(`%s in ${mode} mode keeps text readable (WCAG AA)`, (accent) => {
      const system = { accent: shadesFromAccent(accent), dark: mode === 'dark', highContrast: false, transparency: true };
      const theme = createFolioTheme(system, mode);
      const page = PAGE_BACKGROUND[mode];
      expect(contrast(theme.colorBrandBackground, theme.colorNeutralForegroundOnBrand)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.colorBrandForegroundLink, page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.colorBrandForeground1, page)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("uses Windows' own shades as anchors", () => {
    const shades = ['#003e92', '#0049a4', '#005fb8', '#0078d4', '#3e9fe7', '#76b9ed', '#99ebff'];
    const ramp = brandRamp(shades) as unknown as Record<number, string>;
    expect(Object.keys(ramp)).toHaveLength(16);
    expect(ramp[80]).toBe('#005fb8');
    expect(ramp[100]).toBe('#0078d4');
    expect(ramp[130]).toBe('#76b9ed');
  });

  it('follows Windows 11 in dark mode: light accent fill with dark text', () => {
    const shades = ['#003e92', '#0049a4', '#005fb8', '#0078d4', '#3e9fe7', '#76b9ed', '#99ebff'];
    const theme = createFolioTheme({ accent: shades, dark: true, highContrast: false, transparency: true }, 'dark');
    expect(theme.colorBrandBackground).toBe('#76b9ed');
    expect(theme.colorNeutralForegroundOnBrand).toBe('#000000');
  });
});
