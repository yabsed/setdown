import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DiskVersion } from '../../core/document/document';
import { sameDiskVersion } from './file-system';

export const MAX_HWP_BYTES = 128 * 1024 * 1024;
export const hwpHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function hwpContainer(bytes: Uint8Array): 'hwp' | 'hwpx' | 'hwp3' {
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) return 'hwp';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'hwpx';
  if (Buffer.from(bytes.subarray(0, 17)).toString('ascii') === 'HWP Document File') return 'hwp3';
  throw Error('지원하지 않는 HWP 파일입니다. 암호화·DRM 문서는 한글에서 해제한 사본을 사용하세요.');
}
export async function readHwp(file: string) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 8 || stat.size > MAX_HWP_BYTES) throw Error('HWP 파일 크기는 128 MiB 이하여야 합니다.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw Error('읽는 동안 HWP 파일이 변경되었습니다.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    const version = { size: stat.size, mtimeMs: stat.mtimeMs };
    if (!sameDiskVersion(version, after)) throw Error('읽는 동안 HWP 파일이 변경되었습니다.');
    return { bytes, version, hash: hwpHash(bytes), format: hwpContainer(bytes) };
  } finally { await handle.close(); }
}
export async function readHwpMetadata(file: string) {
  const source = await readHwp(file);
  return { kind: 'hwp' as const, text: '', diskVersion: source.version };
}
export async function hwpVersion(file: string) {
  try { const { version, hash } = await readHwp(file); return { version, hash }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Recheck after export/dialogs and immediately before rename; never write UTF-8. */
export async function writeHwp(file: string, bytes: Uint8Array, expected: Awaited<ReturnType<typeof hwpVersion>>, valid: () => boolean): Promise<DiskVersion> {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_HWP_BYTES) throw Error('Invalid HWP export.');
  hwpContainer(bytes);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const stat = await fs.stat(file).catch(() => null);
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: stat?.mode });
    if (stat) await fs.chmod(temporary, stat.mode);
    const current = await hwpVersion(file);
    if (!valid()) throw Error('HWP 문서가 닫혔거나 다른 창으로 이동했습니다.');
    if (!!current !== !!expected || (current && expected &&
      (current.hash !== expected.hash || !sameDiskVersion(current.version, expected.version))))
      throw Error('파일이 외부에서 변경되었습니다. 다시 불러오거나 다른 이름으로 저장하세요.');
    await fs.rename(temporary, file);
    const saved = await fs.stat(file); return { size: saved.size, mtimeMs: saved.mtimeMs };
  } finally { await fs.rm(temporary, { force: true }); }
}
