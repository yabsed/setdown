import {
  DEFAULT_THEME,
  normalizeTheme,
  THEME_PROFILES,
  themeProfile,
  type ThemeId,
  type PreviewStylesheet,
} from './theme-catalog';

export const PREVIEW_THEMES = THEME_PROFILES.map((profile) => ({
  id: profile.id,
  label: profile.label,
  file: profile.preview.stylesheet,
}));

export type PreviewThemeId = ThemeId;

export type PreviewThemeAssets = {
  themeId: PreviewThemeId;
  previewCssUrl: string;
  codeCssUrl: string;
  backgroundColor: string;
};

export const DEFAULT_PREVIEW_THEME: PreviewThemeId = DEFAULT_THEME;

export function normalizePreviewTheme(value: unknown): PreviewThemeId {
  return normalizeTheme(value);
}

export function previewThemeFile(value: unknown): PreviewStylesheet {
  return themeProfile(value).preview.stylesheet;
}

export function codeThemeFile(value: unknown): string {
  return themeProfile(value).preview.prismStylesheet;
}

export function previewThemeBackground(value: unknown): string {
  return themeProfile(value).preview.background;
}
