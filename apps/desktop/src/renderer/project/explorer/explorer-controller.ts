import type {
  ProjectEntry,
  ProjectEntryKind,
  ProjectFolder,
} from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, rememberProjectState, type VisibleProjectEntry } from '../project-state.svelte';

type Options = {
  desktop: DesktopPort;
  showDocument(path: string): Promise<boolean>;
  pathMoved(from: string, to: string): Promise<void>;
  prepareRemove(path: string): Promise<boolean>;
};

const parentPath = (candidate: string) => candidate.replace(/[\\/][^\\/]+$/, '');
const under = (candidate: string, root: string) => candidate === root
  || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);

export class ExplorerController {
  private readonly children = new Map<string, ProjectEntry[]>();
  private readonly expanded = new Set<string>();

  constructor(private readonly options: Options) {
    for (const path of project.expanded) this.expanded.add(path);
  }

  reset = async (folder: ProjectFolder): Promise<void> => {
    this.children.clear();
    this.expanded.clear();
    await this.load(folder.path);
  };

  restore = async (folder: ProjectFolder): Promise<void> => {
    await this.reload(folder);
  };

  refresh = async (): Promise<void> => {
    if (project.folder) await this.reload(project.folder);
  };

  collapse = (): void => {
    this.expanded.clear();
    this.render();
  };

  toggle = async (directoryPath: string): Promise<void> => {
    if (this.expanded.delete(directoryPath)) return this.render();
    this.expanded.add(directoryPath);
    this.render();
    if (!this.children.has(directoryPath)) await this.load(directoryPath);
  };

  open = async (filePath: string): Promise<boolean> => {
    try {
      project.error = '';
      return await this.options.showDocument(filePath);
    } catch (error) {
      this.fail(error);
      return false;
    }
  };

  create = async (parent: string, name: string, kind: ProjectEntryKind): Promise<void> => {
    try {
      const created = await this.options.desktop.createProjectEntry(parent, name, kind);
      this.expanded.add(parent);
      await this.reloadDirectories([parent]);
      if (created.kind === 'document') await this.open(created.path);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  };

  rename = async (entryPath: string, name: string): Promise<void> => {
    try {
      const moved = await this.options.desktop.renameProjectEntry(entryPath, name);
      if (moved.from === moved.to) return;
      this.remapExpanded(moved.from, moved.to);
      await this.options.pathMoved(moved.from, moved.to);
      await this.reload(project.folder!);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  };

  move = async (entryPath: string, targetDirectory: string): Promise<void> => {
    try {
      const moved = await this.options.desktop.moveProjectEntry(entryPath, targetDirectory);
      if (moved.from === moved.to) return;
      this.remapExpanded(moved.from, moved.to);
      this.expanded.add(targetDirectory);
      await this.options.pathMoved(moved.from, moved.to);
      await this.reload(project.folder!);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  };

  trash = async (entryPath: string): Promise<void> => {
    try {
      if (!await this.options.prepareRemove(entryPath)) return;
      await this.options.desktop.trashProjectEntry(entryPath);
      for (const directory of [...this.expanded]) {
        if (under(directory, entryPath)) this.expanded.delete(directory);
      }
      await this.reloadDirectories([parentPath(entryPath)]);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  };

  private async reload(folder: ProjectFolder): Promise<void> {
    const expanded = [...this.expanded].sort((a, b) => a.length - b.length);
    this.children.clear();
    await this.load(folder.path);
    for (const directory of expanded) {
      if (under(directory, folder.path)) await this.load(directory);
    }
  }

  private async reloadDirectories(directories: string[]): Promise<void> {
    for (const directory of new Set(directories)) {
      this.children.delete(directory);
      await this.load(directory);
    }
  }

  private async load(directoryPath: string): Promise<void> {
    project.error = '';
    try {
      this.children.set(directoryPath, await this.options.desktop.readProjectDirectory(directoryPath));
    } catch (error) {
      this.fail(error);
      this.expanded.delete(directoryPath);
    }
    this.render();
  }

  private remapExpanded(from: string, to: string): void {
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
