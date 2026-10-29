import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WindowState } from '../windows/window-state';
import {
  isMarkdownDocument,
  parseGitStatus,
  ProjectService,
} from './project-service';
import { indexVisibleHtml, searchVisibleText } from './visible-search';

const temporaryDirectories: string[] = [];
const noWatcher = { watch: async () => undefined, unwatch: async () => undefined, dispose: async () => undefined };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('project service', () => {
  test('None stops watching without closing documents, and supersedes an in-flight folder open', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-close-'));
    temporaryDirectories.push(root);
    const watcher = { ...noWatcher, unwatch: vi.fn(async () => undefined) };
    const service = new ProjectService(async () => [], watcher);
    const state = { webContentsId: 3, projectRoot: null, currentDocument: { path: 'keep.txt', text: 'unsaved' } } as unknown as WindowState;
    await service.restore(state, root);
    expect(service.recentFolders.list().map(folder => folder.path)).toEqual([root]);
    const pending = service.restore(state, root);
    await service.close(state);
    expect(await pending).toBeNull();
    expect(service.current(state)).toBeNull();
    expect(state.currentDocument).toEqual({ path: 'keep.txt', text: 'unsaved' });
    expect(watcher.unwatch).toHaveBeenCalledWith(3);
    expect(service.recentFolders.list()).toHaveLength(1);
    await expect(service.readDirectory(state, root)).rejects.toThrow('No folder is open');
  });

  test('unavailable folders leave the current workspace and history intact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-missing-'));
    temporaryDirectories.push(root);
    const service = new ProjectService(async () => [], noWatcher);
    const state = { projectRoot: null } as WindowState;
    await service.restore(state, root);
    expect(await service.restore(state, path.join(root, 'missing'))).toBeNull();
    expect(state.projectRoot).toBe(root);
    expect(service.recentFolders.list().map(folder => folder.path)).toEqual([root]);
  });
  test('a file open in another window cannot be moved or trashed underneath its editor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-shared-'));
    temporaryDirectories.push(root);
    const file = path.join(root, 'shared.txt'); await writeFile(file, 'keep');
    const other = { webContentsId: 2, rendererTabs: [{ path: file }], currentDocument: null } as WindowState;
    const service = new ProjectService(async () => [], noWatcher, () => [other]);
    const state = { projectRoot: root, webContentsId: 1 } as WindowState;
    await expect(service.renameEntry(state, file, 'renamed.txt')).rejects.toThrow('another Setdown window');
    await expect(service.trashEntry(state, file)).rejects.toThrow('another Setdown window');
    expect((await service.transfer(state, { kind: 'duplicate', paths: [file] })).items[0].status).toBe('completed');
  });
  test('opening a folder does not wait for the recursive watcher subscription', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-watch-slow-'));
    temporaryDirectories.push(root);
    let watchStarted = false;
    const slowWatcher = {
      watch: () => { watchStarted = true; return new Promise<void>(() => {}); },
      unwatch: async () => undefined,
      dispose: async () => undefined,
    };
    const service = new ProjectService(async () => [], slowWatcher);
    const state = { projectRoot: null } as WindowState;
    const folder = await Promise.race([
      service.restore(state, root),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    expect(folder).toEqual({ path: root, name: path.basename(root) });
    expect(watchStarted).toBe(true);
  });

  test('classifies the document formats Setdown can open', () => {
    expect(isMarkdownDocument('notes.md')).toBe(true);
    expect(isMarkdownDocument('paper.QMD')).toBe(true);
    expect(isMarkdownDocument('image.png')).toBe(false);
  });

  test('turns porcelain status into compact source-control rows', () => {
    const output = [
      '1 .M N... 100644 100644 100644 a a notes.md',
      '1 A. N... 000000 100644 100644 a b staged.md',
      '? new file.md',
      '',
    ].join('\0');
    expect(parseGitStatus(output).changes).toEqual([
      { path: 'notes.md', filePath: '', status: 'M', indexStatus: ' ',
        workingTreeStatus: 'M', staged: false, unstaged: true, conflict: false },
      { path: 'staged.md', filePath: '', status: 'A', indexStatus: 'A',
        workingTreeStatus: ' ', staged: true, unstaged: false, conflict: false },
      { path: 'new file.md', filePath: '', status: 'U', indexStatus: '?',
        workingTreeStatus: '?', staged: false, unstaged: true, conflict: false },
    ]);
  });

  test('loads folders lazily and searches Markdown documents only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-project-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'chapter'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'notes.md'), '# Needle\n', 'utf8');
    await writeFile(path.join(root, 'image.png'), 'needle', 'utf8');
    await writeFile(path.join(root, 'chapter', 'more.md'), 'A needle then needle here.\n', 'utf8');
    await writeFile(path.join(root, 'node_modules', 'hidden.md'), 'needle', 'utf8');
    const state = { projectRoot: root } as WindowState;
    const service = new ProjectService(async (_path, text, query, limit) =>
      searchVisibleText(indexVisibleHtml(text), query, limit), noWatcher);

    const reloaded = { projectRoot: null } as WindowState;
    expect(await service.restore(reloaded, root)).toEqual({ path: root, name: path.basename(root) });
    expect(reloaded.projectRoot).toBe(root);

    expect(await service.readDirectory(state, root)).toEqual([
      { path: path.join(root, 'chapter'), name: 'chapter', kind: 'directory' },
      { path: path.join(root, 'node_modules'), name: 'node_modules', kind: 'directory' },
      { path: path.join(root, 'image.png'), name: 'image.png', kind: 'document' },
      { path: path.join(root, 'notes.md'), name: 'notes.md', kind: 'document' },
    ]);
    await writeFile(path.join(root, '.hidden.md'), 'hidden needle\n', 'utf8');
    await writeFile(path.join(root, '.ignore'), 'ignored.md\n', 'utf8');
    await writeFile(path.join(root, 'ignored.md'), 'needle\n', 'utf8');
    const { results } = await service.search(state, { query: 'needle', documents: [] });
    expect(results.map(({ relativePath, line, column, lineOccurrence, ordinal }) => ({
      relativePath, line, column, lineOccurrence, ordinal,
    }))).toEqual([
      { relativePath: '.hidden.md', line: 1, column: 8, lineOccurrence: 0, ordinal: 0 },
      { relativePath: path.join('chapter', 'more.md'), line: 1, column: 3,
        lineOccurrence: 0, ordinal: 0 },
      { relativePath: path.join('chapter', 'more.md'), line: 1, column: 15,
        lineOccurrence: 0, ordinal: 1 },
      { relativePath: 'notes.md', line: 1, column: 3, lineOccurrence: 0, ordinal: 0 },
    ]);
    expect(results.every((result) => /needle/i.test(result.preview))).toBe(true);
  });

  test('uses Monaco-supplied matches only for documents open in the editor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-project-'));
    temporaryDirectories.push(root);
    const filePath = path.join(root, 'notes.md');
    await writeFile(filePath, '**visible**\n', 'utf8');
    const state = { projectRoot: root } as WindowState;
    const viewerQueries: string[] = [];
    const service = new ProjectService(async (_path, _text, query) => {
      viewerQueries.push(query);
      return [];
    }, noWatcher);

    expect((await service.search(state, { query: '**', documents: [] })).results).toEqual([]);
    expect(viewerQueries).toEqual(['**']);
    const editorResults = await service.search(state, {
      query: '**',
      documents: [{
        path: filePath,
        text: '**changed**',
        surface: 'editor',
        matches: [
          { line: 1, column: 1, lineOccurrence: 0, ordinal: 0, preview: '**changed**' },
          { line: 1, column: 10, lineOccurrence: 1, ordinal: 1, preview: '**changed**' },
        ],
      }],
    });
    expect(editorResults.results).toMatchObject([
      { path: filePath, surface: 'editor', line: 1, column: 1 },
      { path: filePath, surface: 'editor', line: 1, column: 10 },
    ]);
  });
});
