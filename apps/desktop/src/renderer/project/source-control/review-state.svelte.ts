import { project } from '../project-state.svelte';
import type { SourceControlController } from './source-control-controller';
import type { GitDiffViewportPort } from './git-diff-viewport';

export const reviewDefaults = () => ({ gitDiffTabs: [] as typeof project.gitDiffTabs,
  activeGitDiffId: null as string | null, gitDiff: null as typeof project.gitDiff,
  gitDiffTarget: null as typeof project.gitDiffTarget, gitDiffActive: false, gitDiffLoading: false,
  gitDiffMode: 'source' as 'source' | 'rendered', gitDiffPreviewLoading: false, gitDiffPreviewReady: false,
  gitDiffFrozen: false, gitDiffSnapshot: '', gitDiffLine: 1 });
export const projectionKeys = Object.keys(reviewDefaults()).filter(key => key !== 'gitDiffTabs') as Array<keyof ReturnType<typeof reviewDefaults>>;
export function createReviewState(): typeof project {
  const local = $state(reviewDefaults());
  // Review presentation is local; repository status and errors still have one owner.
  return new Proxy(local as typeof project, {
    get: (target, key) => key in target ? Reflect.get(target, key) : Reflect.get(project, key),
    set: (target, key, value) => Reflect.set(key in target ? target : project, key, value),
  });
}
export type ReviewView = { id: string; state: typeof project; viewport: GitDiffViewportPort; controller: SourceControlController };
export const reviewViews = $state({ entries: [] as ReviewView[] });
