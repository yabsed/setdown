import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GitCli } from './git-cli';
import { DEFAULT_GIT_SETTINGS, type GitSettings } from '../../../core/project/git-settings';
import { isInside } from '../../documents/file-system';

export type RepositoryFailure = { root: string; command: string; message: string };
export type RepositoryDiscovery = { roots: string[]; limited: boolean; parent?: string; errors: RepositoryFailure[] };
/** Bounded folder scanning and explicit submodule/worktree discovery are
 * separate. Never recurse through symlinks or silently open a parent repo. */
export async function discoverRepositories(root: string, settings: GitSettings = DEFAULT_GIT_SETTINGS): Promise<RepositoryDiscovery> {
  const roots = new Set<string>(), errors: RepositoryFailure[] = [];
  let parent: string | undefined, limited = false;
  const ignored = (candidate: string) => settings.ignoredRepositories.some(value => path.resolve(root, value) === candidate);
  const connect = async (directory: string, allowParent = false) => {
    try {
      const repository = await GitCli.connect(directory);
      if (!repository || ignored(repository.repositoryRoot)) return;
      if (!isInside(root, repository.repositoryRoot) && !allowParent) {
        if (settings.openRepositoryInParentFolders === 'prompt') parent = repository.repositoryRoot;
        if (settings.openRepositoryInParentFolders !== 'always') return;
      }
      roots.add(repository.repositoryRoot);
    } catch (error) { errors.push({ root: directory, command: 'git rev-parse --show-toplevel', message: String(error) }); }
  };
  await connect(root);
  const queue = [{ directory: root, depth: 0 }]; let inspected = 0;
  for (const extra of settings.scanRepositories) queue.push({ directory: path.resolve(root, extra), depth: 0 });
  while (queue.length && inspected++ < 2000) {
    const { directory, depth } = queue.shift()!;
    let entries;
    try { if ((await fs.lstat(directory)).isSymbolicLink()) continue; entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    if (entries.some(entry => entry.name === '.git')) await connect(directory, directory !== root);
    if (settings.repositoryScanMaxDepth !== -1 && depth >= settings.repositoryScanMaxDepth) continue;
    for (const entry of entries) if (entry.isDirectory() && !['.git', '.hg', '.svn'].includes(entry.name)
      && !settings.repositoryScanIgnoredFolders.some(value => value === entry.name || path.resolve(root, value) === path.join(directory, entry.name)))
      queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
  }
  limited ||= queue.length > 0;
  for (const repositoryRoot of [...roots]) {
    if (settings.detectSubmodules) {
      const modules = path.join(repositoryRoot, '.gitmodules');
      if (await fs.stat(modules).then(info => info.isFile(), () => false)) {
        try {
          const output = await GitCli.run(repositoryRoot, ['config', '--null', '--file', modules, '--get-regexp', '^submodule\\..*\\.path$']);
          const paths = output.split('\0').filter(Boolean).map(record => record.slice(record.indexOf('\n') + 1));
          limited ||= paths.length > settings.detectSubmodulesLimit;
          for (const relative of paths.slice(0, settings.detectSubmodulesLimit)) {
            const candidate = path.resolve(repositoryRoot, relative);
            if (!isInside(repositoryRoot, candidate)) continue;
            const real = await fs.realpath(candidate).catch(() => null);
            if (!real || real !== candidate) continue;
            await connect(candidate, true);
          }
        } catch (error) { if ((error as { code?: unknown }).code !== 1) errors.push({ root: repositoryRoot, command: 'git config --file .gitmodules --get-regexp path', message: String(error) }); }
      }
    }
    if (settings.detectWorktrees) {
      try {
        const output = await GitCli.run(repositoryRoot, ['worktree', 'list', '--porcelain', '-z']);
        for (const record of output.split('\0')) if (record.startsWith('worktree ')) await connect(record.slice(9), true);
      } catch (error) { errors.push({ root: repositoryRoot, command: 'git worktree list --porcelain -z', message: String(error) }); }
    }
  }
  return { roots: [...roots], limited, parent, errors };
}
