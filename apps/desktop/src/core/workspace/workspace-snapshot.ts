import type { GroupTree } from './editor-groups';
import type { ViewportAnchor } from '../preview/viewport-anchor';
import type { GitHistorySelection } from '../project/git-history';
import { readReviewBookmark, type ReviewViewport } from '../preview/review-viewport';
export type SnapshotContent = { key: string; path: string; untitled: boolean; savedHash: string; text?: string };
export type SnapshotView = { key: string; content?: string; path: string; kind: 'document' | 'diff'; surface: string; staged?: boolean; history?: GitHistorySelection;
  editor?: unknown; anchor?: ViewportAnchor; display?: unknown; review?: { mode: 'source' | 'rendered'; viewport?: ReviewViewport } };
export type WorkspaceSnapshot = { version: 1; root: string | null; contents: SnapshotContent[]; views: SnapshotView[];
  groups: Array<{ id: string; tabs: string[]; active: string | null }>; tree: GroupTree; focused: string };
export async function contentHash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  if (!value || typeof value !== 'object') throw Error('Snapshot is not an object.');
  const result = value as WorkspaceSnapshot;
  const string = (value: unknown, limit = 16384): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
  if (result.version !== 1 || result.root !== null && !string(result.root) || !Array.isArray(result.contents) || result.contents.length > 200
    || !Array.isArray(result.views) || result.views.length > 500 || !Array.isArray(result.groups) || !result.groups.length || result.groups.length > 32) throw Error('Unsupported snapshot format or size.');
  let total = 0; const contentIds = new Set<string>(), viewIds = new Set<string>(), groupIds = new Set<string>();
  for (const content of result.contents) {
    if (!content || !string(content.key, 100) || contentIds.has(content.key) || !string(content.path) || typeof content.untitled !== 'boolean'
      || !/^[a-f0-9]{64}$/.test(content.savedHash) || content.text !== undefined && typeof content.text !== 'string') throw Error('Damaged content record.');
    contentIds.add(content.key); total += typeof content.text === 'string' ? new TextEncoder().encode(content.text).byteLength : 0;
  }
  if (total > 24 * 1024 * 1024) throw Error('Recovery content exceeds 24 MiB.');
  for (const view of result.views) {
    if (!view || !string(view.key, 100) || viewIds.has(view.key) || !string(view.path) || !['document', 'diff'].includes(view.kind)
      || !['editor', 'viewer', 'notebook', 'pdf', 'image', 'video', 'hwp', 'diff'].includes(view.surface)
      || view.content !== undefined && !contentIds.has(view.content)) throw Error('Damaged view record.');
    if (view.history && (typeof view.history !== 'object' || !string(view.history.path) || !string(view.history.root) || !/^[a-f\d]{7,64}$/i.test(view.history.head ?? '') || view.history.base !== undefined && !/^[a-f\d]{7,64}$/i.test(view.history.base))) throw Error('Invalid history reference.');
    if (view.anchor && (!Number.isFinite(view.anchor.sourceLine) || view.anchor.sourceLine < 1 || !Number.isFinite(view.anchor.yRatio) || view.anchor.yRatio < 0 || view.anchor.yRatio > 1)) throw Error('Invalid reader position.');
    if (view.editor !== undefined && new TextEncoder().encode(JSON.stringify(view.editor)).byteLength > 1024 * 1024) throw Error('View state exceeds 1 MiB.');
    if (view.review) {
      if (!['source', 'rendered'].includes(view.review.mode)) throw Error('Invalid review mode.');
      if (view.review.viewport) {
        const viewport = readReviewBookmark({ ...view.review.viewport.anchor, sourceSide: view.review.viewport.sourceSide });
        if (!viewport) throw Error('Invalid review location.'); view.review.viewport = viewport;
      }
    }
    viewIds.add(view.key);
  }
  const owned = new Set<string>();
  for (const group of result.groups) {
    if (!group || !string(group.id, 100) || groupIds.has(group.id) || !Array.isArray(group.tabs) || !group.tabs.length
      || group.tabs.some(id => !viewIds.has(id) || owned.has(id)) || group.active !== null && !group.tabs.includes(group.active)) throw Error('Invalid editor group.');
    for (const id of group.tabs) { if (owned.has(id)) throw Error('A view belongs to more than one group.'); owned.add(id); } groupIds.add(group.id);
  }
  if (owned.size !== viewIds.size || !groupIds.has(result.focused)) throw Error('Snapshot has unowned views.');
  const leaves = new Set<string>(); let nodes = 0;
  function tree(node: GroupTree): void {
    if (++nodes > 63 || !node || !string(node.id, 100)) throw Error('Invalid group layout.');
    if (node.kind === 'group') { if (!groupIds.has(node.id) || leaves.has(node.id)) throw Error('Invalid layout group.'); leaves.add(node.id); }
    else if (node.kind === 'split' && ['x', 'y'].includes(node.axis) && Number.isFinite(node.ratio) && node.ratio >= .1 && node.ratio <= .9) { tree(node.first); tree(node.second); }
    else throw Error('Invalid split.');
  }
  tree(result.tree); if (leaves.size !== groupIds.size) throw Error('Missing layout group.');
  return result;
}
