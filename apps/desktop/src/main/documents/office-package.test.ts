import { expect, test, vi } from 'vitest';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { officePackageError, officePackageProblem, packageVersion, writeOfficePackage, zipEntryNames } from './office-package';
import type { DocxSaveRequest } from '../../protocol/docx-edit';
import type { DocumentSnapshot } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';

const picker = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));
vi.mock('../dialogs/path-picker', () => ({ pathDialog: picker }));
const { openDocx, openPptx, saveDocx, savePptx } = await import('./office-edit-ipc');

const fixtures = path.join(import.meta.dirname, '../../../test/fixtures/office');
const report = () => readFile(path.join(fixtures, 'report.docx'));
const deck = () => readFile(path.join(fixtures, 'deck.pptx'));

test('only a WordprocessingML package passes as a Word document', async () => {
  const docx = await report();
  expect(zipEntryNames(docx)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']));
  expect(officePackageError(docx, 'word')).toBeNull();
  // A view into a larger buffer is read through its own offset.
  const padded = new Uint8Array(docx.length + 64); padded.set(docx, 32);
  expect(officePackageError(padded.subarray(32, 32 + docx.length), 'word')).toBeNull();
  // Other OOXML packages are archives, but not Word documents, whatever they are named.
  for (const name of ['budget.xlsx', 'deck.pptx', 'sample.hwpx']) {
    const other = await readFile(path.join(fixtures, name));
    expect(zipEntryNames(other)).not.toBeNull();
    expect(officePackageProblem(other, 'word')).toBe('part');
    expect(officePackageError(other, 'word')).toContain('without a Word document part');
  }
  for (const bytes of [new Uint8Array(), Buffer.from('PK\u0003\u0004 not really a document'), docx.subarray(0, docx.length - 40),
    await readFile(path.join(fixtures, 'report.doc'))]) {
    expect(zipEntryNames(bytes)).toBeNull();
    expect(officePackageProblem(bytes, 'word')).toBe('archive');
    expect(officePackageError(bytes, 'word')).toContain('not a Word document');
  }
  // A package that only keeps the usual part name, without declaring a Word main part, is not one either.
  const undeclared = Buffer.from(docx);
  const declared = undeclared.indexOf('[Content_Types].xml'), second = undeclared.indexOf('[Content_Types].xml', declared + 1);
  expect(declared).toBeGreaterThan(-1); expect(second).toBeGreaterThan(-1);
  undeclared.write('[Content_Typez].xml', second, 'latin1');
  expect(zipEntryNames(undeclared)).toContain('word/document.xml');
  expect(officePackageProblem(undeclared, 'word')).toBe('part');
});

test('a save replaces the file in one step, keeps its mode and never overwrites a version it was not prepared against', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docx-save-')), file = path.join(root, 'report.docx');
  try {
    const docx = await report();
    await writeFile(file, 'previous bytes'); await chmod(file, 0o640);
    const first = await packageVersion(file);
    const written = await writeOfficePackage(file, docx, first, () => true, 'word');
    expect(await readFile(file)).toEqual(docx);
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    expect(written).toEqual(await packageVersion(file));
    // Another application replaced the file after this tab read it.
    await writeFile(file, 'someone else');
    await expect(writeOfficePackage(file, docx, written, () => true, 'word')).rejects.toThrow('changed on disk while saving');
    expect((await readFile(file)).toString()).toBe('someone else');
    // The tab closed while the package was being written.
    await expect(writeOfficePackage(file, docx, await packageVersion(file), () => false, 'word')).rejects.toThrow('no longer open');
    // Damaged output is refused before anything touches the directory.
    await expect(writeOfficePackage(file, docx.subarray(0, 100), await packageVersion(file), () => true, 'word')).rejects.toThrow('Nothing was written');
    expect((await readFile(file)).toString()).toBe('someone else');
    // A deleted document is not silently recreated, and a new destination must still be free.
    const version = await packageVersion(file); await rm(file);
    await expect(writeOfficePackage(file, docx, version, () => true, 'word')).rejects.toThrow('changed on disk while saving');
    await writeOfficePackage(file, docx, null, () => true, 'word');
    await expect(writeOfficePackage(file, docx, null, () => true, 'word')).rejects.toThrow('changed on disk while saving');
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
      revision: 0, savedRevision: 0, isUntitled: false, diskVersion: (await packageVersion(target))! });
    const state = { window: { isDestroyed: () => false }, currentDocument: await snapshot(), activeRoot: null,
      rendererTabs: [{ name: 'report.docx', path: file, dirty: true, isUntitled: false }] } as unknown as WindowState;
    const documents = { watch: vi.fn(), writeWatchedFile: vi.fn((_state: WindowState, _file: string, write: () => Promise<DocumentSnapshot['diskVersion']>) => write()) };
    const request = async (overrides: Partial<DocxSaveRequest> = {}): Promise<DocxSaveRequest> =>
      ({ document: await snapshot(), bytes: new Uint8Array(docx), revision: 3, saveAs: false, ...overrides });

    // Opening hands over the current bytes with the verdict on what they are, and only for this window's own .docx tabs.
    const opened = await openDocx(state, file, (await packageVersion(file))!);
    expect(Buffer.from(opened.bytes)).toEqual(original);
    expect(opened.word).toBe(true);
    const spreadsheet = path.join(root, 'renamed.docx'); await copyFile(path.join(fixtures, 'budget.xlsx'), spreadsheet);
    await expect(openDocx(state, spreadsheet, (await packageVersion(spreadsheet))!)).rejects.toThrow('not open in this window');
    state.rendererTabs.push({ name: 'renamed.docx', path: spreadsheet, dirty: false, isUntitled: false });
    expect((await openDocx(state, spreadsheet, (await packageVersion(spreadsheet))!)).word).toBe(false);
    await expect(openDocx(state, file, { ...(await packageVersion(file))!, size: 1 })).rejects.toThrow('changed');
    await expect(openDocx(state, path.join(root, 'report.doc'), (await packageVersion(file))!)).rejects.toThrow('not open in this window');
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
    expect(saved.document!.diskVersion).toEqual(await packageVersion(file));
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

test('only a PresentationML package passes as a presentation, and each editor refuses the other one\'s package', async () => {
  const pptx = await deck(), docx = await report();
  expect(zipEntryNames(pptx)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'ppt/presentation.xml']));
  expect(officePackageProblem(pptx, 'presentation')).toBeNull();
  expect(officePackageError(pptx, 'presentation')).toBeNull();
  expect(officePackageProblem(pptx, 'word')).toBe('part');
  for (const name of ['report.docx', 'budget.xlsx', 'sample.hwpx']) {
    const other = await readFile(path.join(fixtures, name));
    expect(officePackageProblem(other, 'presentation')).toBe('part');
    expect(officePackageError(other, 'presentation')).toContain('without a presentation part');
  }
  // The legacy binary format and plain text are not archives at all.
  for (const bytes of [await readFile(path.join(fixtures, 'deck.ppt')), Buffer.from('<html>slides</html>'), Buffer.alloc(0)]) {
    expect(officePackageProblem(bytes, 'presentation')).toBe('archive');
    expect(officePackageError(bytes, 'presentation')).toContain('not a PowerPoint presentation');
  }
  // The writer checks for the editor it writes for: a Word package is never written as a presentation.
  const root = await mkdtemp(path.join(os.tmpdir(), 'pptx-save-')), file = path.join(root, 'deck.pptx');
  try {
    await expect(writeOfficePackage(file, docx, null, () => true, 'presentation')).rejects.toThrow('Nothing was written');
    expect(await readdir(root)).toEqual([]);
    const written = await writeOfficePackage(file, pptx, null, () => true, 'presentation');
    expect(await readFile(file)).toEqual(pptx);
    expect(written).toEqual(await packageVersion(file));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('main saves only an open presentation, in place against the version the tab holds, or to a chosen .pptx', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pptx-ipc-')), file = path.join(root, 'deck.pptx');
  try {
    const pptx = await deck();
    await copyFile(path.join(fixtures, 'deck.pptx'), file);
    const original = await readFile(file);
    const snapshot = async (target = file): Promise<DocumentSnapshot> => ({ kind: 'office', path: target, name: path.basename(target), text: '', savedText: '',
      revision: 0, savedRevision: 0, isUntitled: false, diskVersion: (await packageVersion(target))! });
    const state = { window: { isDestroyed: () => false }, currentDocument: await snapshot(), activeRoot: null,
      rendererTabs: [{ name: 'deck.pptx', path: file, dirty: true, isUntitled: false }] } as unknown as WindowState;
    const documents = { watch: vi.fn(), writeWatchedFile: vi.fn((_state: WindowState, _file: string, write: () => Promise<DocumentSnapshot['diskVersion']>) => write()) };
    const request = async (overrides: Partial<DocxSaveRequest> = {}): Promise<DocxSaveRequest> =>
      ({ document: await snapshot(), bytes: new Uint8Array(pptx), revision: 2, saveAs: false, ...overrides });

    const opened = await openPptx(state, file, (await packageVersion(file))!);
    expect(Buffer.from(opened.bytes)).toEqual(original);
    expect(opened.presentation).toBe(true);
    // A Word document under a .pptx name is handed over with the verdict that it is not a presentation.
    const renamed = path.join(root, 'renamed.pptx'); await copyFile(path.join(fixtures, 'report.docx'), renamed);
    state.rendererTabs.push({ name: 'renamed.pptx', path: renamed, dirty: false, isUntitled: false });
    expect((await openPptx(state, renamed, (await packageVersion(renamed))!)).presentation).toBe(false);
    state.rendererTabs.pop(); await rm(renamed);
    // Each editor's channel answers for its own extension only.
    await expect(openDocx(state, file, (await packageVersion(file))!)).rejects.toThrow('not open in this window');
    await expect(saveDocx(state, documents, await request())).rejects.toThrow('Invalid document save request');
    await expect(openPptx(state, path.join(root, 'deck.ppsx'), (await packageVersion(file))!)).rejects.toThrow('not open in this window');

    await expect(savePptx(state, documents, await request({ bytes: await report() }))).rejects.toThrow('without a presentation part');
    await expect(savePptx(state, documents, await request({ bytes: Buffer.from('plain text') }))).rejects.toThrow('not a PowerPoint presentation');
    expect(await readFile(file)).toEqual(original);
    expect(documents.writeWatchedFile).not.toHaveBeenCalled();

    const stale = await request();
    await writeFile(file, Buffer.concat([original, Buffer.alloc(1)]));
    await expect(savePptx(state, documents, stale)).rejects.toThrow('changed on disk');
    expect((await readFile(file)).length).toBe(original.length + 1);

    const saved = await savePptx(state, documents, await request());
    expect(saved.document).toMatchObject({ path: file, name: 'deck.pptx', kind: 'office', revision: 2, savedRevision: 2, isUntitled: false });
    expect(await readFile(file)).toEqual(pptx);

    picker.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'copy') });
    const copy = await savePptx(state, documents, await request({ saveAs: true, revision: 3 }));
    expect(picker.showSaveDialog.mock.lastCall![1]).toMatchObject({ title: 'Save presentation as', filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }] });
    expect(copy.document).toMatchObject({ path: path.join(root, 'copy.pptx'), name: 'copy.pptx', savedRevision: 3 });
    picker.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'copy.docx') });
    state.currentDocument = await snapshot();
    await expect(savePptx(state, documents, await request({ saveAs: true }))).rejects.toThrow('.pptx extension');
    expect((await readdir(root)).sort()).toEqual(['copy.pptx', 'deck.pptx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
