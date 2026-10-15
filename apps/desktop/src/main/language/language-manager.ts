import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { languageMethods, type LanguageDocument, type LanguageEvent, type LanguageMethod } from '../../protocol/language';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { ServerSession } from './server-session';

type Binding = { id: string; generation: string; uri: string; version: number; server: ServerSession };
type Owner = { state: WindowState; documents: Map<string, Binding>; servers: Map<string, ServerSession>;
  requests: Map<string, CancellationTokenSource> };

/** A separate server for each (window, Python root). Unsaved buffers never cross windows. */
export class LanguageManager {
  private readonly owners = new Map<number, Owner>();
  private readonly watched = new Set<number>();
  private readonly draining = new Set<Promise<void>>();
  constructor(private readonly stateFor: (id: number) => WindowState | null) {}
  install(): void {
    const state = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
      const owner = this.stateFor(event.sender.id);
      if (!owner || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed())
        throw new Error('Language support is available only to the owning editor.');
      return owner;
    };
    ipcMain.handle('language:open', (event, document: LanguageDocument) => this.open(state(event), document));
    ipcMain.handle('language:change', (event, id: string, version: number, changes: TextDocumentContentChangeEvent[]) => {
      const binding = this.binding(state(event).webContentsId, id);
      if (!Number.isSafeInteger(version) || version <= binding.version || !Array.isArray(changes)
        || changes.length > 10000 || JSON.stringify(changes).length > 32 * 1024 * 1024) throw new Error('Invalid language change.');
      binding.version = version;
      return binding.server.notify('textDocument/didChange', { textDocument: { uri: binding.uri, version }, contentChanges: changes });
    });
    ipcMain.handle('language:request', async (event, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown) => {
      const owner = this.owners.get(state(event).webContentsId);
      const binding = this.binding(event.sender.id, id);
      if (!owner || binding.version !== version || !languageMethods.includes(method)
        || typeof requestId !== 'string' || requestId.length > 128 || owner.requests.has(requestId)
        || owner.requests.size >= 64 || !params || typeof params !== 'object') throw new Error('Invalid or stale language request.');
      const token = new CancellationTokenSource();
      owner.requests.set(requestId, token);
      try {
        const result = await binding.server.request(method, method === 'completionItem/resolve' ? params
          : { ...params, textDocument: { uri: binding.uri } }, token);
        return owner.documents.get(id) === binding && binding.version === version ? result : null;
      } finally { owner.requests.delete(requestId); }
    });
    const listen = (channel: string, handler: (owner: WindowState, id: string) => void) => {
      ipcMain.on(channel, (event, id: unknown) => {
        if (typeof id !== 'string' || id.length > 128) return;
        let owner: WindowState;
        try { owner = state(event); } catch { return; }
        handler(owner, id);
      });
    };
    listen('language:cancel', (owner, id) => { this.owners.get(owner.webContentsId)?.requests.get(id)?.cancel(); });
    listen('language:close', (owner, id) => this.close(owner.webContentsId, id));
    listen('language:saved', (owner, id) => {
      const binding = this.owners.get(owner.webContentsId)?.documents.get(id);
      if (binding) void binding.server.notify('textDocument/didSave', { textDocument: { uri: binding.uri } }).catch(() => {});
    });
    ipcMain.handle('language:restart', event => this.dispose(state(event).webContentsId));
    let drained = false;
    app.on('will-quit', event => {
      if (drained || (!this.owners.size && !this.draining.size)) return;
      event.preventDefault();
      void Promise.all([...this.owners.keys()].map(id => this.dispose(id)))
        .then(() => Promise.all([...this.draining])).finally(() => { drained = true; app.quit(); });
    });
  }
  private emit(owner: Owner, event: LanguageEvent): void {
    if (!owner.state.window.isDestroyed() && !owner.state.window.webContents.isDestroyed())
      owner.state.window.webContents.send('language:event', event);
  }
  private binding(ownerId: number, id: string): Binding {
    const binding = this.owners.get(ownerId)?.documents.get(id);
    if (!binding) throw new Error('Language document is closed.');
    return binding;
  }
  private async open(state: WindowState, document: LanguageDocument) {
    if (!document || typeof document.id !== 'string' || document.id.length > 128
      || typeof document.generation !== 'string' || document.generation.length > 128
      || typeof document.path !== 'string' || !path.isAbsolute(document.path) || !/\.pyi?$/i.test(document.path)
      || typeof document.text !== 'string' || document.text.length > 16 * 1024 * 1024
      || !Number.isSafeInteger(document.version) || document.version < 1) throw new Error('Invalid Python document.');
    const file = canonicalPath(document.path);
    const owns = state.currentDocument?.path === file || state.rendererTabs.some(tab => !tab.isUntitled && tab.path === file)
      || state.rendererGitReview?.path === file;
    if (!owns) throw new Error('The Python document is not open in this window.');
    let owner = this.owners.get(state.webContentsId);
    if (!owner) {
      owner = { state, documents: new Map(), servers: new Map(), requests: new Map() };
      this.owners.set(state.webContentsId, owner);
      if (!this.watched.has(state.webContentsId)) {
        this.watched.add(state.webContentsId);
        state.window.webContents.once('destroyed', () => { this.watched.delete(state.webContentsId); void this.dispose(state.webContentsId); });
        state.window.webContents.on('render-process-gone', () => { void this.dispose(state.webContentsId); });
        state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
          if (mainFrame && !inPlace) void this.dispose(state.webContentsId);
        });
      }
    }
    this.close(state.webContentsId, document.id);
    const root = state.projectRoot && isInside(canonicalPath(state.projectRoot), file)
      ? canonicalPath(state.projectRoot) : path.dirname(file);
    let server = owner.servers.get(root);
    const owned = owner;
    if (!server) {
      const { NODE_OPTIONS: _options, NODE_PATH: _nodePath, ...env } = process.env;
      const entry = require.resolve('pyright/langserver.index.js');
      server = new ServerSession({ executable: process.execPath,
        // Pyright's Node runtime requires a physical server/typeshed tree.
        // electron-builder keeps this dependency outside ASAR (see package.json).
        args: [app.isPackaged ? entry.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2') : entry, '--stdio'],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }, root, params => {
        for (const binding of owned.documents.values()) {
          // Pyright includes versions. Reject unversioned/stale diagnostics rather
          // than pretending they belong to the newest unsaved buffer.
          if (binding.server === server && binding.uri === params.uri && params.version === binding.version)
            this.emit(owned, { type: 'diagnostics', id: binding.id, generation: binding.generation, version: binding.version, diagnostics: params.diagnostics });
        }
      }, message => this.emit(owned, { type: 'status', state: 'failed', message,
        documents: [...owned.documents.values()].filter(binding => binding.server === server).map(({ id, generation }) => ({ id, generation })) }));
      owner.servers.set(root, server);
      server.watch(root);
    }
    const binding = { id: document.id, generation: document.generation, uri: pathToFileURL(file).href, version: document.version, server };
    if ([...owner.documents.values()].some(other => other.uri === binding.uri)) throw new Error('Python document is already connected.');
    owner.documents.set(document.id, binding);
    this.emit(owner, { type: 'status', state: 'starting', documents: [{ id: binding.id, generation: binding.generation }] });
    const capabilities = await server.ready;
    if (this.owners.get(state.webContentsId) !== owner || owner.documents.get(document.id) !== binding)
      throw new Error('Python document closed during initialization.');
    await server.notify('textDocument/didOpen', { textDocument: { uri: binding.uri, languageId: 'python',
      version: document.version, text: document.text } });
    this.emit(owner, { type: 'status', state: 'ready', documents: [{ id: binding.id, generation: binding.generation }] });
    return { uri: binding.uri, capabilities };
  }
  private close(ownerId: number, id: string): void {
    const owner = this.owners.get(ownerId);
    const binding = owner?.documents.get(id);
    if (!owner || !binding) return;
    owner.documents.delete(id);
    void binding.server.notify('textDocument/didClose', { textDocument: { uri: binding.uri } }).catch(() => {});
    if (![...owner.documents.values()].some(other => other.server === binding.server)) {
      for (const [root, server] of owner.servers) if (server === binding.server) owner.servers.delete(root);
      void this.stop(binding.server);
    }
  }
  private async dispose(id: number): Promise<void> {
    const owner = this.owners.get(id);
    if (!owner) return;
    this.owners.delete(id);
    for (const token of owner.requests.values()) token.cancel();
    owner.documents.clear();
    await Promise.all([...owner.servers.values()].map(server => this.stop(server)));
    owner.servers.clear();
  }
  private stop(server: ServerSession): Promise<void> {
    const stopped = server.stop();
    this.draining.add(stopped);
    void stopped.finally(() => this.draining.delete(stopped));
    return stopped;
  }
}
