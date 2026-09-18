import type { PreviewThemeId } from './preview-preferences';

/** 조판과 설치가 끝난 뒤 renderer가 받는 작은 결과만 표현한다. */
export type RenderResult = {
  revision: number;
  themeId: PreviewThemeId;
  /** 이 탭의 Preview가 지금 띄우고 있는 페이지. 실패했을 때만 null이다. */
  url: string | null;
};

export type PreviewHeading = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  sourceLine?: number;
};
