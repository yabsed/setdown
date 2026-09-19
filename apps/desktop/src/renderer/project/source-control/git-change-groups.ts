import type { GitChange } from '../../../protocol/desktop-api';

/** The badge counts nonempty Staged/Changes groups, not files or commits. */
export function gitChangeGroups(changes: readonly GitChange[] = []) {
  const conflicts = changes.filter((change) => change.conflict);
  const staged = changes.filter((change) => change.staged && !change.conflict);
  const changed = changes.filter((change) => change.unstaged && !change.conflict);
  return { conflicts, staged, changed, badge: Number(staged.length > 0) + Number(changed.length > 0) };
}
