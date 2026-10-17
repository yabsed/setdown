import { expect, test } from 'vitest';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { hwpContainer, hwpVersion, MAX_HWP_BYTES, readHwp, readHwpMetadata, writeHwp } from './hwp-file';
import { documentProfile, documentSurface, isOpenableDocument, isTextCandidate } from '../../core/document/document-profile';
import { prepareDocumentSave } from '../../core/document/document-save';
import { applyTextRevision } from '../../core/document/document-state';
const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
test('HWP/HWPX are openable binary editor documents, never UTF-8 save destinations', async () => {
  for (const extension of ['hwp', 'HWPX']) {
    const file = `example.${extension}`;
    expect(isOpenableDocument(file)).toBe(true); expect(isTextCandidate(file)).toBe(false);
    expect(documentProfile(file)).toEqual({ kind: 'hwp', preview: null });
    expect(documentSurface(file)).toBe('hwp');
    const snapshot = { path: 'note.txt', name: 'note.txt', text: '', savedText: '', revision: 0, savedRevision: 0, diskVersion: { size: 0, mtimeMs: 0 }, isUntitled: false };
    expect(() => prepareDocumentSave(snapshot, 'text', file)).toThrow('binary');
    const hwp = { ...snapshot, path: file, kind: 'hwp' as const };
    expect(applyTextRevision(hwp, 'corrupt', 100)).toBe(hwp);
  }
  expect(hwpContainer(Buffer.from('HWP Document File old format'))).toBe('hwp3');
  expect(hwpContainer(Buffer.from([0x50, 0x4b, 3, 4]))).toBe('hwpx');
  expect(() => hwpContainer(Buffer.from('not a document'))).toThrow();
});
test('binary writes compare content as well as version, preserve source on cancellation, and clean temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-hwp-file-')); const file = path.join(root, 'test.hwp');
  try {
    await writeFile(file, ole); const source = await readHwp(file);
    expect(await readHwpMetadata(file)).toEqual({ kind: 'hwp', text: '', diskVersion: source.version });
    const edited = Buffer.concat([ole, Buffer.from('new content')]);
    await expect(writeHwp(file, edited, source, () => false)).rejects.toThrow('닫혔');
    expect(await readFile(file)).toEqual(ole);
    await writeFile(file, Buffer.concat([ole, Buffer.from('external')]));
    await expect(writeHwp(file, edited, source, () => true)).rejects.toThrow('외부');
    expect((await readFile(file)).subarray(-8).toString()).toBe('external');
    const current = await hwpVersion(file);
    await writeHwp(file, edited, current, () => true); expect(await readFile(file)).toEqual(edited);
    expect(await readdir(root)).toEqual(['test.hwp']);
    const huge = await open(path.join(root, 'huge.hwp'), 'w'); await huge.truncate(MAX_HWP_BYTES + 1); await huge.close();
    await expect(readHwp(path.join(root, 'huge.hwp'))).rejects.toThrow('128 MiB');
  } finally { await rm(root, { recursive: true, force: true }); }
});
