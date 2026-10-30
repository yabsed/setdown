import { app, clipboard, dialog } from 'electron';
import { promises as fs, statSync as requireStat, watchFile, unwatchFile, watch, type FSWatcher, type Stats } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  DocumentSnapshot,
  PasteImageResult,
  PickLinkTargetResult,
  SaveResult,
} from '../../protocol/desktop-api';
import { applyTextRevision } from '../../core/document/document-state';
import { isMarkdownDocument, isPdfDocument, isImageDocument, isVideoDocument, isReadOnlyDocument, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MARKDOWN_EXTENSIONS } from '../../core/document/document-profile';
import { prepareDocumentSave, retainUnsavedRevision } from '../../core/document/document-save';
import type { ReadingPositionStore } from '../reading/reading-position-store';
import { readImageMetadata } from './image-file';
import { readPdfMetadata } from './pdf-file';
import { readVideoMetadata } from './video-file';
import { readMarkdownFile, readTextFile } from './text-file';
import { discardDraftBundle, saveDraftBundle } from './draft-assets';
import { isSupportedImagePath, savePastedImageFile, savePastedPng } from './pasted-image';
import { markdownDestinationForFile } from './markdown-link';
import { atomicWrite, canonicalPath, canonicalSavePath, diskVersion, versionFromStat, sameDiskVersion, serializeFileSave } from './file-system';
import type { WindowState } from '../windows/window-state';

const MARKDOWN_FILTER = { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS };
const ALL_FILES_FILTER = { name: 'All files', extensions: ['*'] };
const saveFilters = (filePath: string) => isMarkdownDocument(filePath)
  ? [MARKDOWN_FILTER, ALL_FILES_FILTER] : [ALL_FILES_FILTER];

export class DocumentManager {
  private untitledSequence = 0;
  private readonly watchers = new WeakMap<WindowState, Map<string, {
    expected: DocumentSnapshot['diskVersion']; saving: boolean; listener(current: Stats): void; native?: FSWatcher;
  }>>();

  constructor(private readonly resetPreviewCache: () => void, readonly positions?: ReadingPositionStore) {}

  async read(filePath: string): Promise<DocumentSnapshot> {
    const absolute = canonicalPath(filePath);
    // Preserve Markdown's existing unbounded read policy. New text formats use
    // the bounded, strict decoder and retain their BOM/EOL metadata.
    const loaded = isVideoDocument(absolute) ? await readVideoMetadata(absolute) : isImageDocument(absolute) ? await readImageMetadata(absolute) : isPdfDocument(absolute) ? await readPdfMetadata(absolute) : isMarkdownDocument(absolute)
      ? await readMarkdownFile(absolute)
      : await readTextFile(absolute);
    return {
      ...loaded,
      path: absolute,
      name: path.basename(absolute),
      savedText: loaded.text,
      readingPosition: this.positions?.get(absolute, loaded.diskVersion),
      revision: 0,
      savedRevision: 0,
      isUntitled: false,
    };
  }

  private blank(): DocumentSnapshot {
    this.untitledSequence += 1;
    const name = this.untitledSequence === 1 ? 'Untitled.md' : `Untitled ${this.untitledSequence}.md`;
    return {
      path: path.join(app.getPath('userData'), 'drafts', randomUUID(), name),
      name, text: '', savedText: '', revision: 0, savedRevision: 0,
      diskVersion: { mtimeMs: 0, size: 0 }, isUntitled: true,
    };
  }

  stopWatching(state: WindowState) {
    for (const [file, entry] of this.watchers.get(state) ?? []) {
      unwatchFile(file, entry.listener); entry.native?.close();
    }
    this.watchers.delete(state);
    state.checkDocumentVersions = undefined;
    state.watchedPath = null;
  }

  watch(state: WindowState) {
    let entries = this.watchers.get(state);
    if (!entries) { entries = new Map(); this.watchers.set(state, entries); }
    const documents = new Map(state.rendererTabs.filter(tab => !tab.isUntitled && tab.diskVersion)
      .map(tab => [tab.path, tab.diskVersion!]));
    const current = state.currentDocument;
    if (!state.rendererTabsReady && current && !current.isUntitled && !documents.has(current.path)) documents.set(current.path, current.diskVersion);
    state.watchedPath = current?.isUntitled ? null : current?.path ?? null;
    state.disposeDocumentWatchers = () => this.stopWatching(state);
    state.checkDocumentVersions = () => {
      for (const [file, entry] of entries!) {
        try { entry.listener(requireStat(file)); } catch { entry.listener({ nlink: 0, mtimeMs: 0, size: 0 } as Stats); }
      }
    };
    for (const [file, entry] of entries) if (!documents.has(file)) {
      unwatchFile(file, entry.listener); entry.native?.close(); entries.delete(file);
    }
    for (const [file, expected] of documents) {
      const existing = entries.get(file);
      if (existing) { existing.expected = expected; continue; }
      let observed = expected, unavailable = false;
      const entry = { expected, saving: false, listener: (stat: Stats) => {
        if (this.watchers.get(state)?.get(file) !== entry || entry.saving) return;
        const next = versionFromStat(stat), missing = stat.nlink === 0;
        if (missing === unavailable && sameDiskVersion(next, observed)) return;
        observed = next; unavailable = missing;
        if (missing || !sameDiskVersion(next, entry.expected))
          state.window.webContents.send('document:external-change', { path: file, diskVersion: next, unavailable: missing });
      }, native: undefined as FSWatcher | undefined };
      const check = () => {
        try { entry.listener(requireStat(file)); } catch { entry.listener({ nlink: 0, mtimeMs: 0, size: 0 } as Stats); }
      };
      // Parent directory watches survive editor saves that replace the inode.
      try {
        entry.native = watch(path.dirname(file), { persistent: false }, (_event, name) => {
          if (!name || String(name) === path.basename(file)) check();
        });
        entry.native.on('error', () => { entry.native?.close(); entry.native = undefined; });
      } catch { /* Polling below also covers unavailable/network watchers. */ }
      watchFile(file, { interval: 2000, persistent: false }, entry.listener);
      entries.set(file, entry);
      check();
    }
  }

  async open(state: WindowState, filePath: string, notify = true) {
    const opened = await this.read(filePath); // Failure leaves the current document intact.
    state.currentDocument = opened;
    state.activeRoot = path.dirname(opened.path);
    state.documentDirectory = path.dirname(opened.path);
    if (isMarkdownDocument(opened.path)) this.resetPreviewCache();
    this.watch(state);
    if (notify) state.window.webContents.send('document:opened', opened);
    return opened;
  }

  newDocument(state: WindowState) {
    if (state.currentDocument && !state.currentDocument.isUntitled)
      state.documentDirectory = path.dirname(state.currentDocument.path);
    else if (state.projectRoot) state.documentDirectory = state.projectRoot;
    this.resetPreviewCache();
    state.currentDocument = this.blank();
    state.activeRoot = path.dirname(state.currentDocument.path);
    return state.currentDocument;
  }

  async chooseAndOpen(state: WindowState, notify = true) {
    const result = await dialog.showOpenDialog(state.window, {
      properties: ['openFile'], filters: [{ name: 'Documents', extensions: [...MARKDOWN_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, 'pdf', 'txt', 'ipynb'] }, MARKDOWN_FILTER, { name: 'PDF', extensions: ['pdf'] }, { name: 'Images', extensions: IMAGE_EXTENSIONS }, { name: 'Videos', extensions: VIDEO_EXTENSIONS }, ALL_FILES_FILTER],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.open(state, result.filePaths[0], notify);
  }

  activate(state: WindowState, document: DocumentSnapshot, text: string, revision: number) {
    state.currentDocument = applyTextRevision(document, text, revision);
    state.activeRoot = path.dirname(state.currentDocument.path);
    this.watch(state);
    if (!state.currentDocument.isUntitled) state.documentDirectory = state.activeRoot;
    if (!state.currentDocument.isUntitled) {
      try {
        const actual = diskVersion(state.currentDocument.path);
        if (!sameDiskVersion(actual, state.currentDocument.diskVersion)) {
          state.window.webContents.send('document:external-change', { path: state.currentDocument.path, diskVersion: actual });
        }
      } catch {
        state.window.webContents.send('document:external-change', { path: state.currentDocument.path,
          diskVersion: { mtimeMs: 0, size: 0 }, unavailable: true });
      }
    }
    return state.currentDocument;
  }

  updateText(state: WindowState, text: string, revision: number) {
    if (state.currentDocument) state.currentDocument = applyTextRevision(state.currentDocument, text, revision);
  }

  private unchangedOnDisk(document: DocumentSnapshot): boolean {
    try { return sameDiskVersion(diskVersion(document.path), document.diskVersion); }
    catch { return false; }
  }

  private async confirmOverwrite(state: WindowState, document: DocumentSnapshot) {
    if (this.unchangedOnDisk(document)) return document.diskVersion;
    const { response } = await dialog.showMessageBox(state.window, {
      type: 'warning', message: 'This file was changed by another application.',
      detail: 'Do you want to overwrite it with your current changes?',
      buttons: ['Cancel', 'Overwrite'], defaultId: 0, cancelId: 0,
    });
    if (response !== 1) return false;
    try { return diskVersion(document.path); } catch { return null; }
  }

  async saveSnapshot(state: WindowState, document: DocumentSnapshot, text: string, revision: number, auto = false): Promise<SaveResult> {
    return serializeFileSave(document.path, () => this.writeSnapshot(state, document, text, revision, auto));
  }

  private async writeWatchedFile(state: WindowState, file: string, write: () => Promise<DocumentSnapshot['diskVersion']>) {
    const entry = this.watchers.get(state)?.get(file);
    if (!entry) return write();
    // Atomic rename can notify fs.watch before the save promise/renderer settles.
    // Hold only this window's observation until we know the exact version written.
    entry.saving = true;
    try {
      const version = await write();
      entry.expected = version;
      return version;
    } finally {
      entry.saving = false;
      // Re-stat even on failure: a concurrent external replacement/deletion must
      // still be reported, and other windows' watchers were never suspended.
      try { entry.listener(requireStat(file)); }
      catch { entry.listener({ nlink: 0, mtimeMs: 0, size: 0 } as Stats); }
    }
  }

  private async writeSnapshot(state: WindowState, document: DocumentSnapshot, text: string, revision: number, auto: boolean): Promise<SaveResult> {
    if (document.kind !== undefined || isReadOnlyDocument(document.path)) throw new Error('PDF and image documents are read-only.');
    const updated = applyTextRevision(document, text, revision);
    if (updated.isUntitled) {
      // Auto save never opens a dialog; untitled drafts stay in the drafts folder.
      if (auto) return { canceled: true };
      const selected = await dialog.showSaveDialog(state.window, {
        defaultPath: path.join(state.documentDirectory ?? state.projectRoot ?? app.getPath('documents'), updated.name),
        filters: saveFilters(updated.path),
      });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      const absolute = canonicalSavePath(selected.filePath);
      if (state.rendererTabs.some(tab => tab.path === absolute && tab.path !== updated.path))
        throw Error('This destination is already open. Close that document before saving another document over it.');
      // A draft bundle is removed after publication; never publish into itself.
      if (path.dirname(absolute) === path.dirname(updated.path)) throw new Error('Choose a destination outside this temporary draft folder.');
      return serializeFileSave(absolute, async () => {
        const output = prepareDocumentSave(updated, text, absolute);
        let savedText = output.text;
        let assetRelocation: DocumentSnapshot['assetRelocation'];
        let version: DocumentSnapshot['diskVersion'];
        if (isMarkdownDocument(absolute)) {
          const saved = await saveDraftBundle(path.join(app.getPath('userData'), 'drafts'),
            updated.path, absolute, output.bytes);
          savedText = saved.text;
          assetRelocation = saved.assetRelocation;
          version = saved.diskVersion;
        } else {
          version = await atomicWrite(absolute, output.bytes);
        }
        return { canceled: false, document: { ...updated,
          path: absolute, name: path.basename(absolute), text: savedText, savedText,
          encoding: output.encoding, eol: output.eol, assetRelocation,
          revision, savedRevision: revision, diskVersion: version, isUntitled: false } };
      });
    }
    const output = prepareDocumentSave(updated, text, updated.path);
    // Auto save silently skips an externally changed file; the external-change
    // banner already tells the user. Manual saves still ask before overwriting.
    const expected = auto ? this.unchangedOnDisk(updated) ? updated.diskVersion : false
      : await this.confirmOverwrite(state, updated);
    if (expected === false) return { canceled: true };
    await fs.mkdir(path.dirname(updated.path), { recursive: true });
    let conflict = false;
    let version: DocumentSnapshot['diskVersion'];
    try {
      version = await this.writeWatchedFile(state, updated.path, () => atomicWrite(updated.path, output.bytes, () => {
        let current: ReturnType<typeof diskVersion> | null = null;
        try { current = diskVersion(updated.path); } catch { /* Missing destination. */ }
        if (!!current !== !!expected || (current && expected && !sameDiskVersion(current, expected))) {
          conflict = true;
          throw new Error('The file changed while saving. Reload it or save a copy.');
        }
      }));
    } catch (error) { if (auto && conflict) return { canceled: true }; throw error; }
    const absolute = canonicalPath(updated.path);
    return { canceled: false, document: { ...updated,
      path: absolute, name: path.basename(absolute), text: output.text, savedText: output.text,
      encoding: output.encoding, eol: output.eol, assetRelocation: undefined,
      revision, savedRevision: revision, diskVersion: version, isUntitled: false } };
  }

  private acceptSaved(state: WindowState, result: SaveResult, expectedPath: string) {
    const current = state.currentDocument;
    if (!result.canceled && result.document && current?.path === expectedPath) {
      state.currentDocument = retainUnsavedRevision(result.document, current.text, current.revision);
      state.activeRoot = path.dirname(result.document.path);
      state.documentDirectory = state.activeRoot;
      this.watch(state);
    }
    return result;
  }

  async saveCurrent(state: WindowState, text: string, revision: number, auto = false) {
    const document = state.currentDocument;
    if (!document) return { canceled: true } as SaveResult;
    return this.acceptSaved(state, await this.saveSnapshot(state, document, text, revision, auto), document.path);
  }

  async saveAs(state: WindowState, text: string, revision: number): Promise<SaveResult> {
    const document = state.currentDocument;
    if (!document) return { canceled: true };
    if (document.kind !== undefined || isReadOnlyDocument(document.path)) return { canceled: true };
    if (document.isUntitled) return this.saveCurrent(state, text, revision);
    const selected = await dialog.showSaveDialog(state.window, {
      defaultPath: document.path, filters: saveFilters(document.path),
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const absolute = canonicalSavePath(selected.filePath);
    if (state.rendererTabs.some(tab => tab.path === absolute && tab.path !== document.path))
      throw Error('This destination is already open. Close that document before saving another document over it.');
    return serializeFileSave(absolute, async () => {
      const output = prepareDocumentSave(document, text, absolute);
      const version = await atomicWrite(absolute, output.bytes);
      if (isMarkdownDocument(absolute)) this.resetPreviewCache();
      return this.acceptSaved(state, { canceled: false, document: { ...document,
        path: absolute, name: path.basename(absolute), text: output.text, savedText: output.text,
        encoding: output.encoding, eol: output.eol, assetRelocation: undefined,
        revision, savedRevision: revision, diskVersion: version, isUntitled: false } }, document.path);
    });
  }

  async pasteImage(state: WindowState): Promise<PasteImageResult> {
    const document = state.currentDocument;
    if (!document || !isMarkdownDocument(document.path)) return { canceled: true };
    const items = await clipboard.read();
    const clipboardFiles: string[] = [];
    for (const item of items) for (const format of item.types.filter(format => /uri-list|gnome-copied-files/i.test(format))) {
      try {
        const data = await item.getType(format);
        if ('text' in data) clipboardFiles.push(...(await data.text()).replace(/\0/g, '').split(/\r?\n/));
      } catch { /* A platform may advertise a format it cannot convert. */ }
    }
    const plainText = (await clipboard.readText()).trim();
    if (plainText.startsWith('file://')) clipboardFiles.push(...plainText.split(/\r?\n/));
    const localPaths = [...new Set(clipboardFiles.map((entry) => entry.trim())
      .filter((entry) => entry && !['copy', 'cut'].includes(entry) && !entry.startsWith('#'))
      .flatMap((entry) => {
        try { const url = new URL(entry); return url.protocol === 'file:' ? [fileURLToPath(url)] : []; }
        catch { return []; }
      }).filter(isSupportedImagePath))];
    if (localPaths.length) {
      const saved = await Promise.all(localPaths.map((source) => savePastedImageFile(document.path, source)));
      return { canceled: false, markdown: saved.map((image) => image.markdown).join('\n\n'),
        relativePath: saved[0]?.markdownPath };
    }
    const image = items.find(item => item.types.includes('image/png'));
    if (!image) return { canceled: true };
    const data = await image.getType('image/png');
    const saved = await savePastedPng(document.path, Buffer.from(await data.arrayBuffer()));
    return { canceled: false, markdown: saved.markdown, relativePath: saved.markdownPath };
  }

  async pickLink(state: WindowState, documentPath: string): Promise<PickLinkTargetResult> {
    const document = state.currentDocument;
    if (!document || !isMarkdownDocument(document.path) || document.path !== documentPath || document.isUntitled) {
      return { canceled: true };
    }
    const result = await dialog.showOpenDialog(state.window, {
      defaultPath: path.dirname(document.path), properties: ['openFile'], filters: [ALL_FILES_FILTER],
    });
    const target = result.filePaths[0];
    if (result.canceled || !target) return { canceled: true };
    return { canceled: false, destination: markdownDestinationForFile(document.path, target), label: path.basename(target) };
  }

  async reload(state: WindowState) {
    const document = state.currentDocument;
    if (!document || document.isUntitled) return document;
    return this.read(document.path);
  }

  async discard(document: DocumentSnapshot) {
    if (document.isUntitled) await this.discardDraft(document.path);
  }

  discardDraft(documentPath: string) {
    return discardDraftBundle(path.join(app.getPath('userData'), 'drafts'), documentPath);
  }
}
