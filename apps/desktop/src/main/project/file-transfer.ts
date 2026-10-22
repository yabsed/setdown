import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

export async function exists(candidate: string): Promise<boolean> {
  return fs.lstat(candidate).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

export async function ensureMissing(candidate: string): Promise<void> {
  if (await exists(candidate)) throw new Error(`“${path.basename(candidate)}” already exists.`);
}

/** Preserve dotfiles and common compound archive suffixes when allocating a copy. */
export function copyName(name: string, directory: boolean, index: number): string {
  const suffix = directory ? '' : name.match(/\.tar\.(?:gz|bz2|xz|zst)$/i)?.[0] ?? path.extname(name);
  const stem = suffix ? name.slice(0, -suffix.length) : name;
  return `${stem} copy${index === 1 ? '' : ` ${index}`}${suffix}`;
}

/** Reserve destinations atomically: never rename over someone else's file.
 * Directories reserve an empty directory; rename fails if it becomes nonempty.
 * EXDEV is intentionally rejected, without deleting the source.
 */
export async function moveExclusive(from: string, to: string): Promise<void> {
  const stat = await fs.lstat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { mode: stat.mode });
    const reserved = await fs.lstat(to);
    try { await fs.rename(from, to); }
    catch (error) {
      const current = await fs.lstat(to).catch(() => null);
      if (current?.ino === reserved.ino && current?.dev === reserved.dev) await fs.rmdir(to).catch(() => {});
      throw error;
    }
  } else {
    // link() also copies the link itself when the source is a symbolic link.
    await fs.link(from, to);
    try {
      const source = await fs.lstat(from);
      if (source.ino !== stat.ino || source.dev !== stat.dev) throw new Error('The source changed during the move.');
      await fs.unlink(from);
    }
    catch (error) {
      // Source still exists. Roll back only our new hard link, not a replacement.
      const current = await fs.lstat(to).catch(() => null);
      if (current?.ino === stat.ino && current?.dev === stat.dev) await fs.unlink(to).catch(() => {});
      throw error;
    }
  }
}

async function copyTree(from: string, to: string): Promise<void> {
  const stat = await fs.lstat(from);
  if (stat.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(from), to);
  } else if (stat.isDirectory()) {
    // Keep the staging directory writable until every child has been copied.
    await fs.mkdir(to, { mode: 0o700 });
    const entries = await fs.opendir(from);
    for await (const entry of entries) await copyTree(path.join(from, entry.name), path.join(to, entry.name));
    await fs.chmod(to, stat.mode);
    await fs.utimes(to, stat.atime, stat.mtime);
  } else if (stat.isFile()) {
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    await fs.chmod(to, stat.mode);
    await fs.utimes(to, stat.atime, stat.mtime);
  } else throw new Error(`Cannot copy this file type: ${from}`);
}

/** Only our staging tree is made writable; never follow links during cleanup. */
async function removeStaging(directory: string): Promise<void> {
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeStaging(path.join(directory, entry.name));
  }
  await fs.rm(directory, { recursive: true, force: true });
}

/** Stage on the destination volume. Failed copies never expose a partial file/tree. */
export async function copyExclusive(from: string, to: string): Promise<void> {
  await ensureMissing(to);
  const staging = await fs.mkdtemp(path.join(path.dirname(to), '.setdown-copy-'));
  let failed = false;
  try {
    const staged = path.join(staging, 'entry');
    await copyTree(from, staged);
    const stat = await fs.lstat(staged);
    // Moving a directory between parents can require write access to update '..'.
    if (stat.isDirectory()) await fs.chmod(staged, stat.mode | 0o700);
    await moveExclusive(staged, to);
    if (stat.isDirectory()) await fs.chmod(to, stat.mode);
  } catch (error) { failed = true; throw error; }
  finally {
    try { await removeStaging(staging); }
    catch (error) { if (!failed) throw error; }
  }
}
