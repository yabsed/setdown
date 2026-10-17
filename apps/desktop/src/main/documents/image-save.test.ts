import { expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, chmod, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { imageVersion, writeImage } from './image-save';

test('binary replacement preserves mode, detects same-metadata changes and cleans failed temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-save-')), file = path.join(root, 'test.png');
  try {
    await writeFile(file, 'old bytes'); await chmod(file, 0o640);
    const expected = await imageVersion(file);
    await writeImage(file, new Uint8Array([1, 2, 3]), expected, () => true);
    expect(await readFile(file)).toEqual(Buffer.from([1, 2, 3])); expect((await stat(file)).mode & 0o777).toBe(0o640);
    await utimes(file, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    const before = await imageVersion(file), times = await stat(file);
    await writeFile(file, new Uint8Array([4, 5, 6])); await utimes(file, times.atime, times.mtime);
    await expect(writeImage(file, new Uint8Array([7, 8, 9]), before, () => true)).rejects.toThrow('changed during export');
    expect(await readFile(file)).toEqual(Buffer.from([4, 5, 6]));
    await expect(writeImage(file, new Uint8Array([0]), await imageVersion(file), () => false)).rejects.toThrow('no longer open');
    expect(await readdir(root)).toEqual(['test.png']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('an export cannot recreate a file deleted while it was running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-delete-')), file = path.join(root, 'test.png');
  try {
    await writeFile(file, 'source'); const expected = await imageVersion(file); await rm(file);
    await expect(writeImage(file, new Uint8Array([0]), expected, () => true)).rejects.toThrow('changed during export');
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
