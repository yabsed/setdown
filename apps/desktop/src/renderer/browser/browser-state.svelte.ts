import type { BrowserAuthRequest, BrowserDownload, BrowserPermissionRequest, ReaderAnchor, ReaderSnapshot } from '../../protocol/browser';
import type { BrowserPasswordState } from '../../core/browser/passwords';
export const browser = $state({ revision: 0, error: '', findId: null as string | null, query: '', active: 0, matches: 0,
  downloads: [] as BrowserDownload[],
  permissions: {} as Record<string, BrowserPermissionRequest[]>,
  auth: {} as Record<string, BrowserAuthRequest>, authId: null as string | null,
  /** Per web tab: a login offered for saving and how many saved logins fit the page. */
  passwords: {} as Record<string, BrowserPasswordState>,
  /** Bumped when saved passwords change, so an open list reloads. */
  passwordRevision: 0,
  /** The "Clear browsing data" panel of the Browser side view is open. */
  clearingData: false,
  /** Reader-mode snapshots keyed by web tab id. A tab listed here hides its
   * live native view (which keeps its page state) behind the shell reader. */
  readers: {} as Record<string, ReaderSnapshot>,
  /** Find requests belong to the visible snapshot, independently of native page find. */
  readerFind: {} as Record<string, { query: string; forward: boolean; next: boolean; request: number }>,
  /** Latest golden-line anchor published while scrolling each reader, so the
   * address-bar toggle can return to the live page at the current place. */
  readerPositions: {} as Record<string, ReaderAnchor> });
