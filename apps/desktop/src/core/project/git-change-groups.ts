type GitResourceChange = { staged: boolean; unstaged: boolean; conflict: boolean };

/**
 * VS Code's default git.countBadge=all / git.untrackedChanges=mixed:
 * Repository.setCountBadge sums merge, index and working-tree resources.
 * A partially staged file contributes to both index and working tree.
 * https://github.com/microsoft/vscode/blob/1d7e3b013a0f4ed6c0e00fe11370e91797681e21/extensions/git/src/repository.ts
 */
export function gitChangeGroups<T extends GitResourceChange>(changes: readonly T[] = []) {
  const conflicts = changes.filter(change => change.conflict);
  const staged = changes.filter(change => change.staged && !change.conflict);
  const changed = changes.filter(change => change.unstaged && !change.conflict);
  return { conflicts, staged, changed, badge: conflicts.length + staged.length + changed.length };
}
