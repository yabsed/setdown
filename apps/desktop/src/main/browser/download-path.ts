import { closeSync, mkdirSync, openSync, promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Reserve `name`, `name (1)`, … in the downloads folder before `will-download`
 * returns, as Chrome does without a "Save as" prompt. The reservation is an
 * empty file created exclusively, so two downloads never share a target.
 */
export function reserveDownloadPath(root: string, suggested: string): string {
  mkdirSync(root, { recursive: true });
  const name = path.basename(suggested).replace(/[\0/\\]/g, '_').trim() || 'download';
  const filename = path.join(root, name === '.' || name === '..' ? 'download' : name);
  const ext = /\.tar\.(?:gz|bz2|xz|zst)$/i.exec(filename)?.[0] ?? path.extname(filename);
  for (let i = 0; i < 1000; i++) {
    const candidate = i ? `${filename.slice(0, filename.length - ext.length)} (${i})${ext}` : filename;
    try { closeSync(openSync(candidate, 'wx')); return candidate; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  throw Error('Could not allocate a download filename.');
}

/** Remove a reservation only while it is still the empty placeholder. */
export async function releaseDownloadReservation(reserved: string): Promise<void> {
  const stat = await fs.lstat(reserved).catch(() => null);
  if (stat?.isFile() && stat.size === 0) await fs.unlink(reserved).catch(() => {});
}
