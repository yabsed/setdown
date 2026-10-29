import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GitCli } from './git-cli';

const ignored = new Set(['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '.cache']);
/** Bounded discovery; linked worktrees and submodules have .git files, not directories. */
export async function discoverRepositories(root: string): Promise<{ roots: string[]; limited: boolean }> {
  const containing = await GitCli.connect(root);
  const roots = new Set<string>(containing ? [containing.repositoryRoot] : []);
  const queue = [root]; let inspected = 0;
  while (queue.length && inspected++ < 2000) {
    const directory = queue.shift()!;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    if (entries.some(entry => entry.name === '.git')) {
      const repository = await GitCli.connect(directory);
      if (repository) roots.add(repository.repositoryRoot);
    }
    for (const entry of entries) if (entry.isDirectory() && !ignored.has(entry.name)) queue.push(path.join(directory, entry.name));
  }
  return { roots: [...roots], limited: queue.length > 0 };
}
