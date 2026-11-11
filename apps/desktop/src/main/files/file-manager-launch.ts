import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { FolderOpenRequest } from '../../core/files/folder-types';
import type { WindowState } from '../windows/window-state';

/**
 * Setdown as the desktop's file manager: `setdown <folder>` (the
 * `inode/directory` handler), `setdown --files`, and other applications'
 * "Show in folder" through org.freedesktop.FileManager1.
 */
export function folderRequestFromArgs(args: string[], packaged: boolean, home = os.homedir(),
  isDirectory: (candidate: string) => boolean = candidate => statSync(candidate).isDirectory()): FolderOpenRequest | null {
  let positional = false, files = false;
  for (const argument of args.slice(packaged ? 1 : 2)) {
    if (argument === '--') { positional = true; continue; }
    if (!positional && argument === '--files') { files = true; continue; }
    if (!positional && argument.startsWith('-')) continue;
    let candidate = argument;
    if (/^file:/i.test(argument)) { try { candidate = fileURLToPath(argument); } catch { continue; } }
    if (candidate === '.' && !packaged) continue; // `electron .` names the app, not a folder to browse.
    const resolved = path.resolve(candidate);
    try { if (isDirectory(resolved)) return { path: resolved }; } catch { /* Try the next argument. */ }
  }
  return files ? { path: home } : null;
}

/** Translate a FileManager1 call into folder requests (ShowItems selects inside the parent). */
export function requestsFromFileManagerCall(method: string, paths: string[],
  isDirectory: (candidate: string) => boolean = candidate => { try { return statSync(candidate).isDirectory(); } catch { return false; } }): FolderOpenRequest[] {
  const absolute = paths.filter(candidate => typeof candidate === 'string' && path.isAbsolute(candidate) && !candidate.includes('\0'));
  if (method === 'ShowFolders') return absolute.filter(isDirectory).map(folder => ({ path: folder }));
  const byParent = new Map<string, string[]>();
  for (const item of absolute) byParent.set(path.dirname(item), [...byParent.get(path.dirname(item)) ?? [], item]);
  return [...byParent].map(([parent, selection]) => ({ path: parent, selection, ...(method === 'ShowItemProperties' ? { properties: true } : {}) }));
}

/** Requests wait until a window's renderer can receive them. */
export class FolderRequests {
  private readonly pending = new Map<number, FolderOpenRequest[]>();
  deliver(state: WindowState, request: FolderOpenRequest): void {
    if (state.window.isDestroyed()) return;
    if (!state.rendererTabsReady) {
      // A starting window shows itself when ready; its renderer collects these on startup.
      this.pending.set(state.webContentsId, [...this.pending.get(state.webContentsId) ?? [], request]);
      state.window.once('closed', () => this.pending.delete(state.webContentsId));
      return;
    }
    state.window.webContents.send('files:open-request', request);
    if (state.window.isMinimized()) state.window.restore();
    state.window.show(); state.window.focus();
  }
  take(state: WindowState): FolderOpenRequest[] {
    const requests = this.pending.get(state.webContentsId) ?? [];
    this.pending.delete(state.webContentsId);
    return requests;
  }
}

/** Own FileManager1 through the GLib helper; a missing python3-gobject only disables it. */
export function startFileManagerDbus(script: string, onCall: (method: string, paths: string[]) => void): () => void {
  if (process.platform !== 'linux' || process.env.SETDOWN_NO_FILE_MANAGER_DBUS === '1') return () => {};
  let child: ChildProcess;
  try { child = spawn('/usr/bin/python3', ['-I', script.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')], { stdio: ['pipe', 'pipe', 'ignore'] }); }
  catch { return () => {}; }
  child.on('error', error => console.warn('FileManager1 integration is unavailable:', error.message));
  createInterface({ input: child.stdout! }).on('line', line => {
    try {
      const message = JSON.parse(line) as { method?: unknown; paths?: unknown };
      if (typeof message.method === 'string' && Array.isArray(message.paths)) onCall(message.method, message.paths.filter((item): item is string => typeof item === 'string'));
    } catch { /* Ignore malformed helper output. */ }
  });
  return () => { child.stdin?.end(); child.kill(); };
}
