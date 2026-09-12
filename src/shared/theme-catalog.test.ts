import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  normalizeTheme,
  THEME_IDS,
  THEME_PROFILES,
  themeProfile,
} from './theme-catalog';

describe('theme catalog', () => {
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
