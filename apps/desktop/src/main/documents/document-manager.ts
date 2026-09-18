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
} from '../../shared/contracts';
import { applyTextRevision } from '../../shared/document-state';
import { discardDraftBundle, saveDraftBundle } from './draft-assets';
import { isSupportedImagePath, savePastedImageFile, savePastedPng } from './pasted-image';
import { markdownDestinationForFile } from './markdown-link';
import { atomicWrite, canonicalPath, diskVersion, sameDiskVersion } from './file-system';
import type { WindowState } from '../windows/window-state';

const MARKDOWN_FILTER = {
  name: 'Markdown',
  extensions: ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'],
};

export class DocumentManager {
  private untitledSequence = 0;

  constructor(private readonly resetPreviewCache: () => void) {}

  async read(filePath: string): Promise<DocumentSnapshot> {
    const absolute = canonicalPath(filePath);
    const text = await fs.readFile(absolute, 'utf8');
    return {
      path: absolute,
      name: path.basename(absolute),
      text,
      savedText: text,
      revision: 0,
      savedRevision: 0,
      diskVersion: diskVersion(absolute),
      isUntitled: false,
    };
  }

  private blank(): DocumentSnapshot {
    this.untitledSequence += 1;
    const name = this.untitledSequence === 1
      ? 'Untitled.md'
      : `Untitled ${this.untitledSequence}.md`;
    return {
      path: path.join(app.getPath('userData'), 'drafts', randomUUID(), name),
      name,
      text: '',
      savedText: '',
      revision: 0,
      savedRevision: 0,
      diskVersion: { mtimeMs: 0, size: 0 },
      isUntitled: true,
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
        state.window.webContents.send('document:external-change', {
          path: watchedDocument.path,
          diskVersion: next,
        });
      }
    });
  }

  async open(state: WindowState, filePath: string, notify = true) {
    state.currentDocument = await this.read(filePath);
    state.activeRoot = path.dirname(state.currentDocument.path);
    this.resetPreviewCache();
    this.watch(state);
    if (notify) state.window.webContents.send('document:opened', state.currentDocument);
    return state.currentDocument;
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
      properties: ['openFile'],
      filters: [MARKDOWN_FILTER, { name: 'All files', extensions: ['*'] }],
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
          state.window.webContents.send('document:external-change', {
            path: state.currentDocument.path,
            diskVersion: actual,
          });
        }
      } catch {
        // 다음 저장 또는 새로고침에서 접근 오류를 처리한다.
      }
    }
    return state.currentDocument;
  }

  updateText(state: WindowState, text: string, revision: number) {
    if (state.currentDocument) {
      state.currentDocument = applyTextRevision(state.currentDocument, text, revision);
    }
  }

  private async confirmOverwrite(state: WindowState, document: DocumentSnapshot) {
    try {
      if (sameDiskVersion(diskVersion(document.path), document.diskVersion)) return true;
    } catch {
      return true;
    }
    const { response } = await dialog.showMessageBox(state.window, {
      type: 'warning',
      message: '파일이 다른 프로그램에서 변경되었습니다.',
      detail: '현재 편집 내용을 덮어쓰시겠습니까?',
      buttons: ['취소', '덮어쓰기'],
      defaultId: 0,
      cancelId: 0,
    });
    return response === 1;
  }

  async saveSnapshot(
    state: WindowState,
    document: DocumentSnapshot,
    text: string,
    revision: number,
  ): Promise<SaveResult> {
    const updated = applyTextRevision(document, text, revision);
    if (updated.isUntitled) {
      const selected = await dialog.showSaveDialog(state.window, {
        defaultPath: path.join(app.getPath('documents'), updated.name),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      const saved = await saveDraftBundle(
        path.join(app.getPath('userData'), 'drafts'),
        updated.path,
        selected.filePath,
        text,
      );
      const absolute = canonicalPath(selected.filePath);
      return {
        canceled: false,
        document: {
          path: absolute,
          name: path.basename(absolute),
          text: saved.text,
          savedText: saved.text,
          revision,
          savedRevision: revision,
          diskVersion: diskVersion(absolute),
          isUntitled: false,
        },
      };
    }
    if (!(await this.confirmOverwrite(state, updated))) return { canceled: true };
    await fs.mkdir(path.dirname(updated.path), { recursive: true });
    await atomicWrite(updated.path, text);
    const absolute = canonicalPath(updated.path);
    return {
      canceled: false,
      document: {
        path: absolute,
        name: path.basename(absolute),
        text,
        savedText: text,
        revision,
        savedRevision: revision,
        diskVersion: diskVersion(absolute),
        isUntitled: false,
      },
    };
  }

  private acceptSaved(state: WindowState, result: SaveResult) {
    if (!result.canceled && result.document) {
      state.currentDocument = result.document;
      state.activeRoot = path.dirname(result.document.path);
      this.watch(state);
    }
    return result;
  }

  async saveCurrent(state: WindowState, text: string, revision: number) {
    if (!state.currentDocument) return { canceled: true } as SaveResult;
    return this.acceptSaved(
      state,
      await this.saveSnapshot(state, state.currentDocument, text, revision),
    );
  }

  async saveAs(state: WindowState, text: string, revision: number): Promise<SaveResult> {
    if (!state.currentDocument) return { canceled: true };
    if (state.currentDocument.isUntitled) return this.saveCurrent(state, text, revision);
    const selected = await dialog.showSaveDialog(state.window, {
      defaultPath: state.currentDocument.path,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    this.resetPreviewCache();
    await atomicWrite(selected.filePath, text);
    const absolute = canonicalPath(selected.filePath);
    return this.acceptSaved(state, {
      canceled: false,
      document: {
        path: absolute,
        name: path.basename(absolute),
        text,
        savedText: text,
        revision,
        savedRevision: revision,
        diskVersion: diskVersion(absolute),
        isUntitled: false,
      },
    });
  }

  async pasteImage(state: WindowState): Promise<PasteImageResult> {
    const document = state.currentDocument;
    if (!document) return { canceled: true };
    const clipboardFiles = clipboard.availableFormats()
      .filter((format) => /uri-list|gnome-copied-files/i.test(format))
      .flatMap((format) => {
        try {
          return clipboard.readBuffer(format).toString('utf8').replace(/\0/g, '').split(/\r?\n/);
        } catch {
          return [];
        }
      });
    const plainText = clipboard.readText().trim();
    if (plainText.startsWith('file://')) clipboardFiles.push(...plainText.split(/\r?\n/));
    const localPaths = [...new Set(clipboardFiles
      .map((entry) => entry.trim())
      .filter((entry) => entry && !['copy', 'cut'].includes(entry) && !entry.startsWith('#'))
      .flatMap((entry) => {
        try {
          const url = new URL(entry);
          return url.protocol === 'file:' ? [fileURLToPath(url)] : [];
        } catch {
          return [];
        }
      })
      .filter(isSupportedImagePath))];
    if (localPaths.length) {
      const saved = await Promise.all(localPaths.map((source) =>
        savePastedImageFile(document.path, source),
      ));
      return {
        canceled: false,
        markdown: saved.map((image) => image.markdown).join('\n\n'),
        relativePath: saved[0]?.markdownPath,
      };
    }
    const image = clipboard.readImage();
    if (image.isEmpty()) return { canceled: true };
    const saved = await savePastedPng(document.path, image.toPNG());
    return { canceled: false, markdown: saved.markdown, relativePath: saved.markdownPath };
  }

  async pickLink(state: WindowState, documentPath: string): Promise<PickLinkTargetResult> {
    const document = state.currentDocument;
    if (!document || document.path !== documentPath || document.isUntitled) {
      return { canceled: true };
    }
    const result = await dialog.showOpenDialog(state.window, {
      defaultPath: path.dirname(document.path),
      properties: ['openFile'],
      filters: [{ name: 'All files', extensions: ['*'] }],
    });
    const target = result.filePaths[0];
    if (result.canceled || !target) return { canceled: true };
    return {
      canceled: false,
      destination: markdownDestinationForFile(document.path, target),
      label: path.basename(target),
    };
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
