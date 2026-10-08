import type { BrowserDownload } from '../../protocol/browser';
export const browser = $state({ revision: 0, error: '', findId: null as string | null, query: '', active: 0, matches: 0,
  downloads: [] as BrowserDownload[] });
