import { describe, expect, it } from 'vitest';
import { vscodeDark2026Token } from './vscode-dark-2026';
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
    expect(THEME_IDS).toEqual(['github-light', 'paper', 'medium', 'solarized-light', 'github-dark', 'night', 'one-dark', 'solarized-dark', 'vscode-dark-2026']);
    expect(themeProfile('vscode-dark-2026')).toMatchObject({ label: 'VS Code Dark 2026', appearance: 'dark',
      palette: { editorBackground: '#121314', chrome: '#191A1B' },
      workbenchColors: { 'editor.selectionBackground': '#276782dd', 'editor.lineHighlightBackground': '#242526' } });
    expect(terminalTheme('vscode-dark-2026')).toMatchObject({ background: '#191A1B', foreground: '#CCCCCC', blue: '#2472c8', selectionBackground: '#3994BC33' });
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
