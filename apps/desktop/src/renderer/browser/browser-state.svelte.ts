import type { BrowserAuthRequest, BrowserDownload, BrowserPermissionRequest, ReaderAnchor, ReaderSnapshot } from '../../protocol/browser';
import type { BrowserPasswordState } from '../../core/browser/passwords';
/**
 * Where a reader is scrolled. A `ReaderAnchor` keeps a block at a height inside the viewport,
 * so it cannot say how far the view has moved past a block that starts above it: a tall image,
 * or the last marked block of a sparsely marked article. `offset` is that remainder in pixels.
 */
export type ReaderPosition = ReaderAnchor & { offset?: number };
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
  /** Where the user last scrolled each reader. Returning to its tab restores exactly this place,
   * and the address-bar toggle returns to the live page at its golden-line block. */
  readerPositions: {} as Record<string, ReaderPosition> });
