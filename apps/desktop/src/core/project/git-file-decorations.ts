/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. Adapted from VS Code; see upstream/NOTICE. */
import { Resource, Status } from './upstream/git-resource';

export type GitFileDecoration = { badge: string; tooltip: string; color: string; propagate: boolean };
export type GitDecorationChange = { path: string; previousPath?: string; indexStatus: string; workingTreeStatus: string };

const conflicts: Record<string, Status> = {
  DD: Status.BOTH_DELETED, AU: Status.ADDED_BY_US, UD: Status.DELETED_BY_THEM,
  UA: Status.ADDED_BY_THEM, DU: Status.DELETED_BY_US, AA: Status.BOTH_ADDED, UU: Status.BOTH_MODIFIED,
};
const indexTypes: Record<string, Status> = {
  M: Status.INDEX_MODIFIED, A: Status.INDEX_ADDED, D: Status.INDEX_DELETED,
  R: Status.INDEX_RENAMED, C: Status.INDEX_COPIED,
};
const workingTypes: Record<string, Status> = {
  M: Status.MODIFIED, D: Status.DELETED, A: Status.INTENT_TO_ADD,
  R: Status.INTENT_TO_RENAME, T: Status.TYPE_CHANGED,
};

export function resourceDecoration(type: Status): GitFileDecoration {
  return { badge: Resource.getStatusLetter(type), tooltip: Resource.getStatusText(type),
    color: Resource.getStatusColor(type), propagate: type !== Status.DELETED && type !== Status.INDEX_DELETED };
}

/** SCM lists show the resource belonging to their group. An AM file is A in
 * the index list, M in working-tree changes, and M in the Explorer. */
export function gitChangeDecoration(change: GitDecorationChange, staged: boolean): GitFileDecoration | undefined {
  const code = change.indexStatus + change.workingTreeStatus;
  const type = conflicts[code] ?? (code === '??' ? Status.UNTRACKED
    : staged ? indexTypes[change.indexStatus] : workingTypes[change.workingTreeStatus]);
  return type === undefined ? undefined : resourceDecoration(type);
}

/** VS Code's index → untracked → working tree → merge provider order. Paths
 * stay repository-relative here; the main process owns platform path resolution. */
export function gitFileDecorations(changes: readonly GitDecorationChange[]): Map<string, GitFileDecoration> {
  const groups: Array<Array<{ change: GitDecorationChange; type: Status }>> = [[], [], [], []];
  for (const change of changes) {
    const { indexStatus: x, workingTreeStatus: y } = change;
    const conflict = conflicts[x + y];
    if (conflict !== undefined) groups[3].push({ change, type: conflict });
    else if (x + y === '??') groups[1].push({ change, type: Status.UNTRACKED });
    else {
      if (indexTypes[x] !== undefined) groups[0].push({ change, type: indexTypes[x] });
      if (workingTypes[y] !== undefined) groups[2].push({ change, type: workingTypes[y] });
    }
  }
  const decorations = new Map<string, GitFileDecoration>();
  for (const group of groups) for (const { change, type } of group) {
    const decoration = resourceDecoration(type);
    decorations.set(change.path, decoration);
    // Porcelain v2 reports the destination first, whereas VS Code's resource
    // starts at the original URI. Keep the original alias for rename bubbling.
    if (change.previousPath && (change.indexStatus === 'R' || change.workingTreeStatus === 'R'))
      decorations.set(change.previousPath, decoration);
  }
  return decorations;
}
