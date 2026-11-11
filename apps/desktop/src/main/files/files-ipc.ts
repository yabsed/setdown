import path from 'node:path';
import { shell } from 'electron';
import type { ExplorerOperationResult, ExplorerTransfer } from '../../protocol/explorer';
import type { ProjectEntryKind } from '../../protocol/desktop-api';
import type { DocumentManager } from '../documents/document-manager';
import type { WindowIpc } from '../ipc/window-ipc';
import { canonicalPath } from '../documents/file-system';
import type { FileBrowserService } from './file-browser-service';
import { applicationsFor, compressFiles, emptyTrash, extractArchive, mountVolume, openWith, properties, setBookmark, thumbnail, unmountVolume } from './desktop-integration';
import type { FolderRequests } from './file-manager-launch';

const absolute = (candidate: unknown): string => {
  if (typeof candidate !== 'string' || candidate.includes('\0') || !path.isAbsolute(candidate)) throw new Error('Invalid file path.');
  return candidate;
};

/** App-window-only channels behind folder tabs. Web contents never receive these (window-ipc.ts). */
export function installFilesIpc(channels: WindowIpc, files: FileBrowserService, documents: DocumentManager, requests: FolderRequests): void {
  const moved = (result: ExplorerOperationResult) => {
    if (result.kind === 'move') for (const item of result.items) if (item.status === 'completed') documents.positions?.move(item.from, item.to);
    return result;
  };
  channels.handle('files:home', () => files.home());
  channels.handle('files:list', (_state, directory: unknown) => files.list(absolute(directory)));
  channels.handle('files:resolve', (_state, location: unknown) => files.resolve(String(location)));
  channels.handle('files:complete', (_state, prefix: unknown, limit: unknown) => files.complete(String(prefix), Number(limit) || 8));
  channels.handle('files:places', () => files.places());
  channels.on('files:watch', (state, token: unknown, directory: unknown) => {
    try {
      files.watch(state, String(token), directory === null ? null : absolute(directory),
        event => { if (!state.window.isDestroyed()) state.window.webContents.send('files:changed', event); });
    } catch { /* An invalid folder simply is not watched. */ }
  });
  channels.handle('files:create', (state, parent: unknown, name: unknown, kind: ProjectEntryKind) => files.create(state, absolute(parent), String(name), kind));
  channels.handle('files:rename', async (state, entry: unknown, name: unknown) => {
    const result = await files.rename(state, absolute(entry), String(name));
    documents.positions?.move(result.from, result.to); return result;
  });
  channels.handle('files:trash', (state, entry: unknown) => files.trash(state, absolute(entry)));
  channels.handle('files:restore', (state, entry: unknown) => files.restore(state, absolute(entry)));
  channels.handle('files:transfer', async (state, request: ExplorerTransfer) => moved(await files.transfer(state, request)));
  channels.on('files:cancel', state => files.cancel(state));
  channels.handle('files:copy', (_state, paths: string[], cut: boolean) => files.setClipboard(paths, cut));
  channels.handle('files:paste', async (state, target: unknown, conflict?: ExplorerTransfer['conflict']) => moved(await files.paste(state, absolute(target), conflict)));
  channels.handle('files:open', async (_state, target: unknown) => {
    const failure = await shell.openPath(canonicalPath(absolute(target)));
    if (failure) throw new Error(failure);
  });
  channels.handle('files:reveal-system', (_state, target: unknown) => shell.showItemInFolder(absolute(target)));
  // File-manager services resolved by the desktop (GIO, UDisks, shared thumbnail cache).
  const list = (paths: unknown): string[] => { if (!Array.isArray(paths) || paths.length > 10000) throw new Error('Invalid selection.'); return paths.map(absolute); };
  channels.handle('files:entries', (_state, paths: unknown) => files.entries(list(paths)));
  channels.handle('files:search', (state, root: unknown, query: unknown, showHidden: unknown) => files.search(state, absolute(root), String(query), showHidden === true));
  channels.on('files:search-cancel', state => files.cancelSearch(state));
  channels.handle('files:properties', (_state, target: unknown) => properties(absolute(target)));
  channels.handle('files:applications', (_state, target: unknown) => applicationsFor(absolute(target)));
  channels.handle('files:open-with', (_state, id: unknown, paths: unknown) => openWith(String(id), list(paths)));
  channels.handle('files:thumbnail', (_state, target: unknown) => thumbnail(absolute(target)));
  channels.handle('files:empty-trash', () => emptyTrash());
  channels.handle('files:delete', (state, paths: unknown) => files.deletePermanently(state, list(paths)));
  channels.handle('files:mount', (_state, device: unknown) => mountVolume(String(device)));
  channels.handle('files:unmount', (_state, device: unknown) => unmountVolume(String(device)));
  channels.handle('files:bookmark', (_state, folder: unknown, present: unknown) => setBookmark(absolute(folder), present === true));
  channels.handle('files:extract', (_state, archive: unknown) => extractArchive(absolute(archive)));
  channels.handle('files:compress', (_state, paths: unknown) => compressFiles(list(paths)));
  channels.handle('files:launch-requests', state => requests.take(state));
}
