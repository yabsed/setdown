import type { MarkTexApi } from '../../protocol/desktop-api';

/** Renderer가 Electron preload에 요구하는 유일한 외부 포트. */
export type DesktopPort = MarkTexApi;
