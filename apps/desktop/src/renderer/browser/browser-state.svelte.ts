import type { BrowserAuthRequest, BrowserDownload, BrowserPermissionRequest, ReaderAnchor, ReaderSnapshot } from '../../protocol/browser';
export const browser = $state({ revision: 0, error: '', findId: null as string | null, query: '', active: 0, matches: 0,
  downloads: [] as BrowserDownload[],
  permissions: {} as Record<string, BrowserPermissionRequest[]>,
  auth: {} as Record<string, BrowserAuthRequest>, authId: null as string | null,
  /** Reader-mode snapshots keyed by web tab id. A tab listed here hides its
   * live native view (which keeps its page state) behind the shell reader. */
  readers: {} as Record<string, ReaderSnapshot>,
  /** Latest golden-line anchor published while scrolling each reader, so the
   * address-bar toggle can return to the live page at the current place. */
  readerPositions: {} as Record<string, ReaderAnchor> });
