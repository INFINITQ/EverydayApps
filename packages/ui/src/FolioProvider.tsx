import { FluentProvider } from '@fluentui/react-components';
import { type ReactNode, useLayoutEffect, useMemo } from 'react';
import { type SystemColors, type ThemeMode, createFolioTheme } from './theme';

export type ThemePreference = 'system' | ThemeMode;

/**
 * Applies Folio's theme: the Fluent theme generated from Windows' accent color, plus
 * `data-theme` / `data-surface` on <html> for Folio's own CSS. The surface is Mica unless
 * Windows' transparency effects are off or high contrast is on.
 */
export function FolioProvider({
  system,
  preference = 'system',
  children,
}: {
  system: SystemColors;
  preference?: ThemePreference;
  children: ReactNode;
}) {
  const mode: ThemeMode = preference === 'system' ? (system.dark ? 'dark' : 'light') : preference;
  const theme = useMemo(() => createFolioTheme(system, mode), [system, mode]);
  const surface = system.highContrast || !system.transparency ? 'solid' : 'mica';

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = system.highContrast ? 'contrast' : mode;
    root.dataset.surface = surface;
    root.style.colorScheme = mode;
  }, [mode, surface, system.highContrast]);

  // No className here: Fluent copies the provider's className onto the portal container it
  // appends to <body>, so layout classes would leak onto it (see docs/adr/0004).
  return (
    <FluentProvider theme={theme} style={{ height: '100%', background: 'transparent', color: 'inherit' }}>
      {children}
    </FluentProvider>
  );
}
