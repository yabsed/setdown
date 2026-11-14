import { describe, expect, it } from 'vitest';
import { vscodeDark2026Token } from './vscode-dark-2026';
import { vscodeToken } from './vscode-token';
import { communityMonacoTheme } from '../../renderer/editor/vscode-monaco-theme';
import { syntaxThemes } from '../../renderer/language/syntax-themes';
import { terminalTheme } from './terminal-theme';

import {
  DEFAULT_THEME,
  normalizeTheme,
  THEME_IDS,
  THEME_PROFILES,
  themeProfile,
} from './theme-catalog';

describe('theme catalog', () => {
  it('adds the pinned VS Code theme without changing the default or existing choices', () => {
    expect(DEFAULT_THEME).toBe('github-light');
    expect(THEME_IDS).toEqual(['github-light', 'paper', 'solarized-light',
      'github-dark', 'night', 'one-dark', 'solarized-dark', 'vscode-dark-2026', 'night-owl', 'dracula']);
    expect(themeProfile('vscode-dark-2026')).toMatchObject({ label: 'VS Code Dark 2026', appearance: 'dark',
      palette: { editorBackground: '#121314', chrome: '#191A1B' },
      workbenchColors: { 'editor.selectionBackground': '#276782dd', 'editor.lineHighlightBackground': '#242526' } });
    expect(terminalTheme('vscode-dark-2026')).toMatchObject({ background: '#191A1B', foreground: '#CCCCCC', blue: '#2472c8', selectionBackground: '#3994BC33' });
  });
  it.each([
    ['night-owl', '#011627', '#d6deeb', '#7c9090', '#82AAFF', '#EF5350'],
    ['dracula', '#282A36', '#F8F8F2', '#8293bf', '#50FA7B', '#FF5555'],
  ])('keeps %s source roles across lexical, TextMate and terminal surfaces', (id, background, foreground, comment, fn, red) => {
    const profile = themeProfile(id), theme = profile.vscodeTheme!;
    expect(profile.palette.editorBackground).toBe(background);
    expect(profile.syntax).toMatchObject({ foreground, comment });
    expect(vscodeToken(theme, 'entity.name.function').foreground).toBe(fn);
    const monaco = communityMonacoTheme(theme);
    expect(monaco.rules.find(rule => rule.token === 'function')?.foreground).toBe(fn.slice(1));
    expect(monaco.rules.find(rule => rule.token === 'comment')?.foreground).toBe(comment.slice(1));
    expect(syntaxThemes.find(theme => theme.name === `setdown-${id}`)?.tokenColors).toEqual(theme.tokenColors);
    expect(terminalTheme(id)).toMatchObject({ background, foreground, red });
    expect(Object.values(theme.colors).every(color => typeof color === 'string')).toBe(true);
  });
  it.each(['vscode-light-2026', 'light-owl', 'atom-one-light', 'medium', 'github-light-high-contrast',
    'github-dark-high-contrast'])('restores removed %s preferences to the default light theme', id => {
    expect(normalizeTheme(id)).toBe(DEFAULT_THEME);
    expect(themeProfile(id)).toEqual(themeProfile(DEFAULT_THEME));
    expect(terminalTheme(id)).toEqual(terminalTheme(DEFAULT_THEME));
    expect(syntaxThemes.some(theme => theme.name === `setdown-${id}`)).toBe(false);
  });
  it('preserves VS Code inherited specific token colors and the new theme overrides', () => {
    expect(vscodeDark2026Token('entity.name.type.class').foreground).toBe('#4EC9B0');
    expect(vscodeDark2026Token('entity.name.function').foreground).toBe('#d2a8ff');
    expect(vscodeDark2026Token('storage.modifier').foreground).toBe('#569cd6');
    expect(vscodeDark2026Token('keyword.control').foreground).toBe('#C586C0');
    expect(vscodeDark2026Token('keyword').foreground).toBe('#ff7b72');
    expect(vscodeDark2026Token('constant.numeric').foreground).toBe('#b5cea8');
    expect(vscodeDark2026Token('comment')).toEqual({ foreground: '#8b949e' });
  });
  const luminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (first: string, second: string) => {
    const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b);
    return (high + .05) / (low + .05);
  };
  it('keeps informational comments and default editor text readable in every theme', () => {
    for (const profile of THEME_PROFILES) {
      for (const token of ['comment', 'foreground'] as const) {
        expect(contrast(profile.syntax[token], profile.palette.editorBackground), `${profile.id}: ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('keeps the shell separator distinguishable from the surfaces it divides in every theme', () => {
    for (const { id, palette } of THEME_PROFILES) {
      for (const surface of ['canvas', 'surface'] as const) {
        expect(contrast(palette.border, palette[surface]), `${id}: border on ${surface}`).toBeGreaterThanOrEqual(1.2);
      }
    }
    // Night Owl paints sideBar.border in the editor background; its tab-strip
    // hairline separates the shell instead. Dracula keeps its existing border.
    expect(themeProfile('night-owl').palette).toMatchObject({ border: '#262A39', strongBorder: '#5f7e97' });
    expect(themeProfile('dracula').palette).toMatchObject({ border: '#191A21', strongBorder: '#191A21' });
  });
  it('모든 theme id에 Preview, Shell, Monaco용 palette를 하나씩 제공한다', () => {
    expect(THEME_PROFILES.map((profile) => profile.id)).toEqual(THEME_IDS);
    for (const profile of THEME_PROFILES) {
      expect(profile.preview.stylesheet).toMatch(/\.css$/);
      expect(profile.preview.prismStylesheet).toMatch(/\.css$/);
      expect(profile.palette.canvas).toMatch(/^#/);
      expect(profile.palette.editorBackground).toMatch(/^#/);
      expect(profile.syntax.foreground).toMatch(/^#/);
    }
  });

  it('허용되지 않은 값은 하나의 제품 기본 테마로 정규화한다', () => {
    expect(normalizeTheme('../../custom')).toBe(DEFAULT_THEME);
    expect(themeProfile('one-dark').appearance).toBe('dark');
    expect(themeProfile('paper').appearance).toBe('light');
  });
});
