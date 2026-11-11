import type { FolderView } from '../../core/workspace/workspace-state';
import type { ExplorerClipboard, ExplorerOperationResult, ExplorerTransfer } from '../../protocol/explorer';
import type { FolderEntry } from '../../protocol/files';
import type { ProjectEntry, ProjectEntryKind, ProjectEntryMove } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';

/** File operations from a folder tab, coordinated with open documents. */
export type FolderOperations = {
  transfer(request: ExplorerTransfer): Promise<ExplorerOperationResult>;
  paste(target: string, conflict?: ExplorerTransfer['conflict']): Promise<ExplorerOperationResult>;
  undo(): Promise<ExplorerOperationResult>;
  create(parent: string, name: string, kind: ProjectEntryKind): Promise<ProjectEntry>;
  rename(path: string, name: string): Promise<ProjectEntryMove>;
  /** Stops at the first refusal or failure; returns the trashed paths. */
  trash(paths: string[]): Promise<string[]>;
  restore(path: string): Promise<string>;
  setClipboard(paths: string[], cut: boolean): Promise<ExplorerClipboard>;
  clipboard(): Promise<ExplorerClipboard | null>;
  clearClipboard(): Promise<void>;
  cancel(): void;
  onProgress(listener: (progress: { completed: number; total: number; path: string }) => void): () => void;
};

export type FolderActions = {
  newFolderTab(groupId?: string): void;
  openFolder(path: string, options?: { groupId?: string; selection?: string[]; side?: boolean; newTab?: boolean }): Promise<void>;
  /** Navigate a folder tab in place (Back/Forward keep the selection). */
  folderNavigate(tabId: string, path: string, selection?: string[]): Promise<void>;
  folderSelected(tabId: string, paths: string[]): void;
  folderViewChanged(tabId: string, update: Partial<FolderView>): void;
  folderOpenEntries(tabId: string, entries: FolderEntry[], options?: { side?: boolean; external?: boolean }): Promise<void>;
  folderOpenTerminal(path: string): void;
  folderOpenWorkspace(path: string): Promise<void>;
  folderFiles: FolderOperations;
  /** Address-bar completion for typed paths (folders first). */
  completePath(prefix: string): Promise<{ path: string; name: string; directory: boolean }[]>;
  pickerAccept(tabId: string, paths: string[]): void;
  pickerCancel(tabId: string): void;
};

type Options = {
  desktop: DesktopPort;
  runMutation<T>(operation: () => Promise<T>): Promise<T>;
  relocatePath(from: string, to: string): Promise<void>;
  prepareRemove(path: string): Promise<boolean>;
  commitRemove(path: string): Promise<void>;
};

export function createFolderOperations(options: Options): FolderOperations {
  const { desktop } = options;
  const applied = async (result: ExplorerOperationResult) => {
    if (result.kind === 'move') for (const item of result.items) if (item.status === 'completed') await options.relocatePath(item.from, item.to);
    return result;
  };
  const mutate = <T>(operation: () => Promise<T>) => options.runMutation(operation);
  return {
    transfer: request => mutate(async () => applied(await desktop.files.transfer(request))),
    paste: (target, conflict) => mutate(async () => applied(await desktop.files.paste(target, conflict))),
    undo: () => mutate(async () => applied(await desktop.files.transfer({ kind: 'undo', paths: [] }))),
    create: (parent, name, kind) => mutate(() => desktop.files.create(parent, name, kind)),
    rename: (path, name) => mutate(async () => {
      const moved = await desktop.files.rename(path, name);
      if (moved.from !== moved.to) await options.relocatePath(moved.from, moved.to);
      return moved;
    }),
    // Same order as the sidebar: decide unsaved edits, trash, then close only approved tabs.
    trash: paths => mutate(async () => {
      const trashed: string[] = [];
      for (const path of paths) {
        if (!await options.prepareRemove(path)) break;
        await desktop.files.trash(path);
        await options.commitRemove(path);
        trashed.push(path);
      }
      return trashed;
    }),
    restore: path => mutate(() => desktop.files.restore(path)),
    setClipboard: (paths, cut) => desktop.files.setClipboard(paths, cut),
    clipboard: () => desktop.explorer.clipboard(),
    clearClipboard: () => desktop.explorer.clearClipboard(),
    cancel: () => desktop.files.cancel(),
    onProgress: listener => desktop.explorer.onProgress(listener),
  };
}
