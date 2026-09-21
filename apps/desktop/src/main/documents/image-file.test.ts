import { expect, it } from 'vitest';
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_IMAGE_BYTES, readImageBytes, readImageMetadata } from './image-file';
import { IMAGE_EXTENSIONS, documentProfile, documentSurface, isOpenableDocument, imageMimeType } from '../../core/document/document-profile';
import { applyTextRevision, isDirty } from '../../core/document/document-state';
import { prepareDocumentSave } from '../../core/document/document-save';

it('routes supported images to read-only surfaces, including mixed-case extensions', () => {
  for (const extension of IMAGE_EXTENSIONS) {
    const file = `example.${extension.toUpperCase()}`;
    expect(isOpenableDocument(file)).toBe(true);
    expect(documentProfile(file)).toEqual({ kind: 'image', preview: 'image' });
    expect(documentSurface(file, 'editor')).toBe('image');
  }
  expect(imageMimeType('file.__proto__')).toBeUndefined();
  expect(isOpenableDocument('file.psd')).toBe(false);
});

it('reads exact-version regular images with a size bound and rejects text writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-read-'));
  const file = path.join(root, 'image.svg');
  try {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    await writeFile(file, source);
    const loaded = await readImageMetadata(file);
    expect(Buffer.from(await readImageBytes(file, loaded.diskVersion)).toString()).toBe(source);
    const document = { ...loaded, path: file, name: 'image.svg', savedText: '', revision: 0, savedRevision: 0, isUntitled: false };
    expect(applyTextRevision(document, 'overwritten', 1)).toBe(document);
    expect(isDirty({ ...document, text: 'invalid' })).toBe(false);
    expect(() => prepareDocumentSave(document, '', file)).toThrow('read-only');
    await writeFile(file, source + ' ');
    await expect(readImageBytes(file, loaded.diskVersion)).rejects.toThrow('changed');
    const directory = path.join(root, 'directory.png'); await mkdir(directory);
    await expect(readImageMetadata(directory)).rejects.toThrow('regular');
    const huge = path.join(root, 'huge.png');
    const handle = await open(huge, 'w'); await handle.truncate(MAX_IMAGE_BYTES + 1); await handle.close();
    await expect(readImageMetadata(huge)).rejects.toThrow('64 MiB');
  } finally { await rm(root, { recursive: true, force: true }); }
});
