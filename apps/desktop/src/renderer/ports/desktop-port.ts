import type { MarkTexApi } from '../../protocol/desktop-api';

/** Renderer가 Electron preload에 요구하는 유일한 외부 포트. */
export type DesktopPort = MarkTexApi;

export type ImagePort = Pick<MarkTexApi, 'readImageBytes'>;
export type VideoPort = Pick<MarkTexApi, 'mediaUrl'>;
export type PdfPort = Pick<MarkTexApi, 'showPdfSelectionMenu' | 'readPdfRange' | 'openLink'>;
export type LocationSuggestionsPort = Pick<MarkTexApi, 'locationSuggestions'>;
