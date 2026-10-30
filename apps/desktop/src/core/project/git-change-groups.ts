import { DEFAULT_GIT_SETTINGS, type GitSettings } from './git-settings';
type GitResourceChange = { staged: boolean; unstaged: boolean; conflict: boolean; indexStatus?: string };

/**
 * VS Code's default git.countBadge=all / git.untrackedChanges=mixed:
 * Repository.setCountBadge sums merge, index and working-tree resources.
 * A partially staged file contributes to both index and working tree.
 * https://github.com/microsoft/vscode/blob/1d7e3b013a0f4ed6c0e00fe11370e91797681e21/extensions/git/src/repository.ts
 */
export function gitChangeGroups<T extends GitResourceChange>(changes: readonly T[] = [], settings: Pick<GitSettings, 'countBadge' | 'untrackedChanges'> = DEFAULT_GIT_SETTINGS) {
  const conflicts = changes.filter(change => change.conflict);
  const staged = changes.filter(change => change.staged && !change.conflict);
  const tracked = changes.filter(change => change.unstaged && !change.conflict && change.indexStatus !== '?');
  const untracked = changes.filter(change => change.unstaged && !change.conflict && change.indexStatus === '?');
  const changed = settings.untrackedChanges === 'mixed' ? changes.filter(change => change.unstaged && !change.conflict) : tracked;
  const separate = settings.untrackedChanges === 'separate' ? untracked : [];
  const badge = settings.countBadge === 'off' ? 0 : conflicts.length + staged.length + tracked.length
    + (settings.countBadge === 'all' && settings.untrackedChanges !== 'hidden' ? untracked.length : 0);
  return { conflicts, staged, changed, untracked: separate, badge };
}
