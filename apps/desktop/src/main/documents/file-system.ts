import { promises as fs, realpathSync, statSync, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiskVersion } from '../../protocol/desktop-api';
export { sameDiskVersion } from '../../core/document/document';

export function versionFromStat(stat: { mtimeMs: number; size: number; ctimeMs: number; ino: number; dev: number }): DiskVersion {
  return { mtimeMs: stat.mtimeMs, size: stat.size, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
}

export function diskVersion(filePath: string): DiskVersion {
  return versionFromStat(statSync(filePath));
}

export function canonicalPath(candidate: string) {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

/** Save As must follow a dangling leaf link too, without replacing the link. */
export function canonicalSavePath(candidate: string): string {
  let resolved = path.resolve(candidate);
  for (let links = 0; links < 40; links++) {
    resolved = path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
    try {
      if (!lstatSync(resolved).isSymbolicLink()) return resolved;
      resolved = path.resolve(path.dirname(resolved), readlinkSync(resolved));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
      throw error;
    }
  }
  throw new Error('The save destination contains a symbolic-link cycle.');
}

export function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

const saves = new Map<string, Promise<unknown>>();
/** Includes conflict checks in the same queue as the write, across all windows. */
export async function serializeFileSave<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = canonicalPath(filePath);
  const pending = (saves.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  saves.set(key, pending);
  try { return await pending; }
  finally { if (saves.get(key) === pending) saves.delete(key); }
}

export async function atomicWrite(filePath: string, text: string, beforeCommit?: () => void) {
  const stat = await fs.stat(filePath).catch(() => null);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, text, { encoding: 'utf8', mode: stat?.mode, flag: 'wx' });
    if (stat) await fs.chmod(temporary, stat.mode);
    const handle = await fs.open(temporary, 'r');
    try {
      beforeCommit?.();
      await fs.rename(temporary, filePath);
      return versionFromStat(await handle.stat());
    } finally { await handle.close(); }
  } finally { await fs.rm(temporary, { force: true }); }
}
