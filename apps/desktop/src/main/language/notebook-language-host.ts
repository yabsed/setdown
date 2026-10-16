import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { LanguageCell, LanguageConnection, LanguageDocument, LanguageEvent, LanguageMethod } from '../../protocol/language';
import type { WindowState } from '../windows/window-state';
import { canonicalPath } from '../documents/file-system';
import { ServerSession } from './server-session';
import { notebookPython } from '../notebook/python-environments';

const methods = new Set<LanguageMethod>(['textDocument/completion', 'textDocument/hover', 'textDocument/signatureHelp',
  'textDocument/definition', 'textDocument/references', 'textDocument/documentHighlight', 'textDocument/documentSymbol',
  'textDocument/semanticTokens/full', 'textDocument/inlayHint']);
type Cell = LanguageCell & { uri: string };
type Session = { state: WindowState; document: LanguageDocument; cells: Cell[]; server: ServerSession;
  phase: 'starting' | 'ready' | 'failed'; message?: string; uri: string; epoch: number; requests: Map<string, CancellationTokenSource>; ready: boolean };
export function validateLanguageCells(cells: unknown): asserts cells is LanguageCell[] {
  if (!Array.isArray(cells) || cells.length > 10000) throw Error('Invalid notebook cells.');
  let size = 0; const ids = new Set<string>();
  for (const cell of cells) {
    if (!cell || typeof cell.id !== 'string' || !/^[\w-]{1,64}$/.test(cell.id) || ids.has(cell.id)
      || !Number.isSafeInteger(cell.version) || cell.version < 1 || typeof cell.text !== 'string') throw Error('Invalid notebook cell.');
    ids.add(cell.id); size += cell.text.length;
  }
  if (size > 16 * 1024 * 1024) throw Error('Notebook source is too large.');
}
/** Native notebook synchronization, with an independent analysis environment per notebook.
 * Wire URIs are main-owned; the UI's setdown-cell models never become filesystem paths. */
export class NotebookLanguageHost {
  private sessions = new Map<string, Session>();
  private openings = new Map<string, object>();
  private watched = new Set<number>();
  private draining = new Set<Promise<void>>();
  get running(): boolean { return !!(this.sessions.size || this.openings.size || this.draining.size); }
  private key(owner: number, id: string): string { return `${owner}:${id}`; }
  has(owner: number, id: string): boolean { return this.sessions.has(this.key(owner, id)); }
  private emit(session: Session, event: LanguageEvent): void {
    const contents = session.state.window.webContents;
    if (!contents.isDestroyed()) contents.send('language:event', event);
  }
  private status(session: Session, state: 'starting' | 'ready' | 'failed', message?: string): void {
    session.phase = state; session.message = message;
    this.emit(session, { type: 'status', documents: [{ id: session.document.id, generation: session.document.generation }], state, message });
  }
  private cells(uri: string, cells: LanguageCell[], epoch = 0): Cell[] {
    return [{ id: '', version: 1, text: 'from IPython import get_ipython as get_ipython' }, ...cells].map(cell => ({ ...cell, uri: uri.replace(/^file:/, 'vscode-notebook-cell:') + '#' + cell.id + '.' + epoch }));
  }
  async open(state: WindowState, document: LanguageDocument): Promise<LanguageConnection> {
    if (!document || typeof document.id !== 'string' || document.id.length > 128 || typeof document.generation !== 'string'
      || document.generation.length > 128 || typeof document.path !== 'string' || !path.isAbsolute(document.path)
      || !/\.ipynb$/i.test(document.path) || !Number.isSafeInteger(document.version) || document.version < 1
      || (document.python !== undefined && (typeof document.python !== 'string' || !path.isAbsolute(document.python)))) throw Error('Invalid notebook language document.');
    validateLanguageCells(document.cells);
    const file = canonicalPath(document.path), owner = state.webContentsId, key = this.key(owner, document.id);
    const owns = () => !state.window.isDestroyed() && !state.window.webContents.isDestroyed()
      && (state.currentDocument?.path === file || state.rendererTabs.some(tab => !tab.isUntitled && tab.path === file));
    if (!owns()) throw Error('Only an open notebook can use language support.');
    this.close(owner, document.id);
    const token = {}; this.openings.set(key, token);
    if (!this.watched.has(owner)) {
      this.watched.add(owner);
      state.window.webContents.once('destroyed', () => { this.watched.delete(owner); void this.dispose(owner); });
      state.window.webContents.on('render-process-gone', () => { void this.dispose(owner); });
      state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) void this.dispose(owner); });
    }
    try {
      const environment = await notebookPython.resolve(file, document.python);
      if (this.openings.get(key) !== token || !owns()) throw Error('Notebook closed during language initialization.');
      const entry = require.resolve('basedpyright/langserver.index.js').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
      const { NODE_OPTIONS: _options, NODE_PATH: _nodePath, ...env } = environment.env;
      const uri = pathToFileURL(file).href;
      const session = { state, document: { ...document }, cells: this.cells(uri, document.cells), uri, phase: 'starting', epoch: 0, requests: new Map(), ready: false } as Session;
      // Notebook mode supplies display(); the hidden first cell binds IPython's
      // runtime get_ipython() with its installed types. Neither source is rewritten.
      // Explicit notebook-scoped config avoids changing the user's ordinary .py server.
      const analysis = { typeCheckingMode: 'basic', diagnosticMode: 'openFilesOnly', autoSearchPaths: true, useLibraryCodeForTypes: true };
      session.server = new ServerSession({ executable: process.execPath, args: [entry, '--stdio'], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } },
        state.projectRoot ?? path.dirname(file), params => {
          if (this.sessions.get(key) !== session) return;
          const cell = session.cells.find(cell => cell.uri === params.uri);
          if (!cell?.id || params.version !== session.document.version) return; // This bundled server provides versions; no guessed positions.
          this.emit(session, { type: 'diagnostics', id: document.id, generation: document.generation, version: session.document.version,
            cell: cell.id, cellVersion: cell.version, diagnostics: params.diagnostics });
        }, message => { if (this.sessions.get(key) === session) { session.ready = false; this.status(session, 'failed', message); } },
        { name: 'Notebook Python', watches: file => /\.(py|pyi|toml|json)$/.test(file), initializationOptions: { disablePullDiagnostics: true },
          configuration: { python: { pythonPath: environment.python, analysis }, basedpyright: { analysis } } });
      this.sessions.set(key, session); this.status(session, 'starting');
      const capabilities = await session.server.ready;
      if (this.sessions.get(key) !== session || !owns()) throw Error('Notebook closed during language initialization.');
      if (!capabilities.notebookDocumentSync) { this.close(owner, document.id); throw Error('The notebook server does not support cell synchronization.'); }
      session.server.watch(state.projectRoot ?? path.dirname(file));
      await session.server.notify('notebookDocument/didOpen', {
        notebookDocument: { uri, notebookType: 'jupyter-notebook', version: document.version,
          cells: session.cells.map(cell => ({ kind: 2, document: cell.uri })) },
        cellTextDocuments: session.cells.map(cell => ({ uri: cell.uri, languageId: 'python', version: session.document.version, text: cell.text })),
      });
      session.ready = true; this.status(session, 'ready');
      return { uri, cells: Object.fromEntries(session.cells.filter(cell => cell.id).map(cell => [cell.id, cell.uri])), capabilities, server: 'notebook-python' };
    } catch (error) {
      if (this.openings.get(key) === token) {
        const session = this.sessions.get(key);
        if (session && owns()) { session.ready = false; this.status(session, 'failed', String(error)); await session.server.stop(); }
        else this.close(owner, document.id);
      }
      throw error;
    } finally { if (this.openings.get(key) === token) this.openings.delete(key); }
  }
  async change(owner: number, id: string, version: number, cells: LanguageCell[]): Promise<Record<string, string>> {
    validateLanguageCells(cells);
    const session = this.sessions.get(this.key(owner, id));
    if (!session?.ready || !Number.isSafeInteger(version) || version <= session.document.version) throw Error('Stale notebook change.');
    const previous = session.cells;
    const previousUserCells = previous.filter(cell => cell.id);
    const structure = cells.length !== previousUserCells.length || cells.some((cell, i) => cell.id !== previousUserCells[i].id);
    for (const request of session.requests.values()) request.cancel();
    // A new URI epoch on structural edits rejects late diagnostics for removed/reordered
    // cells even when the server's internal positional chain reused a document version.
    if (structure) session.epoch = version;
    const next = this.cells(session.uri, cells, session.epoch);
    session.cells = next; session.document.version = version;
    if (structure) {
      await session.server.notify('notebookDocument/didClose', { notebookDocument: { uri: session.uri }, cellTextDocuments: previous.map(cell => ({ uri: cell.uri })) });
      await session.server.notify('notebookDocument/didOpen', {
        notebookDocument: { uri: session.uri, notebookType: 'jupyter-notebook', version, cells: next.map(cell => ({ kind: 2, document: cell.uri })) },
        cellTextDocuments: next.map(cell => ({ uri: cell.uri, languageId: 'python', version, text: cell.text })),
      });
    } else {
      // Advance dependency cells too: a diagnostic for unchanged cell B can depend on
      // edited cell A. Never relabel a result from the previous notebook snapshot.
      await session.server.notify('notebookDocument/didChange', { notebookDocument: { uri: session.uri, version }, change: { cells: {
        textContent: next.map(cell => ({ document: { uri: cell.uri, version }, changes: [{ text: cell.text }] })),
      } } });
    }
    return Object.fromEntries(next.filter(cell => cell.id).map(cell => [cell.id, cell.uri]));
  }
  async request(owner: number, id: string, version: number, requestId: string, method: LanguageMethod, value: unknown): Promise<unknown> {
    const session = this.sessions.get(this.key(owner, id));
    if (!session?.ready || version !== session.document.version || !methods.has(method) || typeof requestId !== 'string' || requestId.length > 128
      || session.requests.size >= 64 || session.requests.has(requestId) || !value || typeof value !== 'object' || JSON.stringify(value).length > 4 * 1024 * 1024) throw Error('Invalid notebook language request.');
    const { cell: cellId, ...params } = value as Record<string, unknown>;
    const cell = session.cells.find(cell => cell.id === cellId); if (!cell) throw Error('Notebook cell is closed.');
    const token = new CancellationTokenSource(); session.requests.set(requestId, token);
    try {
      const result = await session.server.request(method, { ...params, textDocument: { uri: cell.uri } }, token);
      return this.sessions.get(this.key(owner, id)) === session && session.document.version === version ? result : null;
    } catch (error) {
      if (token.token.isCancellationRequested || this.sessions.get(this.key(owner, id)) !== session) return null;
      throw error;
    } finally { session.requests.delete(requestId); token.dispose(); }
  }
  cancel(owner: number, id: string): void { for (const s of this.sessions.values()) if (s.state.webContentsId === owner) s.requests.get(id)?.cancel(); }
  close(owner: number, id: string): void {
    const key = this.key(owner, id); this.openings.delete(key);
    const session = this.sessions.get(key); if (!session) return;
    this.sessions.delete(key); for (const token of session.requests.values()) token.cancel();
    const stopped = (async () => {
      if (session.ready) await session.server.notify('notebookDocument/didClose', { notebookDocument: { uri: session.uri }, cellTextDocuments: session.cells.map(cell => ({ uri: cell.uri })) }).catch(() => {});
      await session.server.stop();
    })();
    this.draining.add(stopped); void stopped.finally(() => this.draining.delete(stopped));
  }
  snapshot(owner: number) {
    return [...this.sessions.values()].filter(session => session.state.webContentsId === owner).map(session => ({
      root: session.document.path, state: session.phase, message: session.message, logs: session.server.logs, features: ['Notebook cells', 'Completion', 'Hover', 'Definition'],
    }));
  }
  async dispose(owner?: number): Promise<void> {
    for (const key of this.openings.keys()) if (owner === undefined || key.startsWith(`${owner}:`)) this.openings.delete(key);
    for (const s of this.sessions.values()) if (owner === undefined || s.state.webContentsId === owner) this.close(s.state.webContentsId, s.document.id);
    await Promise.all([...this.draining]);
  }
}
