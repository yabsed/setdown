export type GitSettings = {
  countBadge: 'all' | 'tracked' | 'off'; untrackedChanges: 'mixed' | 'separate' | 'hidden';
  scmCountBadge: 'all' | 'focused' | 'off'; repositoryScanMaxDepth: number;
  repositoryScanIgnoredFolders: string[]; ignoredRepositories: string[]; scanRepositories: string[];
  detectSubmodules: boolean; detectSubmodulesLimit: number; detectWorktrees: boolean;
  openRepositoryInParentFolders: 'always' | 'never' | 'prompt';
  ignoreSubmodules: boolean; statusLimit: number; similarityThreshold: number;
};
export const DEFAULT_GIT_SETTINGS: GitSettings = {
  countBadge: 'all', untrackedChanges: 'mixed', scmCountBadge: 'all', repositoryScanMaxDepth: 1,
  repositoryScanIgnoredFolders: ['node_modules'], ignoredRepositories: [], scanRepositories: [],
  detectSubmodules: true, detectSubmodulesLimit: 10, detectWorktrees: false,
  openRepositoryInParentFolders: 'prompt', ignoreSubmodules: false, statusLimit: 10000, similarityThreshold: 50,
};
export function gitSettings(values: Record<string, unknown> = {}): GitSettings {
  const result = { ...DEFAULT_GIT_SETTINGS };
  for (const key of Object.keys(result) as Array<keyof GitSettings>) {
    const value = values[key === 'scmCountBadge' ? 'scm.countBadge' : `git.${key}`] ?? values[key];
    const fallback = result[key];
    if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every(v => typeof v === 'string')) Object.assign(result, { [key]: value.slice(0, 1000) });
    } else if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isInteger(value) && value >= (key === 'repositoryScanMaxDepth' ? -1 : 0)) Object.assign(result, { [key]: value });
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') Object.assign(result, { [key]: value });
    } else if ((key === 'countBadge' ? ['all', 'tracked', 'off'] : key === 'scmCountBadge' ? ['all', 'focused', 'off']
      : key === 'untrackedChanges' ? ['mixed', 'separate', 'hidden'] : ['always', 'never', 'prompt']).includes(String(value))) Object.assign(result, { [key]: value });
  }
  result.similarityThreshold = Math.min(100, result.similarityThreshold);
  return result;
}
