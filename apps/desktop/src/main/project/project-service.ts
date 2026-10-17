import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import type { GitRemoteAction, ProjectEntryKind, ProjectFolder, ProjectSearchRequest } from '../../protocol/desktop-api';
import { isOpenableDocument } from '../../core/document/document-profile';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { ExplorerService } from './explorer-service';
import { ExplorerClipboardStore } from './explorer-clipboard';
import type { ExplorerTransfer } from '../../protocol/explorer';
import { ProjectWatcher, type ProjectWatcherPort } from './engines/project-watcher';
import { GitService } from './git-service';
import { ProjectPaths } from './project-paths';
import { SearchService } from './search-service';
import type { VisibleSearchMatch } from './visible-search';
import { RecentFolders } from './recent-folders';
export { parseGitDiffHunks, parseGitStatus } from './git-service';
export { isMarkdownDocument } from './project-paths';

/** Thin project facade; text candidates are still validated by the byte loader. */
export class ProjectService {
  readonly clipboard = new ExplorerClipboardStore();
  transfer = (state: WindowState, request: ExplorerTransfer) => this.explorer.transfer(state, request);
  async copySelection(state: WindowState, candidates: string[], cut: boolean) {
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 10000) throw new Error('Select files or folders first.');
    const paths = [...new Set(candidates.map(candidate => this.paths.entry(state, candidate)))];
    for (const candidate of paths) {
      if (candidate === this.paths.root(state)) throw new Error('The open folder itself cannot be changed.');
      await fs.lstat(candidate);
    }
    return this.clipboard.write(paths, cut === true);
  }
  async paste(state: WindowState, target: string, conflict?: ExplorerTransfer['conflict']) {
    const selection = await this.clipboard.snapshot();
    if (!selection) throw new Error('Copy or cut files in Setdown first.');
    const result = await this.transfer(state, { kind: selection.cut ? 'move' : 'copy', paths: selection.paths, target, conflict });
    await this.clipboard.consume(selection, result);
    return result;
  }
  private readonly paths = new ProjectPaths();
  setLanguageFileOperations(handler: NonNullable<ExplorerService['languageOperation']>): void { this.explorer.languageOperation = handler; }
  private readonly explorer = new ExplorerService(this.paths, undefined, (state, paths) => {
    for (const other of this.windows()) {
      if (other.webContentsId === state.webContentsId) continue;
      const open = [...other.rendererTabs, ...(other.currentDocument ? [other.currentDocument] : [])];
      if (open.some(tab => paths.some(root => isInside(root, tab.path)))) {
        throw new Error('This selection is open in another Setdown window. Close those tabs before moving, renaming, or deleting it.');
      }
    }
  });
  private readonly git = new GitService(this.paths);
  private readonly searcher: SearchService;
  private readonly folderRequests = new WeakMap<WindowState, number>();
  constructor(searchVisible: (documentPath: string, text: string, query: string, limit: number, root: string) => Promise<VisibleSearchMatch[]>,
    private readonly watcher: ProjectWatcherPort = new ProjectWatcher(),
    private readonly windows: () => Iterable<WindowState> = () => [],
    readonly recentFolders = new RecentFolders()) {
    this.searcher = new SearchService(this.paths, searchVisible);
  }
  async choose(state: WindowState): Promise<ProjectFolder | null> {
    const request = this.beginFolderRequest(state);
    const selected = await dialog.showOpenDialog(state.window, { title: 'Open Folder', properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths[0] || this.folderRequests.get(state) !== request) return null;
    return this.openFolder(state, selected.filePaths[0], request);
  }
  current(state: WindowState): ProjectFolder | null { return state.projectRoot ? this.folder(state.projectRoot) : null; }
  async restore(state: WindowState, candidate: string): Promise<ProjectFolder | null> {
    return this.openFolder(state, candidate, this.beginFolderRequest(state));
  }
  async close(state: WindowState): Promise<void> {
    this.beginFolderRequest(state);
    state.projectRoot = null;
    state.explorerEditTarget = false;
    await this.watcher.unwatch(state.webContentsId);
  }
  private beginFolderRequest(state: WindowState): number {
    const request = (this.folderRequests.get(state) ?? 0) + 1;
    this.folderRequests.set(state, request);
    return request;
  }
  private async openFolder(state: WindowState, candidate: string, request: number): Promise<ProjectFolder | null> {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return null;
    const folderPath = canonicalPath(candidate);
    const stat = await fs.stat(folderPath).catch(() => null);
    if (!stat?.isDirectory() || this.folderRequests.get(state) !== request) return null;
    state.projectRoot = folderPath;
    this.recentFolders.visit(folderPath);
    this.watch(state, folderPath);
    return this.folder(folderPath);
  }
  dispose = (): Promise<void> => this.watcher.dispose();
  readDirectory = (state: WindowState, directoryPath: string) => this.explorer.readDirectory(state, directoryPath);
  createEntry = (state: WindowState, parentPath: string, name: string, kind: ProjectEntryKind) => this.explorer.create(state, parentPath, name, kind);
  renameEntry = (state: WindowState, entryPath: string, name: string) => this.explorer.rename(state, entryPath, name);
  moveEntry = (state: WindowState, entryPath: string, targetDirectory: string) => this.explorer.move(state, entryPath, targetDirectory);
  moveEntries = (state: WindowState, entryPaths: string[], targetDirectory: string) => this.explorer.moveMany(state, entryPaths, targetDirectory);
  trashEntry = (state: WindowState, entryPath: string) => this.explorer.trashEntry(state, entryPath);
  search = (state: WindowState, request: ProjectSearchRequest) => this.searcher.search(state, request);
  gitStatus = (state: WindowState) => this.git.status(state);
  gitDiff = (state: WindowState, filePath: string, staged: boolean) => this.git.diff(state, filePath, staged);
  initializeGit = (state: WindowState) => this.git.initialize(state);
  stageGit = (state: WindowState, paths: string[]) => this.git.stage(state, paths);
  unstageGit = (state: WindowState, paths: string[]) => this.git.unstage(state, paths);
  discardGit = (state: WindowState, paths: string[]) => this.git.discard(state, paths);
  commitGit = (state: WindowState, message: string) => this.git.commit(state, message);
  runGitRemote = (state: WindowState, action: GitRemoteAction) => this.git.remote(state, action);
  assertDocument(state: WindowState, candidate: string): string {
    const filePath = this.assertProjectFile(state, candidate);
    if (!isOpenableDocument(filePath)) throw new Error('This binary format cannot be edited as text.');
    return filePath;
  }
  assertProjectFile(state: WindowState, candidate: string): string { return this.paths.inside(state, candidate); }
  private folder(root: string): ProjectFolder { return { path: root, name: path.basename(root) || root }; }
  private watch(state: WindowState, root: string): void {
    // Subscribing walks every directory in the tree. Never make the first
    // (top-level) directory read wait for it; watch in the background.
    void this.watcher.watch(state, root).catch((error) => console.error('Could not watch the open folder:', error));
  }
}
