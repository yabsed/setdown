import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Mark `root` as a repository boundary the way Git recognizes one: a `.git`
 * directory holding HEAD. An empty `.git` directory is not a repository (it is
 * what sandbox mount targets leave behind, e.g. `/tmp/.git`), so analysis-root
 * discovery ignores it. This is not a usable Git repository; use `git init`
 * where Git commands must succeed.
 */
export async function markRepositoryRoot(root: string) {
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}
