import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREVIEW_THEME,
  codeThemeFile,
  normalizePreviewTheme,
  previewThemeBackground,
  previewThemeFile,
} from './preview-preferences';

describe('preview preferences', () => {
  it('허용된 theme id를 Crossnote 파일명으로 바꾼다', () => {
    expect(previewThemeFile('night')).toBe('night.css');
    expect(previewThemeFile('paper')).toBe('newsprint.css');
    expect(codeThemeFile('paper')).toBe('pen-paper-coffee.css');
    expect(previewThemeBackground('night')).toBe('#363b40');
  });

  it('임의 경로나 알 수 없는 값은 기본 테마로 제한한다', () => {
    expect(normalizePreviewTheme('../../custom')).toBe(DEFAULT_PREVIEW_THEME);
    expect(previewThemeFile(null)).toBe('github-light.css');
  });
});
