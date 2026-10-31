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
    expect(THEME_IDS).toEqual(['github-light', 'paper', 'medium', 'solarized-light',
      'github-light-high-contrast', 'vscode-light-2026', 'light-owl', 'atom-one-light',
      'github-dark', 'night', 'one-dark', 'solarized-dark', 'vscode-dark-2026', 'github-dark-high-contrast', 'night-owl', 'dracula']);
    expect(themeProfile('vscode-dark-2026')).toMatchObject({ label: 'VS Code Dark 2026', appearance: 'dark',
      palette: { editorBackground: '#121314', chrome: '#191A1B' },
      workbenchColors: { 'editor.selectionBackground': '#276782dd', 'editor.lineHighlightBackground': '#242526' } });
    expect(terminalTheme('vscode-dark-2026')).toMatchObject({ background: '#191A1B', foreground: '#CCCCCC', blue: '#2472c8', selectionBackground: '#3994BC33' });
  });
  it.each([
    ['github-dark-high-contrast', '#0a0c10', '#f0f3f6', '#bdc4cc', '#dbb7ff', '#ff9492'],
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
  it.each([
    ['github-light-high-contrast', '#ffffff', '#0e1116', '#66707b', '#622cbc', '#a0111f'],
    ['vscode-light-2026', '#FFFFFF', '#202020', '#6e7781', '#8250df', '#cd3131'],
    ['light-owl', '#FBFBFB', '#403f53', '#6a7181', '#4876d6', '#de3d3b'],
    ['atom-one-light', '#FAFAFA', '#383A42', '#696c77', '#4078F2', '#cd3131'],
  ])('uses light defaults and upstream colors for %s on every adapter', (id, background, foreground, comment, fn, red) => {
    const profile = themeProfile(id), theme = profile.vscodeTheme!;
    expect(profile).toMatchObject({ appearance: 'light', preview: { stylesheet: 'github-light.css', prismStylesheet: 'github.css', background },
      palette: { editorBackground: background }, syntax: { foreground, comment } });
    const monaco = communityMonacoTheme(theme);
    expect(monaco.base).toBe('vs');
    expect(monaco.rules.find(rule => rule.token === 'function')?.foreground).toBe(fn.slice(1));
    expect(monaco.rules.find(rule => rule.token === 'comment')?.foreground).toBe(comment.slice(1));
    expect(syntaxThemes.find(theme => theme.name === `setdown-${id}`)).toMatchObject({ type: 'light', tokenColors: theme.tokenColors });
    expect(terminalTheme(id).red).toBe(red);
    for (const color of Object.values(terminalTheme(id))) if (color !== undefined) expect(color).toMatch(/^#[\da-f]{6}([\da-f]{2})?$/i);
    for (const color of Object.values(profile.palette)) expect(typeof color).toBe('string');
  });
  it('retains inherited Light 2026 semantic roles and explicit terminal surfaces', () => {
    const theme = communityMonacoTheme(themeProfile('vscode-light-2026').vscodeTheme!);
    expect(theme.rules.find(rule => rule.token === 'numberLiteral')?.foreground).toBe('098658');
    expect(terminalTheme('vscode-light-2026')).toMatchObject({ background: '#FAFAFD', foreground: '#3B3B3B', blue: '#0451a5' });
    expect(terminalTheme('light-owl')).toMatchObject({ background: '#F6F6F6', foreground: '#403f53' });
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
  it('keeps informational comments and default editor text readable in every theme', () => {
    const luminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    for (const profile of THEME_PROFILES) {
      for (const token of ['comment', 'foreground'] as const) {
        const [low, high] = [luminance(profile.syntax[token]), luminance(profile.palette.editorBackground)].sort((a, b) => a - b);
        expect((high + .05) / (low + .05), `${profile.id}: ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
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
