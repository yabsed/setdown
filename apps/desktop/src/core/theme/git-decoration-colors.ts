import colors from '../project/upstream/git-colors.json';
import type { ThemeProfile } from './theme-catalog';

/** Imported themes override the same named roles used by VS Code's Git extension. */
export function gitDecorationColors(profile: ThemeProfile): Record<string, string> {
  const variant = profile.id.endsWith('high-contrast')
    ? profile.appearance === 'light' ? 'highContrastLight' : 'highContrast'
    : profile.appearance;
  return Object.fromEntries(Object.entries(colors).map(([role, defaults]) =>
    [role, profile.workbenchColors?.[role] ?? defaults[variant]]));
}
