import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_OFFICE_BYTES, readOfficeBytes, readOfficeMetadata } from './office-file';
import { OFFICE_EXTENSIONS, documentProfile, documentSurface, isOfficeDocument, isOpenableDocument, isReadOnlyDocument, isTextCandidate, officeFamily } from '../../core/document/document-profile';
import { applyTextRevision, isDirty } from '../../core/document/document-state';
import { prepareDocumentSave } from '../../core/document/document-save';
import { validReadingRecord } from '../../core/reading/reading-position';

it('routes Word, Excel, PowerPoint and Hangul files to the read-only Office surface', () => {
  for (const extension of OFFICE_EXTENSIONS) {
    const file = `example.${extension.toUpperCase()}`;
    expect(isOpenableDocument(file)).toBe(true);
    expect(isReadOnlyDocument(file)).toBe(true);
    expect(documentProfile(file)).toEqual({ kind: 'office', preview: 'office' });
    expect(documentSurface(file, 'editor')).toBe('office');
    expect(isTextCandidate(file)).toBe(false);
  }
  expect(['report.docx', 'old.DOC', 'budget.xlsx', 'old.xls', 'deck.pptx', 'old.ppt', 'notice.hwp', 'notice.HWPX'].map(officeFamily))
    .toEqual(['word', 'word', 'spreadsheet', 'spreadsheet', 'presentation', 'presentation', 'hangul', 'hangul']);
  // OpenDocument and delimited text keep their existing routes.
  for (const file of ['notes.odt', 'sheet.ods', 'slides.odp', 'file.__proto__', 'docx']) expect(isOfficeDocument(file)).toBe(false);
  expect(isOpenableDocument('notes.odt')).toBe(false);
  expect(documentSurface('table.csv')).toBe('editor');
});

it('reads Office metadata and current bytes only, and rejects text writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-read-'));
  const file = path.join(root, 'report.docx'), original = Buffer.from('PK\u0003\u0004 not really a document');
  try {
    await writeFile(file, original);
    const loaded = await readOfficeMetadata(file);
    expect(loaded).toEqual({ kind: 'office', text: '', diskVersion: loaded.diskVersion });
    expect(loaded.diskVersion.size).toBe(original.length);
    expect(Buffer.from(await readOfficeBytes(file, loaded.diskVersion))).toEqual(original);
    const document = { ...loaded, path: file, name: 'report.docx', savedText: '', revision: 0, savedRevision: 0, isUntitled: false };
    expect(applyTextRevision(document, 'overwritten', 1)).toBe(document);
    expect(isDirty({ ...document, text: 'invalid' })).toBe(false);
    expect(() => prepareDocumentSave(document, '', file)).toThrow('read-only');
    expect(() => prepareDocumentSave({ ...document, kind: undefined, path: path.join(root, 'note.md') }, 'text', file)).toThrow('binary');
    // A stale snapshot must never be shown as the current file.
    await expect(readOfficeBytes(file, { ...loaded.diskVersion, size: loaded.diskVersion.size + 1 })).rejects.toThrow('changed');
    await utimes(file, new Date(), new Date(Date.now() + 60_000));
    await expect(readOfficeBytes(file, loaded.diskVersion)).rejects.toThrow('changed');
    expect(await readFile(file)).toEqual(original);
    const directory = path.join(root, 'directory.xlsx'); await mkdir(directory);
    await expect(readOfficeMetadata(directory)).rejects.toThrow('regular');
    await expect(readOfficeMetadata(path.join(root, 'notes.odt'))).rejects.toThrow('Unsupported');
    const large = path.join(root, 'large.pptx'); await writeFile(large, ''); await truncate(large, MAX_OFFICE_BYTES + 1);
    await expect(readOfficeMetadata(large)).rejects.toThrow('128 MiB');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('accepts only bounded Office reading positions', () => {
  const record = (position: unknown) => ({ version: 1, path: '/docs/report.docx', observedAt: 100, diskVersion: { mtimeMs: 3, size: 100 }, position });
  expect(validReadingRecord(record({ kind: 'office', top: .4, left: 0 }))).toBe(true);
  expect(validReadingRecord(record({ kind: 'office', top: 1, left: 1, sheet: 2 }))).toBe(true);
  for (const position of [{ kind: 'office', top: 1.01, left: 0 }, { kind: 'office', top: 0, left: -1 }, { kind: 'office', top: Number.NaN, left: 0 },
    { kind: 'office', top: 0, left: 0, sheet: 1.5 }, { kind: 'office', top: 0, left: 0, sheet: -1 }, { kind: 'office', left: 0 }])
    expect(validReadingRecord(record(position))).toBe(false);
});
