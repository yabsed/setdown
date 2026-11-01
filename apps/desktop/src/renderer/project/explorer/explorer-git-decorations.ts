/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. Adapted from VS Code; see core/project/upstream/NOTICE. */
import type { GitSnapshot, ProjectEntry } from '../../../protocol/desktop-api';
import type { GitFileDecoration } from '../../../core/project/git-file-decorations';

export type ExplorerGitDecoration = GitFileDecoration & { child?: boolean };
// A backslash is a legal POSIX filename character, not always a separator.
const key = (path: string) => /^(?:[a-z]:[\\/]|\\\\)/i.test(path)
  ? path.replaceAll('\\', '/').toLowerCase() : path;
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** Build once per snapshot, never scan status once per row. Descendants are
 * available even when directories have never been expanded or are filtered. */
export function explorerGitDecorations(
  entries: readonly ProjectEntry[], root: string, snapshot: GitSnapshot | null, ignored: ReadonlySet<string>,
): Map<string, ExplorerGitDecoration> {
  const result = new Map<string, ExplorerGitDecoration>();
  if (!root) return result;
  const rootKey = key(root).replace(/\/$/, '');
  const direct = new Map<string, GitFileDecoration>();
  const folders = new Map<string, GitFileDecoration>();
  const decorations = [...snapshot?.decorations ?? []].sort((a, b) => key(a.path) < key(b.path) ? -1 : key(a.path) > key(b.path) ? 1 : 0);
  for (const decoration of decorations) {
    const path = key(decoration.path);
    if (!path.startsWith(`${rootKey}/`)) continue;
    direct.set(path, decoration);
    if (!decoration.propagate) continue;
    for (let folder = parent(path); folder && folder !== rootKey; folder = parent(folder)) {
      if (!folders.has(folder)) folders.set(folder, decoration);
    }
  }
  const ignoredKeys = new Set([...ignored].map(key));
  for (const entry of entries) {
    const path = key(entry.path);
    const own = direct.get(path) ?? (ignoredKeys.has(path)
      ? { badge: '', tooltip: 'Ignored', color: 'gitDecoration.ignoredResourceForeground', propagate: false } : undefined);
    const child = entry.kind === 'directory' ? folders.get(path) : undefined;
    if (child) result.set(entry.path, { ...own ?? child, badge: '●', tooltip: 'Contains emphasized items', child: true });
    else if (own) result.set(entry.path, own);
  }
  return result;
}
