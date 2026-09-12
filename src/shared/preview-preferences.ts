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
