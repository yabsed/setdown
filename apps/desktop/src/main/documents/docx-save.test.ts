import { expect, test, vi } from 'vitest';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { docxPackageError, docxVersion, wordPackageProblem, writeDocx, zipEntryNames } from './docx-save';
import type { DocxSaveRequest } from '../../protocol/docx-edit';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';

const picker = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));
vi.mock('../dialogs/path-picker', () => ({ pathDialog: picker }));
const { openDocx, saveDocx } = await import('./docx-edit-ipc');

const fixtures = path.join(import.meta.dirname, '../../../test/fixtures/office');
const report = () => readFile(path.join(fixtures, 'report.docx'));

test('only a WordprocessingML package passes as a Word document', async () => {
  const docx = await report();
  expect(zipEntryNames(docx)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']));
  expect(docxPackageError(docx)).toBeNull();
  // A view into a larger buffer is read through its own offset.
  const padded = new Uint8Array(docx.length + 64); padded.set(docx, 32);
  expect(docxPackageError(padded.subarray(32, 32 + docx.length))).toBeNull();
  // Other OOXML packages are archives, but not Word documents, whatever they are named.
  for (const name of ['budget.xlsx', 'deck.pptx', 'sample.hwpx']) {
    const other = await readFile(path.join(fixtures, name));
    expect(zipEntryNames(other)).not.toBeNull();
    expect(wordPackageProblem(other)).toBe('word');
    expect(docxPackageError(other)).toContain('without a Word document part');
  }
  for (const bytes of [new Uint8Array(), Buffer.from('PK\u0003\u0004 not really a document'), docx.subarray(0, docx.length - 40),
    await readFile(path.join(fixtures, 'report.doc'))]) {
    expect(zipEntryNames(bytes)).toBeNull();
    expect(wordPackageProblem(bytes)).toBe('archive');
    expect(docxPackageError(bytes)).toContain('not a Word document');
  }
  // A package that only keeps the usual part name, without declaring a Word main part, is not one either.
  const undeclared = Buffer.from(docx);
  const declared = undeclared.indexOf('[Content_Types].xml'), second = undeclared.indexOf('[Content_Types].xml', declared + 1);
  expect(declared).toBeGreaterThan(-1); expect(second).toBeGreaterThan(-1);
  undeclared.write('[Content_Typez].xml', second, 'latin1');
  expect(zipEntryNames(undeclared)).toContain('word/document.xml');
  expect(wordPackageProblem(undeclared)).toBe('word');
});

test('a save replaces the file in one step, keeps its mode and never overwrites a version it was not prepared against', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docx-save-')), file = path.join(root, 'report.docx');
  try {
    const docx = await report();
    await writeFile(file, 'previous bytes'); await chmod(file, 0o640);
    const first = await docxVersion(file);
    const written = await writeDocx(file, docx, first, () => true);
    expect(await readFile(file)).toEqual(docx);
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect(written).toEqual(await docxVersion(file));
    // Another application replaced the file after this tab read it.
    await writeFile(file, 'someone else');
    await expect(writeDocx(file, docx, written, () => true)).rejects.toThrow('changed on disk while saving');
    expect((await readFile(file)).toString()).toBe('someone else');
    // The tab closed while the package was being written.
    await expect(writeDocx(file, docx, await docxVersion(file), () => false)).rejects.toThrow('no longer open');
    // Damaged output is refused before anything touches the directory.
    await expect(writeDocx(file, docx.subarray(0, 100), await docxVersion(file), () => true)).rejects.toThrow('Nothing was written');
    expect((await readFile(file)).toString()).toBe('someone else');
    // A deleted document is not silently recreated, and a new destination must still be free.
    const version = await docxVersion(file); await rm(file);
    await expect(writeDocx(file, docx, version, () => true)).rejects.toThrow('changed on disk while saving');
    await writeDocx(file, docx, null, () => true);
    await expect(writeDocx(file, docx, null, () => true)).rejects.toThrow('changed on disk while saving');
    expect(await readdir(root)).toEqual(['report.docx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('main saves only an open Word document, in place against the version the tab holds, or to a chosen .docx', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docx-ipc-')), file = path.join(root, 'report.docx');
  try {
    const docx = await report();
    await copyFile(path.join(fixtures, 'report.docx'), file);
    const original = await readFile(file);
    const snapshot = async (target = file): Promise<DocumentSnapshot> => ({ kind: 'office', path: target, name: path.basename(target), text: '', savedText: '',
      revision: 0, savedRevision: 0, isUntitled: false, diskVersion: (await docxVersion(target))! });
    const state = { window: { isDestroyed: () => false }, currentDocument: await snapshot(), activeRoot: null,
      rendererTabs: [{ name: 'report.docx', path: file, dirty: true, isUntitled: false }] } as unknown as WindowState;
    const documents = { watch: vi.fn(), writeWatchedFile: vi.fn((_state: WindowState, _file: string, write: () => Promise<DocumentSnapshot['diskVersion']>) => write()) };
    const request = async (overrides: Partial<DocxSaveRequest> = {}): Promise<DocxSaveRequest> =>
      ({ document: await snapshot(), bytes: new Uint8Array(docx), revision: 3, saveAs: false, ...overrides });

    // Opening hands over the current bytes with the verdict on what they are, and only for this window's own .docx tabs.
    const opened = await openDocx(state, file, (await docxVersion(file))!);
    expect(Buffer.from(opened.bytes)).toEqual(original);
    expect(opened.word).toBe(true);
    const spreadsheet = path.join(root, 'renamed.docx'); await copyFile(path.join(fixtures, 'budget.xlsx'), spreadsheet);
    await expect(openDocx(state, spreadsheet, (await docxVersion(spreadsheet))!)).rejects.toThrow('not open in this window');
    state.rendererTabs.push({ name: 'renamed.docx', path: spreadsheet, dirty: false, isUntitled: false });
    expect((await openDocx(state, spreadsheet, (await docxVersion(spreadsheet))!)).word).toBe(false);
    await expect(openDocx(state, file, { ...(await docxVersion(file))!, size: 1 })).rejects.toThrow('changed');
    await expect(openDocx(state, path.join(root, 'report.doc'), (await docxVersion(file))!)).rejects.toThrow('not open in this window');
    state.rendererTabs.pop(); await rm(spreadsheet);

    // Requests for other files, other kinds, or anything that is not a package never reach the disk.
    const other = path.join(root, 'other.docx'); await copyFile(file, other);
    await expect(saveDocx(state, documents, await request({ document: await snapshot(other) }))).rejects.toThrow('Invalid document save request');
    await expect(saveDocx(state, documents, await request({ document: { ...await snapshot(), kind: 'pdf' } }))).rejects.toThrow('Invalid document save request');
    await expect(saveDocx(state, documents, await request({ document: { ...await snapshot(), path: path.join(root, 'report.doc') } }))).rejects.toThrow('Invalid document save request');
    await expect(saveDocx(state, documents, await request({ bytes: Buffer.from('plain text') }))).rejects.toThrow('not a Word document');
    await expect(saveDocx(state, documents, await request({ revision: -1 }))).rejects.toThrow('Invalid document save request');
    expect(await readFile(file)).toEqual(original);
    expect(documents.writeWatchedFile).not.toHaveBeenCalled();

    // A stale tab cannot overwrite a file another application changed.
    const stale = await request();
    await writeFile(file, Buffer.concat([original, Buffer.alloc(1)]));
    await expect(saveDocx(state, documents, stale)).rejects.toThrow('changed on disk');
    expect((await readFile(file)).length).toBe(original.length + 1);

    const saved = await saveDocx(state, documents, await request());
    expect(saved.canceled).toBe(false);
    expect(saved.document).toMatchObject({ path: file, name: 'report.docx', kind: 'office', revision: 3, savedRevision: 3, text: '', isUntitled: false });
    expect(saved.document!.diskVersion).toEqual(await docxVersion(file));
    expect(await readFile(file)).toEqual(docx);
    expect(state.currentDocument).toEqual(saved.document);
    expect(documents.writeWatchedFile).toHaveBeenCalledOnce();
    expect(documents.watch).toHaveBeenCalledOnce();

    // Save As: cancel leaves everything alone; a name without an extension becomes .docx; other formats are refused.
    picker.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await saveDocx(state, documents, await request({ saveAs: true }))).toEqual({ canceled: true });
    picker.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'copy') });
    const copy = await saveDocx(state, documents, await request({ saveAs: true, revision: 4 }));
    expect(copy.document).toMatchObject({ path: path.join(root, 'copy.docx'), name: 'copy.docx', savedRevision: 4 });
    expect(await readFile(path.join(root, 'copy.docx'))).toEqual(docx);
    picker.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'copy.pdf') });
    state.currentDocument = await snapshot(); // the renderer has not adopted the copy
    await expect(saveDocx(state, documents, await request({ saveAs: true }))).rejects.toThrow('.docx extension');
    // The destination of another open tab is never replaced underneath it.
    state.rendererTabs.push({ name: 'other.docx', path: other, dirty: false, isUntitled: false });
    picker.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: other });
    await expect(saveDocx(state, documents, await request({ saveAs: true }))).rejects.toThrow('Close the other tab');
    expect(await readFile(other)).toEqual(original);
    expect((await readdir(root)).sort()).toEqual(['copy.docx', 'other.docx', 'report.docx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
