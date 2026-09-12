export const THEME_IDS = [
  'github-light',
  'paper',
  'medium',
  'solarized-light',
  'github-dark',
  'night',
  'one-dark',
  'solarized-dark',
] as const;

export type ThemeId = typeof THEME_IDS[number];

export type ThemePalette = {
  canvas: string;
  surface: string;
  raisedSurface: string;
  chrome: string;
  editorBackground: string;
  text: string;
  mutedText: string;
  subtleText: string;
  border: string;
  strongBorder: string;
  hover: string;
  selected: string;
  accent: string;
  focusRing: string;
  warningSurface: string;
  warningText: string;
  warningBorder: string;
  dangerText: string;
  shadow: string;
  overlay: string;
};

export type SyntaxPalette = {
  foreground: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  link: string;
  heading: string;
  code: string;
  punctuation: string;
};

export type PreviewStylesheet =
  | 'github-light.css'
  | 'newsprint.css'
  | 'medium.css'
  | 'solarized-light.css'
  | 'github-dark.css'
  | 'night.css'
  | 'one-dark.css'
  | 'solarized-dark.css';

export type ThemeProfile = {
  id: ThemeId;
  label: string;
  appearance: 'light' | 'dark';
  preview: { stylesheet: PreviewStylesheet; prismStylesheet: string; background: string };
  palette: ThemePalette;
  syntax: SyntaxPalette;
};

const lightBase = {
  raisedSurface: '#ffffff', subtleText: '#96968f', strongBorder: '#c8c8c1',
  warningSurface: '#fff2cc', warningText: '#583e15', warningBorder: '#c8ad62',
  dangerText: '#8d4a40', shadow: 'rgba(28, 28, 24, .18)', overlay: 'rgba(25, 25, 23, .4)',
};

const darkBase = {
  raisedSurface: '#343942', subtleText: '#818997', strongBorder: '#596170',
  warningSurface: '#4b4028', warningText: '#f0d58a', warningBorder: '#78683d',
  dangerText: '#ff9b8e', shadow: 'rgba(0, 0, 0, .42)', overlay: 'rgba(0, 0, 0, .58)',
};

export const THEME_PROFILES: readonly ThemeProfile[] = [
  {
    id: 'github-light', label: 'GitHub Light', appearance: 'light',
    preview: { stylesheet: 'github-light.css', prismStylesheet: 'github.css', background: '#ffffff' },
    palette: { ...lightBase, canvas: '#f7f7f5', surface: '#ffffff', chrome: '#ecece8', editorBackground: '#ffffff', text: '#242424', mutedText: '#6c6c67', border: '#d8d8d2', hover: '#e7e7e1', selected: '#f7f7f5', accent: '#0969da', focusRing: '#4c8ed9' },
    syntax: { foreground: '#24292f', comment: '#6e7781', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', link: '#0969da', heading: '#8250df', code: '#116329', punctuation: '#57606a' },
  },
  {
    id: 'paper', label: 'Paper', appearance: 'light',
    preview: { stylesheet: 'newsprint.css', prismStylesheet: 'pen-paper-coffee.css', background: '#f3f2ee' },
    palette: { ...lightBase, canvas: '#ebe9e3', surface: '#f3f2ee', raisedSurface: '#fbfaf6', chrome: '#dfddd6', editorBackground: '#f3f2ee', text: '#2d2520', mutedText: '#746d65', border: '#d0ccc2', strongBorder: '#b8b1a5', hover: '#e4e0d7', selected: '#f3f2ee', accent: '#065588', focusRing: '#4c7d98' },
    syntax: { foreground: '#342b26', comment: '#8a8178', keyword: '#8a3b32', string: '#48643f', number: '#765b2f', link: '#065588', heading: '#6b493b', code: '#3e5f57', punctuation: '#716960' },
  },
  {
    id: 'medium', label: 'Medium', appearance: 'light',
    preview: { stylesheet: 'medium.css', prismStylesheet: 'github.css', background: '#ffffff' },
    palette: { ...lightBase, canvas: '#f7f7f7', surface: '#ffffff', chrome: '#f0f0ed', editorBackground: '#ffffff', text: '#202123', mutedText: '#71737a', border: '#dededb', hover: '#ededeb', selected: '#fafafa', accent: '#2484c1', focusRing: '#4b96c5' },
    syntax: { foreground: '#404247', comment: '#8a8d94', keyword: '#a43f4b', string: '#376b54', number: '#7657a6', link: '#2484c1', heading: '#202123', code: '#3f6577', punctuation: '#707279' },
  },
  {
    id: 'solarized-light', label: 'Solarized Light', appearance: 'light',
    preview: { stylesheet: 'solarized-light.css', prismStylesheet: 'solarized-light.css', background: '#fdf6e3' },
    palette: { ...lightBase, canvas: '#eee8d5', surface: '#fdf6e3', raisedSurface: '#fffaf0', chrome: '#e7dfca', editorBackground: '#fdf6e3', text: '#586e75', mutedText: '#657b83', subtleText: '#93a1a1', border: '#d8cfb8', strongBorder: '#b9ae91', hover: '#e9e1cb', selected: '#f7efd9', accent: '#268bd2', focusRing: '#268bd2' },
    syntax: { foreground: '#657b83', comment: '#93a1a1', keyword: '#859900', string: '#2aa198', number: '#d33682', link: '#268bd2', heading: '#b58900', code: '#6c71c4', punctuation: '#586e75' },
  },
  {
    id: 'github-dark', label: 'GitHub Dark', appearance: 'dark',
    preview: { stylesheet: 'github-dark.css', prismStylesheet: 'github-dark.css', background: '#24292e' },
    palette: { ...darkBase, canvas: '#1f2428', surface: '#24292e', raisedSurface: '#2d333b', chrome: '#20252a', editorBackground: '#24292e', text: '#cdd9e5', mutedText: '#9da7b1', border: '#444c56', strongBorder: '#59636e', hover: '#30363d', selected: '#2d333b', accent: '#539bf5', focusRing: '#4184e4' },
    syntax: { foreground: '#c9d1d9', comment: '#8b949e', keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', link: '#58a6ff', heading: '#d2a8ff', code: '#7ee787', punctuation: '#b1bac4' },
  },
  {
    id: 'night', label: 'Night', appearance: 'dark',
    preview: { stylesheet: 'night.css', prismStylesheet: 'darcula.css', background: '#363b40' },
    palette: { ...darkBase, canvas: '#2f3439', surface: '#363b40', raisedSurface: '#41474d', chrome: '#2c3136', editorBackground: '#363b40', text: '#dedede', mutedText: '#a9b0b6', border: '#474d54', strongBorder: '#606870', hover: '#41474d', selected: '#3c434a', accent: '#4a89dc', focusRing: '#5a9bea' },
    syntax: { foreground: '#d8d8d8', comment: '#808080', keyword: '#cc7832', string: '#6a8759', number: '#6897bb', link: '#589df6', heading: '#ffc66d', code: '#a5c261', punctuation: '#a9b7c6' },
  },
  {
    id: 'one-dark', label: 'One Dark', appearance: 'dark',
    preview: { stylesheet: 'one-dark.css', prismStylesheet: 'one-dark.css', background: '#272b33' },
    palette: { ...darkBase, canvas: '#21252b', surface: '#272b33', raisedSurface: '#303640', chrome: '#1f2329', editorBackground: '#282c34', text: '#abb2bf', mutedText: '#828997', border: '#3e4451', strongBorder: '#5c6370', hover: '#353b45', selected: '#2f3540', accent: '#61afef', focusRing: '#528bff' },
    syntax: { foreground: '#abb2bf', comment: '#5c6370', keyword: '#c678dd', string: '#98c379', number: '#d19a66', link: '#61afef', heading: '#e5c07b', code: '#56b6c2', punctuation: '#abb2bf' },
  },
  {
    id: 'solarized-dark', label: 'Solarized Dark', appearance: 'dark',
    preview: { stylesheet: 'solarized-dark.css', prismStylesheet: 'solarized-dark.css', background: '#002b36' },
    palette: { ...darkBase, canvas: '#00212a', surface: '#002b36', raisedSurface: '#073642', chrome: '#002630', editorBackground: '#002b36', text: '#93a1a1', mutedText: '#839496', subtleText: '#657b83', border: '#174550', strongBorder: '#2b5963', hover: '#073642', selected: '#0b3b47', accent: '#268bd2', focusRing: '#268bd2' },
    syntax: { foreground: '#839496', comment: '#586e75', keyword: '#859900', string: '#2aa198', number: '#d33682', link: '#268bd2', heading: '#b58900', code: '#6c71c4', punctuation: '#93a1a1' },
  },
];

export const DEFAULT_THEME: ThemeId = 'github-light';

export function normalizeTheme(value: unknown): ThemeId {
  return THEME_IDS.includes(value as ThemeId) ? value as ThemeId : DEFAULT_THEME;
}

export function themeProfile(value: unknown): ThemeProfile {
  const id = normalizeTheme(value);
  return THEME_PROFILES.find((profile) => profile.id === id)!;
}
