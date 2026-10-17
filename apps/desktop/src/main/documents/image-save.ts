import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sameDiskVersion } from './file-system';
import { readImageBytes } from './image-file';
import type { DiskVersion } from '../../core/document/document';

export const imageHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function imageVersion(file: string): Promise<{ version: DiskVersion; hash: string } | null> {
  try {
    const stat = await fs.stat(file); const version = { size: stat.size, mtimeMs: stat.mtimeMs };
    return { version, hash: imageHash(await readImageBytes(file, version)) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function writeImage(file: string, bytes: Uint8Array, expected: Awaited<ReturnType<typeof imageVersion>>,
  valid: () => boolean): Promise<DiskVersion> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const stat = await fs.stat(file).catch(() => null);
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: stat?.mode });
    if (stat) await fs.chmod(temporary, stat.mode);
    const current = await imageVersion(file);
    if (!valid()) throw Error('The image is no longer open.');
    if (!!expected !== !!current || (expected && current &&
      (!sameDiskVersion(expected.version, current.version) || expected.hash !== current.hash)))
      throw Error('The image changed during export. Reload it or save to another file.');
    await fs.rename(temporary, file);
    const saved = await fs.stat(file); return { size: saved.size, mtimeMs: saved.mtimeMs };
  } finally { await fs.rm(temporary, { force: true }); }
}
