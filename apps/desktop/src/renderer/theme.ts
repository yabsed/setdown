import type * as Monaco from 'monaco-editor';
import type { PreviewThemeId } from '../core/preview/preview-preferences';
import {
  THEME_PROFILES,
  themeProfile,
  type ThemePalette,
} from '../core/theme/theme-catalog';

const SHELL_THEME_VARIABLES: Record<keyof ThemePalette, string> = {
  canvas: '--app-canvas',
  surface: '--app-surface',
  raisedSurface: '--app-raised-surface',
  chrome: '--app-chrome',
  editorBackground: '--app-editor-background',
  text: '--app-text',
  mutedText: '--app-muted-text',
  subtleText: '--app-subtle-text',
  border: '--app-border',
  strongBorder: '--app-strong-border',
  hover: '--app-hover',
  selected: '--app-selected',
  accent: '--app-accent',
  focusRing: '--app-focus-ring',
  warningSurface: '--app-warning-surface',
  warningText: '--app-warning-text',
  warningBorder: '--app-warning-border',
  dangerText: '--app-danger-text',
  shadow: '--app-shadow',
  overlay: '--app-overlay',
};

export const monacoThemeName = (themeId: PreviewThemeId) => `setdown-${themeId}`;

export function registerMonacoThemes(monaco: typeof Monaco) {
  const withAlpha = (color: string, alpha: string) => (
    /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color
  );
  for (const { id, appearance, palette, syntax } of THEME_PROFILES) {
    const dark = appearance === 'dark';
    monaco.editor.defineTheme(monacoThemeName(id), {
      base: appearance === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      colors: {
        'editor.background': palette.editorBackground,
        'editor.foreground': syntax.foreground,
        'editorCursor.foreground': palette.accent,
        'editorLineNumber.foreground': palette.subtleText,
        'editorLineNumber.activeForeground': palette.text,
        'editor.lineHighlightBackground': withAlpha(palette.hover, '80'),
        'editor.selectionBackground': withAlpha(palette.accent, '55'),
        'editor.inactiveSelectionBackground': withAlpha(palette.accent, '32'),
        'editor.findMatchBackground': withAlpha(palette.accent, '66'),
        'editor.findMatchHighlightBackground': withAlpha(palette.accent, '36'),
        'editorWidget.background': palette.raisedSurface,
        'editorWidget.border': palette.border,
        'input.background': palette.surface,
        'input.foreground': palette.text,
        'input.border': palette.border,
        'focusBorder': palette.focusRing,
        'scrollbarSlider.background': withAlpha(palette.mutedText, '44'),
        'scrollbarSlider.hoverBackground': withAlpha(palette.mutedText, '66'),
        'editorGutter.background': palette.editorBackground,
        'editorIndentGuide.background1': palette.border,
        'editorIndentGuide.activeBackground1': palette.strongBorder,
        'diffEditor.insertedLineBackground': dark ? '#2ea04314' : '#2da44e12',
        'diffEditor.removedLineBackground': dark ? '#f8514914' : '#cf222e12',
        'diffEditor.insertedTextBackground': dark ? '#2ea04366' : '#2da44e4d',
        'diffEditor.removedTextBackground': dark ? '#f8514966' : '#cf222e4d',
        'diffEditorGutter.insertedLineBackground': dark ? '#2ea04388' : '#2da44e77',
        'diffEditorGutter.removedLineBackground': dark ? '#f8514988' : '#cf222e77',
        'diffEditor.border': palette.border,
        'diffEditor.diagonalFill': withAlpha(palette.border, '55'),
      },
      rules: [
        { token: 'comment', foreground: syntax.comment.slice(1), fontStyle: 'italic' },
        { token: 'keyword', foreground: syntax.keyword.slice(1) },
        { token: 'string', foreground: syntax.string.slice(1) },
        { token: 'number', foreground: syntax.number.slice(1) },
        { token: 'tag', foreground: syntax.heading.slice(1), fontStyle: 'bold' },
        { token: 'type', foreground: syntax.heading.slice(1) },
        { token: 'string.link', foreground: syntax.link.slice(1), fontStyle: 'underline' },
        { token: 'markup.heading.markdown', foreground: syntax.heading.slice(1), fontStyle: 'bold' },
        { token: 'markup.inline.raw.markdown', foreground: syntax.code.slice(1) },
        { token: 'delimiter', foreground: syntax.punctuation.slice(1) },
      ],
    });
  }
}

export function applyShellTheme(themeId: PreviewThemeId) {
  const profile = themeProfile(themeId);
  const root = document.documentElement;
  root.dataset.theme = profile.id;
  root.dataset.appearance = profile.appearance;
  root.style.colorScheme = profile.appearance;
  root.style.setProperty('--preview-background', profile.preview.background);
  for (const [name, value] of Object.entries(profile.palette)) {
    root.style.setProperty(SHELL_THEME_VARIABLES[name as keyof ThemePalette], value);
  }
}
