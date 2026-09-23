import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readVideoMetadata } from './video-file';
import { VIDEO_EXTENSIONS, documentProfile, documentSurface, isOpenableDocument, isTextCandidate, videoMimeType } from '../../core/document/document-profile';
import { applyTextRevision, isDirty } from '../../core/document/document-state';
import { prepareDocumentSave } from '../../core/document/document-save';

it('routes supported videos to read-only surfaces, including mixed-case extensions', () => {
  for (const extension of VIDEO_EXTENSIONS) {
    const file = `example.${extension.toUpperCase()}`;
    expect(isOpenableDocument(file)).toBe(true);
    expect(documentProfile(file)).toEqual({ kind: 'video', preview: 'video' });
    expect(documentSurface(file, 'editor')).toBe('video');
    expect(isTextCandidate(file)).toBe(false);
  }
  expect(videoMimeType('clip.mp4')).toBe('video/mp4');
  expect(videoMimeType('clip.webm')).toBe('video/webm');
  expect(videoMimeType('file.__proto__')).toBeUndefined();
  expect(isOpenableDocument('clip.mov')).toBe(false);
});

it('reads regular video metadata without touching the bytes and rejects text writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-read-'));
  const file = path.join(root, 'clip.mp4');
  try {
    await writeFile(file, 'not really a video');
    const loaded = await readVideoMetadata(file);
    expect(loaded).toEqual({ kind: 'video', text: '', diskVersion: loaded.diskVersion });
    expect(loaded.diskVersion.size).toBe(18);
    const document = { ...loaded, path: file, name: 'clip.mp4', savedText: '', revision: 0, savedRevision: 0, isUntitled: false };
    expect(applyTextRevision(document, 'overwritten', 1)).toBe(document);
    expect(isDirty({ ...document, text: 'invalid' })).toBe(false);
    expect(() => prepareDocumentSave(document, '', file)).toThrow('read-only');
    const directory = path.join(root, 'directory.mp4'); await mkdir(directory);
    await expect(readVideoMetadata(directory)).rejects.toThrow('regular');
    await expect(readVideoMetadata(path.join(root, 'clip.mov'))).rejects.toThrow('Unsupported');
  } finally { await rm(root, { recursive: true, force: true }); }
});
