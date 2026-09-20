import { app, clipboard, dialog } from 'electron';
import { promises as fs, watchFile, unwatchFile } from 'node:fs';
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
import { isMarkdownDocument, MARKDOWN_EXTENSIONS } from '../../core/document/document-profile';
import { prepareDocumentSave, retainUnsavedRevision } from '../../core/document/document-save';
import { readTextFile } from './text-file';
import { discardDraftBundle, saveDraftBundle } from './draft-assets';
import { isSupportedImagePath, savePastedImageFile, savePastedPng } from './pasted-image';
import { markdownDestinationForFile } from './markdown-link';
import { atomicWrite, canonicalPath, diskVersion, sameDiskVersion } from './file-system';
import type { WindowState } from '../windows/window-state';

const MARKDOWN_FILTER = { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS };
const ALL_FILES_FILTER = { name: 'All files', extensions: ['*'] };
const saveFilters = (filePath: string) => isMarkdownDocument(filePath)
  ? [MARKDOWN_FILTER, ALL_FILES_FILTER] : [ALL_FILES_FILTER];

export class DocumentManager {
  private untitledSequence = 0;

  constructor(private readonly resetPreviewCache: () => void) {}

  async read(filePath: string): Promise<DocumentSnapshot> {
    const absolute = canonicalPath(filePath);
    // Preserve Markdown's existing unbounded read policy. New text formats use
    // the bounded, strict decoder and retain their BOM/EOL metadata.
    const loaded = isMarkdownDocument(absolute)
      ? { text: await fs.readFile(absolute, 'utf8'), diskVersion: diskVersion(absolute) }
      : await readTextFile(absolute);
    return {
      ...loaded,
      path: absolute,
      name: path.basename(absolute),
      savedText: loaded.text,
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
    if (state.watchedPath) unwatchFile(state.watchedPath);
    state.watchedPath = null;
  }

  watch(state: WindowState) {
    this.stopWatching(state);
    const document = state.currentDocument;
    if (!document || document.isUntitled) return;
    state.watchedPath = document.path;
    const watchedPath = document.path;
    watchFile(watchedPath, { interval: 750 }, (current) => {
      const watchedDocument = state.currentDocument;
      if (!watchedDocument || watchedDocument.path !== watchedPath) return;
      const next = { mtimeMs: current.mtimeMs, size: current.size };
      if (current.nlink > 0 && !sameDiskVersion(next, watchedDocument.diskVersion)) {
        state.window.webContents.send('document:external-change', { path: watchedDocument.path, diskVersion: next });
      }
    });
  }

  async open(state: WindowState, filePath: string, notify = true) {
    const opened = await this.read(filePath); // Failure leaves the current document intact.
    state.currentDocument = opened;
    state.activeRoot = path.dirname(opened.path);
    if (isMarkdownDocument(opened.path)) this.resetPreviewCache();
    this.watch(state);
    if (notify) state.window.webContents.send('document:opened', opened);
    return opened;
  }

  newDocument(state: WindowState) {
    this.stopWatching(state);
    this.resetPreviewCache();
    state.currentDocument = this.blank();
    state.activeRoot = path.dirname(state.currentDocument.path);
    return state.currentDocument;
  }

  async chooseAndOpen(state: WindowState, notify = true) {
    const result = await dialog.showOpenDialog(state.window, {
      properties: ['openFile'], filters: [MARKDOWN_FILTER, ALL_FILES_FILTER],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.open(state, result.filePaths[0], notify);
  }

  activate(state: WindowState, document: DocumentSnapshot, text: string, revision: number) {
    this.stopWatching(state);
    state.currentDocument = applyTextRevision(document, text, revision);
    state.activeRoot = path.dirname(state.currentDocument.path);
    this.watch(state);
    if (!state.currentDocument.isUntitled) {
      try {
        const actual = diskVersion(state.currentDocument.path);
        if (!sameDiskVersion(actual, state.currentDocument.diskVersion)) {
          state.window.webContents.send('document:external-change', { path: state.currentDocument.path, diskVersion: actual });
        }
      } catch { /* The next save/reload reports inaccessible files. */ }
    }
    return state.currentDocument;
  }

  updateText(state: WindowState, text: string, revision: number) {
    if (state.currentDocument) state.currentDocument = applyTextRevision(state.currentDocument, text, revision);
  }

  private async confirmOverwrite(state: WindowState, document: DocumentSnapshot) {
    try { if (sameDiskVersion(diskVersion(document.path), document.diskVersion)) return true; }
    catch { return true; }
    const { response } = await dialog.showMessageBox(state.window, {
      type: 'warning', message: 'This file was changed by another application.',
      detail: 'Do you want to overwrite it with your current changes?',
      buttons: ['Cancel', 'Overwrite'], defaultId: 0, cancelId: 0,
    });
    return response === 1;
  }

  async saveSnapshot(state: WindowState, document: DocumentSnapshot, text: string, revision: number): Promise<SaveResult> {
    const updated = applyTextRevision(document, text, revision);
    if (updated.isUntitled) {
      const selected = await dialog.showSaveDialog(state.window, {
        defaultPath: path.join(app.getPath('documents'), updated.name), filters: saveFilters(updated.path),
      });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      const output = prepareDocumentSave(updated, text, selected.filePath);
      let savedText = output.text;
      if (isMarkdownDocument(selected.filePath)) {
        const saved = await saveDraftBundle(path.join(app.getPath('userData'), 'drafts'),
          updated.path, selected.filePath, output.bytes);
        savedText = saved.text;
      } else {
        await atomicWrite(selected.filePath, output.bytes);
      }
      const absolute = canonicalPath(selected.filePath);
      return { canceled: false, document: { ...updated,
        path: absolute, name: path.basename(absolute), text: savedText, savedText,
        encoding: output.encoding, eol: output.eol,
        revision, savedRevision: revision, diskVersion: diskVersion(absolute), isUntitled: false } };
    }
    const output = prepareDocumentSave(updated, text, updated.path);
    if (!(await this.confirmOverwrite(state, updated))) return { canceled: true };
    await fs.mkdir(path.dirname(updated.path), { recursive: true });
    await atomicWrite(updated.path, output.bytes);
    const absolute = canonicalPath(updated.path);
    return { canceled: false, document: { ...updated,
      path: absolute, name: path.basename(absolute), text: output.text, savedText: output.text,
      encoding: output.encoding, eol: output.eol,
      revision, savedRevision: revision, diskVersion: diskVersion(absolute), isUntitled: false } };
  }

  private acceptSaved(state: WindowState, result: SaveResult, expectedPath: string) {
    const current = state.currentDocument;
    if (!result.canceled && result.document && current?.path === expectedPath) {
      state.currentDocument = retainUnsavedRevision(result.document, current.text, current.revision);
      state.activeRoot = path.dirname(result.document.path);
      this.watch(state);
    }
    return result;
  }

  async saveCurrent(state: WindowState, text: string, revision: number) {
    const document = state.currentDocument;
    if (!document) return { canceled: true } as SaveResult;
    return this.acceptSaved(state, await this.saveSnapshot(state, document, text, revision), document.path);
  }

  async saveAs(state: WindowState, text: string, revision: number): Promise<SaveResult> {
    const document = state.currentDocument;
    if (!document) return { canceled: true };
    if (document.isUntitled) return this.saveCurrent(state, text, revision);
    const selected = await dialog.showSaveDialog(state.window, {
      defaultPath: document.path, filters: saveFilters(document.path),
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const output = prepareDocumentSave(document, text, selected.filePath);
    await atomicWrite(selected.filePath, output.bytes);
    const absolute = canonicalPath(selected.filePath);
    if (isMarkdownDocument(absolute)) this.resetPreviewCache();
    return this.acceptSaved(state, { canceled: false, document: { ...document,
      path: absolute, name: path.basename(absolute), text: output.text, savedText: output.text,
      encoding: output.encoding, eol: output.eol,
      revision, savedRevision: revision, diskVersion: diskVersion(absolute), isUntitled: false } }, document.path);
  }

  async pasteImage(state: WindowState): Promise<PasteImageResult> {
    const document = state.currentDocument;
    if (!document || !isMarkdownDocument(document.path)) return { canceled: true };
    const clipboardFiles = clipboard.availableFormats()
      .filter((format) => /uri-list|gnome-copied-files/i.test(format))
      .flatMap((format) => {
        try { return clipboard.readBuffer(format).toString('utf8').replace(/\0/g, '').split(/\r?\n/); }
        catch { return []; }
      });
    const plainText = clipboard.readText().trim();
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
    const image = clipboard.readImage();
    if (image.isEmpty()) return { canceled: true };
    const saved = await savePastedPng(document.path, image.toPNG());
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
    return this.open(state, document.path, false);
  }

  async discard(document: DocumentSnapshot) {
    if (document.isUntitled) await this.discardDraft(document.path);
  }

  discardDraft(documentPath: string) {
    return discardDraftBundle(path.join(app.getPath('userData'), 'drafts'), documentPath);
  }
}
