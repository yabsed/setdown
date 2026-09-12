export const PREVIEW_THEMES = [
  { id: 'github-light', label: 'GitHub Light', file: 'github-light.css' },
  { id: 'paper', label: 'Paper', file: 'newsprint.css' },
  { id: 'medium', label: 'Medium', file: 'medium.css' },
  { id: 'solarized-light', label: 'Solarized Light', file: 'solarized-light.css' },
  { id: 'github-dark', label: 'GitHub Dark', file: 'github-dark.css' },
  { id: 'night', label: 'Night', file: 'night.css' },
  { id: 'one-dark', label: 'One Dark', file: 'one-dark.css' },
  { id: 'solarized-dark', label: 'Solarized Dark', file: 'solarized-dark.css' },
] as const;

export type PreviewThemeId = typeof PREVIEW_THEMES[number]['id'];

export type PreviewThemeAssets = {
  themeId: PreviewThemeId;
  previewCssUrl: string;
  codeCssUrl: string;
  backgroundColor: string;
};

export const DEFAULT_PREVIEW_THEME: PreviewThemeId = 'github-light';

export function normalizePreviewTheme(value: unknown): PreviewThemeId {
  return PREVIEW_THEMES.some((theme) => theme.id === value)
    ? value as PreviewThemeId
    : DEFAULT_PREVIEW_THEME;
}

export function previewThemeFile(value: unknown): typeof PREVIEW_THEMES[number]['file'] {
  const normalized = normalizePreviewTheme(value);
  return PREVIEW_THEMES.find((theme) => theme.id === normalized)!.file;
}

const PRISM_THEME_BY_PREVIEW: Record<typeof PREVIEW_THEMES[number]['file'], string> = {
  'github-light.css': 'github.css',
  'newsprint.css': 'pen-paper-coffee.css',
  'medium.css': 'github.css',
  'solarized-light.css': 'solarized-light.css',
  'github-dark.css': 'github-dark.css',
  'night.css': 'darcula.css',
  'one-dark.css': 'one-dark.css',
  'solarized-dark.css': 'solarized-dark.css',
};

const BACKGROUND_BY_PREVIEW: Record<typeof PREVIEW_THEMES[number]['file'], string> = {
  'github-light.css': '#ffffff',
  'newsprint.css': '#f3f2ee',
  'medium.css': '#ffffff',
  'solarized-light.css': '#fdf6e3',
  'github-dark.css': '#24292e',
  'night.css': '#363b40',
  'one-dark.css': '#272b33',
  'solarized-dark.css': '#002b36',
};

export function codeThemeFile(value: unknown): string {
  return PRISM_THEME_BY_PREVIEW[previewThemeFile(value)];
}

export function previewThemeBackground(value: unknown): string {
  return BACKGROUND_BY_PREVIEW[previewThemeFile(value)];
}
