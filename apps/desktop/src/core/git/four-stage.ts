/** Four-stage document model: HEAD, INDEX, WORKTREE (saved disk), BUFFER (unsaved editor).
 *
 * Git only knows the first three stages. Editor surfaces (VS Code, Setdown)
 * show a fourth one: the in-memory buffer of an open document, which may
 * already differ from the saved file. An unstaged review therefore has two
 * possible right-hand sides:
 *
 * - `git diff`        = INDEX ↔ WORKTREE (saved bytes on disk)
 * - UI Changes review = INDEX ↔ BUFFER   (when an unsaved buffer exists)
 *
 * Staged reviews are unaffected: HEAD ↔ INDEX in both worlds.
 */

export type GitStage = 'HEAD' | 'INDEX' | 'WORKTREE' | 'BUFFER';

export type UnstagedInputs = {
  indexText: string | null;
  diskText: string | null;
  bufferText: string | null;
  untracked?: boolean;
};

export type ResolvedUnstaged = {
  originalText: string | null;
  modifiedText: string | null;
  originalLabel: 'EMPTY' | 'INDEX';
  modifiedLabel: 'WORKTREE' | 'BUFFER';
  includesUnsaved: boolean;
};

export function resolveUnstagedComparison(inputs: UnstagedInputs): ResolvedUnstaged {
  const originalLabel = inputs.untracked ? 'EMPTY' : 'INDEX';
  if (inputs.indexText === null || inputs.diskText === null) {
    return {
      originalText: inputs.indexText,
      modifiedText: inputs.diskText,
      originalLabel,
      modifiedLabel: 'WORKTREE',
      includesUnsaved: false,
    };
  }
  const includesUnsaved = inputs.bufferText !== null && inputs.bufferText !== inputs.diskText;
  return {
    originalText: inputs.indexText,
    modifiedText: includesUnsaved ? inputs.bufferText : inputs.diskText,
    originalLabel,
    modifiedLabel: includesUnsaved ? 'BUFFER' : 'WORKTREE',
    includesUnsaved,
  };
}

export function comparisonTitle(resolved: ResolvedUnstaged): string {
  return `${resolved.originalLabel} ↔ ${resolved.modifiedLabel}`;
}

export function stagedComparisonTitle(): string {
  return 'HEAD ↔ INDEX';
}
