import { promises as fs, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DiskVersion } from '../../shared/contracts';

export function diskVersion(filePath: string): DiskVersion {
  const stat = statSync(filePath);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

export const sameDiskVersion = (a: DiskVersion, b: DiskVersion) => (
  a.mtimeMs === b.mtimeMs && a.size === b.size
);

export function canonicalPath(candidate: string) {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

export function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function atomicWrite(filePath: string, text: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(temporary, text, { encoding: 'utf8', mode: stat?.mode });
  await fs.rename(temporary, filePath);
}
