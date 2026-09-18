import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import type {
  GitRemoteAction,
  ProjectEntryKind,
  ProjectFolder,
  ProjectSearchRequest,
} from '../../protocol/desktop-api';
import { canonicalPath } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { ExplorerService } from './explorer-service';
import { ProjectWatcher, type ProjectWatcherPort } from './engines/project-watcher';
import { GitService } from './git-service';
import { isMarkdownDocument, ProjectPaths } from './project-paths';
import { SearchService } from './search-service';
import type { VisibleSearchMatch } from './visible-search';

export { parseGitDiffHunks, parseGitStatus } from './git-service';
export { isMarkdownDocument } from './project-paths';

/** Thin project facade. Files, search, and Git keep their own policies and dependencies. */
export class ProjectService {
  private readonly paths = new ProjectPaths();
  private readonly explorer = new ExplorerService(this.paths);
  private readonly git = new GitService(this.paths);
  private readonly searcher: SearchService;

  constructor(searchVisible: (
    documentPath: string,
    text: string,
    query: string,
    limit: number,
    root: string,
  ) => Promise<VisibleSearchMatch[]>, private readonly watcher: ProjectWatcherPort = new ProjectWatcher()) {
    this.searcher = new SearchService(this.paths, searchVisible);
  }

  async choose(state: WindowState): Promise<ProjectFolder | null> {
    const selected = await dialog.showOpenDialog(state.window, {
      title: 'Open Folder',
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    state.projectRoot = canonicalPath(selected.filePaths[0]);
    await this.watch(state, state.projectRoot);
    return this.folder(state.projectRoot);
  }

  current(state: WindowState): ProjectFolder | null {
    return state.projectRoot ? this.folder(state.projectRoot) : null;
  }

  async restore(state: WindowState, candidate: string): Promise<ProjectFolder | null> {
    const folderPath = canonicalPath(candidate);
    const stat = await fs.stat(folderPath).catch(() => null);
    if (!stat?.isDirectory()) return null;
    state.projectRoot = folderPath;
    await this.watch(state, folderPath);
    return this.folder(folderPath);
  }

  dispose = (): Promise<void> => this.watcher.dispose();

  readDirectory = (state: WindowState, directoryPath: string) =>
    this.explorer.readDirectory(state, directoryPath);

  createEntry = (state: WindowState, parentPath: string, name: string, kind: ProjectEntryKind) =>
    this.explorer.create(state, parentPath, name, kind);

  renameEntry = (state: WindowState, entryPath: string, name: string) =>
    this.explorer.rename(state, entryPath, name);

  moveEntry = (state: WindowState, entryPath: string, targetDirectory: string) =>
    this.explorer.move(state, entryPath, targetDirectory);

  trashEntry = (state: WindowState, entryPath: string) =>
    this.explorer.trashEntry(state, entryPath);

  search = (state: WindowState, request: ProjectSearchRequest) =>
    this.searcher.search(state, request);

  gitStatus = (state: WindowState) => this.git.status(state);
  gitDiff = (state: WindowState, filePath: string, staged: boolean) =>
    this.git.diff(state, filePath, staged);
  initializeGit = (state: WindowState) => this.git.initialize(state);
  stageGit = (state: WindowState, paths: string[]) => this.git.stage(state, paths);
  unstageGit = (state: WindowState, paths: string[]) => this.git.unstage(state, paths);
  discardGit = (state: WindowState, paths: string[]) => this.git.discard(state, paths);
  commitGit = (state: WindowState, message: string) => this.git.commit(state, message);
  runGitRemote = (state: WindowState, action: GitRemoteAction) => this.git.remote(state, action);

  assertDocument(state: WindowState, candidate: string): string {
    const filePath = this.assertProjectFile(state, candidate);
    if (!isMarkdownDocument(filePath)) throw new Error('Setdown opens Markdown documents only.');
    return filePath;
  }

  assertProjectFile(state: WindowState, candidate: string): string {
    return this.paths.inside(state, candidate);
  }

  private folder(root: string): ProjectFolder {
    return { path: root, name: path.basename(root) || root };
  }

  private async watch(state: WindowState, root: string): Promise<void> {
    await this.watcher.watch(state, root).catch((error) => {
      console.error('Could not watch the open folder:', error);
    });
  }
}
