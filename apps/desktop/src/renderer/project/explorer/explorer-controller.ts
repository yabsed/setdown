import type {
  ProjectEntry,
  ProjectEntryKind,
  ProjectFolder,
} from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import type { EditorOpenOptions } from '../../../core/workspace/editor-groups';
import { project, rememberProjectState, type VisibleProjectEntry } from '../project-state.svelte';
import { tree, selectPaths, remapTree } from './explorer-tree-state.svelte';
import type { ExplorerOperationResult, ExplorerTransfer } from '../../../protocol/explorer';

type Options = {
  desktop: DesktopPort;
  showDocument(path: string, options?: EditorOpenOptions): Promise<boolean>;
  pathMoved(from: string, to: string): Promise<void>;
  prepareRemove(path: string): Promise<boolean>;
  commitRemove(path: string): Promise<void>;
  runMutation<T>(operation: () => Promise<T>): Promise<T>;
};

const parentPath = (candidate: string) => candidate.replace(/[\\/][^\\/]+$/, '');
const under = (candidate: string, root: string) => candidate === root
  || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);

export class ExplorerController {
  private readonly children = new Map<string, ProjectEntry[]>();
  private readonly expanded = new Set<string>();
  private generation = 0;
  private mutating = false;
  private refreshPending = false;
  private requests = new Map<string, number>();

  constructor(private readonly options: Options) {
    for (const path of project.expanded) this.expanded.add(path);
  }

  reset = async (folder: ProjectFolder): Promise<void> => {
    this.clear();
    tree.root = folder.path;
    await this.load(folder.path);
  };

  clear = (): void => {
    this.generation++;
    this.requests.clear();
    this.children.clear();
    this.expanded.clear();
    tree.root = ''; tree.scroll = 0; tree.filter = ''; selectPaths([]);
    this.refreshPending = false;
    project.entries = []; project.expanded = [];
  };

  restore = async (folder: ProjectFolder): Promise<void> => {
    if (tree.root !== folder.path) { tree.root = folder.path; tree.scroll = 0; selectPaths([]); }
    await this.reload(folder);
  };

  refresh = async (changed?: string[]): Promise<void> => {
    if (!project.folder) return;
    if (this.mutating) { this.refreshPending = true; return; }
    if (!changed) return this.reload(project.folder);
    const directories = new Set(changed.map(parentPath));
    await this.reloadDirectories([...directories].filter(directory => this.children.has(directory)));
  };

  reveal = async (candidate: string): Promise<void> => {
    const root = project.folder?.path;
    if (!root || !under(candidate, root)) return;
    const parents: string[] = [];
    for (let parent = parentPath(candidate); parent !== root && under(parent, root); parent = parentPath(parent)) parents.unshift(parent);
    project.explorerRootExpanded = true; tree.filter = ''; tree.showHidden = true;
    for (const parent of parents) { this.expanded.add(parent); await this.load(parent); }
    await this.load(root); this.render(); selectPaths([candidate]);
  };

  collapse = (): void => {
    this.expanded.clear();
    const ancestor = (this.children.get(project.folder?.path ?? '') ?? []).find(entry => under(tree.focused, entry.path));
    if (ancestor) selectPaths([ancestor.path]);
    this.render();
  };

  toggle = async (directoryPath: string): Promise<void> => {
    if (this.expanded.delete(directoryPath)) {
      if (under(tree.focused, directoryPath)) selectPaths([directoryPath]);
      return this.render();
    }
    this.expanded.add(directoryPath);
    this.render();
    if (!this.children.has(directoryPath)) await this.load(directoryPath);
  };

  open = async (filePath: string, options?: EditorOpenOptions): Promise<boolean> => {
    try {
      project.error = '';
      return await this.options.showDocument(filePath, options);
    } catch (error) {
      this.fail(error);
      return false;
    }
  };

  private mutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.options.runMutation(async () => {
      // Invalidate reads started before the transaction. Watcher notifications
      // reconcile only after the receipt has remapped document and tree paths.
      this.generation++;
      this.mutating = true;
      project.error = '';
      try { return await operation(); }
      catch (error) { this.fail(error); throw error; }
      finally {
        this.mutating = false;
        if (this.refreshPending) { this.refreshPending = false; await this.refresh(); }
      }
    });
  }

  create = (parent: string, name: string, kind: ProjectEntryKind): Promise<void> => this.mutation(async () => {
    const created = await this.options.desktop.createProjectEntry(parent, name, kind);
    this.expanded.add(parent);
    await this.reloadDirectories([parent]);
    selectPaths([created.path]);
    if (created.kind === 'document') await this.open(created.path);
  });

  rename = (entryPath: string, name: string): Promise<void> => this.mutation(async () => {
    const moved = await this.options.desktop.renameProjectEntry(entryPath, name);
    if (moved.from === moved.to) return;
    this.remapExpanded(moved.from, moved.to);
    await this.options.pathMoved(moved.from, moved.to);
    if (project.folder) await this.reload(project.folder);
  });

  move = (entryPath: string, targetDirectory: string): Promise<void> => this.mutation(async () => {
    const moved = await this.options.desktop.moveProjectEntry(entryPath, targetDirectory);
    if (moved.from === moved.to) return;
    await this.applyResult({ kind: 'move', items: [{ ...moved, status: 'completed' }], undoable: false });
  });

  moveMany = (paths: string[], target: string): Promise<string[]> => this.mutation(async () => {
    const result = await this.options.desktop.moveProjectEntries(paths, target);
    await this.applyResult({ kind: 'move', items: result.moves.map(move => ({ ...move, status: 'completed' })), undoable: false });
    if (result.error) this.fail(new Error(result.error));
    return paths.map(path => {
      const moved = result.moves.find(move => under(path, move.from));
      return moved ? `${moved.to}${path.slice(moved.from.length)}` : path;
    });
  });

  transfer = (request: ExplorerTransfer | { kind: 'paste'; target: string; conflict?: ExplorerTransfer['conflict'] }): Promise<void> => this.mutation(async () => {
    const result = request.kind === 'paste'
      ? await this.options.desktop.explorer.paste(request.target, request.conflict)
      : await this.options.desktop.explorer.transfer(request);
    await this.applyResult(result);
  });

  private async applyResult(result: ExplorerOperationResult): Promise<void> {
    const completed = result.items.filter(item => item.status === 'completed');
    for (const item of completed) {
      this.expanded.add(parentPath(item.to));
      if (result.kind === 'move') {
        this.remapExpanded(item.from, item.to);
        await this.options.pathMoved(item.from, item.to);
      }
    }
    if (project.folder) await this.reload(project.folder);
    if (completed.length) selectPaths(completed.map(item => item.to));
    const failed = result.items.find(item => item.status === 'failed');
    if (failed) this.fail(new Error(`${completed.length} completed. ${failed.error} Remaining items were not changed.`));
  }

  trash = (entryPath: string): Promise<boolean> => this.mutation(async () => {
    if (!await this.options.prepareRemove(entryPath)) return false;
    await this.options.desktop.trashProjectEntry(entryPath);
    await this.options.commitRemove(entryPath);
    for (const directory of [...this.expanded]) {
      if (under(directory, entryPath)) this.expanded.delete(directory);
    }
    await this.reloadDirectories([parentPath(entryPath)]);
    return true;
  });

  private async reload(folder: ProjectFolder): Promise<void> {
    const expanded = [...this.expanded].sort((a, b) => a.length - b.length);
    await this.load(folder.path);
    for (const directory of expanded) {
      if (under(directory, folder.path) && this.expanded.has(directory)) await this.load(directory);
    }
  }

  private async reloadDirectories(directories: string[]): Promise<void> {
    for (const directory of new Set(directories)) {
      await this.load(directory);
    }
  }

  private async load(directoryPath: string): Promise<void> {
    const generation = this.generation;
    const request = (this.requests.get(directoryPath) ?? 0) + 1;
    this.requests.set(directoryPath, request);
    const current = () => generation === this.generation && request === this.requests.get(directoryPath);
    try {
      const entries = await this.options.desktop.readProjectDirectory(directoryPath);
      if (!current()) return;
      const previous = this.children.get(directoryPath) ?? [];
      for (const removed of previous.filter(entry => !entries.some(next => next.path === entry.path))) {
        for (const cached of this.children.keys()) if (under(cached, removed.path)) this.children.delete(cached);
        for (const expanded of this.expanded) if (under(expanded, removed.path)) this.expanded.delete(expanded);
        const wasSelected = tree.selection.paths.some(candidate => under(candidate, removed.path));
        tree.selection.paths = tree.selection.paths.filter(candidate => !under(candidate, removed.path));
        if (under(tree.focused, removed.path)) {
          const next = entries[Math.min(previous.indexOf(removed), entries.length - 1)];
          tree.focused = next?.path ?? directoryPath;
          if (wasSelected && !tree.selection.paths.length && next) tree.selection = { paths: [next.path], anchor: next.path };
        }
      }
      this.children.set(directoryPath, entries);
    } catch (error) {
      if (!current()) return;
      this.fail(error);
      this.expanded.delete(directoryPath);
    }
    this.render();
  }

  private remapExpanded(from: string, to: string): void {
    remapTree(from, to);
    const remapped = [...this.expanded].map((directory) => under(directory, from)
      ? `${to}${directory.slice(from.length)}` : directory);
    this.expanded.clear();
    for (const directory of remapped) this.expanded.add(directory);
  }

  private render(): void {
    const visible: VisibleProjectEntry[] = [];
    const append = (directoryPath: string, depth: number) => {
      for (const entry of this.children.get(directoryPath) ?? []) {
        const expanded = entry.kind === 'directory' && this.expanded.has(entry.path);
        visible.push({
          ...entry,
          depth,
          expanded,
          loading: expanded && !this.children.has(entry.path),
        });
        if (expanded) append(entry.path, depth + 1);
      }
    };
    if (project.folder) append(project.folder.path, 0);
    project.entries = visible;
    project.expanded = [...this.expanded];
    rememberProjectState();
  }

  private fail(error: unknown): void {
    project.error = error instanceof Error ? error.message : String(error);
  }
}
