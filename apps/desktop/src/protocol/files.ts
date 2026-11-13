import type { ExplorerClipboard, ExplorerOperationResult, ExplorerTransfer } from './explorer';
import type { ProjectEntry, ProjectEntryKind, ProjectEntryMove } from './desktop-api';

export type { FolderEntry, FolderListing, FolderPlace, FolderLocation, PathPickerFilter, PathPickerRequest, FileApplication, FileProperties, FolderOpenRequest } from '../core/files/folder-types';
import type { FileApplication, FileProperties, FolderEntry, FolderListing, FolderLocation, FolderOpenRequest, FolderPlace, PathPickerRequest } from '../core/files/folder-types';

export interface FilesApi {
  home(): Promise<string>;
  list(path: string): Promise<FolderListing>;
  resolve(location: string): Promise<FolderLocation>;
  /** Directory children for address-bar completion (folders first, at most `limit`). */
  complete(prefix: string, limit?: number): Promise<{ path: string; name: string; directory: boolean }[]>;
  places(): Promise<FolderPlace[]>;
  watch(token: string, path: string | null): void;
  onChanged(listener: (event: { token: string; path: string }) => void): () => void;
  create(parent: string, name: string, kind: ProjectEntryKind): Promise<ProjectEntry>;
  rename(path: string, name: string): Promise<ProjectEntryMove>;
  trash(path: string): Promise<void>;
  restore(path: string): Promise<string>;
  transfer(request: ExplorerTransfer): Promise<ExplorerOperationResult>;
  /** Drag these paths as an OS file drag (to web pages and other applications); resolves when the drag ends. */
  startDrag(paths: string[]): Promise<void>;
  /** The button was released before the OS drag began; a pending `startDrag` must not start it. */
  cancelDrag(): void;
  /** How files dropped from another application enter `target`: moved within a volume, otherwise copied. */
  dropKind(paths: string[], target: string): Promise<'move' | 'import'>;
  /** Stop the running transfer; progress arrives on the shared `explorer.onProgress`. */
  cancel(): void;
  setClipboard(paths: string[], cut: boolean): Promise<ExplorerClipboard>;
  paste(target: string, conflict?: ExplorerTransfer['conflict']): Promise<ExplorerOperationResult>;
  open(path: string): Promise<void>;
  revealInSystem(path: string): Promise<void>;
  entries(paths: string[]): Promise<FolderEntry[]>;
  /** Name search below `root`; a new search in the window replaces the previous one. */
  search(root: string, query: string, showHidden: boolean): Promise<{ entries: FolderEntry[]; limitHit: boolean }>;
  cancelSearch(): void;
  properties(path: string): Promise<FileProperties>;
  applications(path: string): Promise<{ type: string; applications: FileApplication[] }>;
  openWith(applicationId: string, paths: string[]): Promise<void>;
  thumbnail(path: string): Promise<string | null>;
  emptyTrash(): Promise<void>;
  deletePermanently(paths: string[]): Promise<void>;
  mount(device: string): Promise<string>;
  unmount(device: string): Promise<void>;
  setBookmark(folder: string, present: boolean): Promise<void>;
  extract(archive: string): Promise<string>;
  compress(paths: string[]): Promise<string>;
  /** Folders requested at launch (`setdown <folder>`), then live requests from main. */
  launchRequests(): Promise<FolderOpenRequest[]>;
  onOpenRequest(listener: (request: FolderOpenRequest) => void): () => void;
  onPickerRequest(listener: (request: PathPickerRequest) => void): () => void;
  onPickerCancel(listener: (id: string) => void): () => void;
  resolvePicker(id: string, paths: string[] | null): void;
}
