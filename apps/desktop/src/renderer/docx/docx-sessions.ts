import { isWordEditorDocument } from '../../core/document/document-capabilities';
import type { DiskVersion } from '../../core/document/document';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { DocumentContentOwner } from '../ports/document-content';
import type { DocxEditApi, DocxSource } from '../../protocol/docx-edit';
import type { SaveResult } from '../../protocol/desktop-api';
import type { DocxEngine, DocxMode } from './docx-engine';

/** `edits` counts committed user edits; the document is dirty while it is ahead of `savedEdits`. */
export type DocxSession = { engine: DocxEngine; path: string; edits: number; savedEdits: number; busy: boolean; error?: string };
export type DocxRuntime = { openDocx(bytes: Uint8Array, options: { mode: DocxMode }): DocxEngine };
/** The bytes stopped being a Word document package after the tab was opened; the editor never opens or saves them. */
export class NotWordDocumentError extends Error {
  constructor() { super('This file is no longer a Word (.docx) document. Reload it.'); this.name = 'NotWordDocumentError'; }
}
export type DocxSessionPorts = {
  read(path: string, version: DiskVersion): Promise<DocxSource>;
  save: DocxEditApi['save'];
  /** Loads the engine on first use; nothing imports it at startup. */
  runtime(): Promise<DocxRuntime>;
  tabs(): DocumentTab[];
  changed(): void;
};

const EVICTION_GRACE_MS = 1500;
/**
 * The workspace owns one engine per open Word document. A surface only mounts and
 * unmounts it, so edits, undo history and selection outlive media-cache eviction,
 * tab switches and saves. Clean sessions are dropped with their surface.
 */
export class DocxSessions implements DocumentContentOwner {
  private entries = new Map<string, DocxSession>();
  private pending = new Map<string, Promise<DocxSession>>();
  private modes = new Map<string, DocxMode>();
  private listeners = new Set<() => void>();
  private ports!: DocxSessionPorts;
  /** When the most recent edit was committed; recovery waits for a typing pause. */
  lastEditAt = 0;
  saveFromToolbar: (id: string, saveAs: boolean) => Promise<unknown> = async () => {};
  configure(ports: DocxSessionPorts) { this.ports = ports; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of [...this.listeners]) listener(); this.ports.changed(); }
  private tab(id: string) { return this.ports.tabs().find(tab => tab.id === id); }
  get(id: string): DocxSession | undefined { return this.tab(id) ? this.entries.get(id) : undefined; }
  mode(id: string): DocxMode { return this.modes.get(id) ?? 'view'; }
  setMode(id: string, mode: DocxMode) {
    if (this.mode(id) === mode) return;
    this.modes.set(id, mode); this.entries.get(id)?.engine.setMode(mode); this.notify();
  }
  open(id: string): Promise<DocxSession> {
    const existing = this.get(id);
    if (existing) return Promise.resolve(existing);
    let task = this.pending.get(id);
    if (task) return task;
    const tab = this.tab(id);
    if (!tab || !this.accepts(tab)) return Promise.reject(Error('The document is no longer open.'));
    const file = tab.document.path;
    task = this.ports.read(file, { ...tab.document.diskVersion }).then(async source => {
      // Main verified the content when the tab opened and verifies the bytes it hands over again: a spreadsheet or a
      // legacy binary document under a .docx name would open as an empty page and could then be saved over.
      if (!source.word) throw new NotWordDocumentError();
      const runtime = await this.ports.runtime();
      const current = this.tab(id);
      if (this.pending.get(id) !== task || !current || current.document.path !== file) throw Error('The document is no longer open.');
      const engine = runtime.openDocx(source.bytes, { mode: this.mode(id) });
      const session: DocxSession = { engine, path: file, edits: 0, savedEdits: 0, busy: false };
      engine.onEdit(() => {
        if (this.entries.get(id) !== session) return;
        session.edits++; session.error = undefined; this.lastEditAt = Date.now();
        const edited = this.tab(id);
        if (edited) edited.revision++;
        this.notify();
      });
      this.entries.set(id, session);
      this.notify();
      return session;
    }).finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); });
    this.pending.set(id, task);
    return task;
  }
  history(id: string, action: 'undo' | 'redo') { this.get(id)?.engine.run(action === 'undo' ? 'history.undo' : 'history.redo'); }
  fail(id: string, error: unknown) { const session = this.get(id); if (session) { session.error = error instanceof Error ? error.message : String(error); this.notify(); } }
  /** The edited document as a complete package, for recovery snapshots. */
  async backup(id: string): Promise<Uint8Array> {
    const session = this.get(id);
    if (!session) throw Error('Document recovery is unavailable. Save the document to protect your edits.');
    return session.engine.serialize();
  }
  /** A surface was unmounted. An unedited document is freed and read again from disk when it is next shown. */
  evict(id: string) {
    const session = this.entries.get(id);
    if (!session) return;
    // A surface that is being replaced (Save As renames the tab) mounts the same engine again a few
    // tasks later, after its component has loaded; only an engine nobody came back for is freed.
    setTimeout(() => {
      if (this.entries.get(id) !== session || session.engine.mounted() || session.busy || session.edits !== session.savedEdits) return;
      this.entries.delete(id); session.engine.destroy();
    }, EVICTION_GRACE_MS);
  }
  private drop(id: string) {
    const session = this.entries.get(id);
    this.entries.delete(id); this.pending.delete(id);
    session?.engine.destroy();
  }
  accepts(tab: DocumentTab) { return isWordEditorDocument(tab.document); }
  text() { return ''; }
  dirty(tab: DocumentTab) { const session = this.entries.get(tab.id); return !!session && session.edits !== session.savedEdits; }
  saved() {}
  /** The file was reloaded from disk: the edited state is discarded and the surface opens the new bytes. */
  replace(tab: DocumentTab) {
    this.drop(tab.id);
    // The caller assigns the reloaded snapshot right after this returns; surfaces reopen against it.
    queueMicrotask(() => this.notify());
  }
  retarget(tab: DocumentTab) { const session = this.entries.get(tab.id); if (session) { session.path = tab.document.path; this.notify(); } }
  release(id: string) {
    const known = this.entries.has(id) || this.pending.has(id) || this.modes.has(id);
    this.drop(id); this.modes.delete(id);
    if (known) this.notify();
  }
  releaseAll() {
    for (const session of this.entries.values()) session.engine.destroy();
    this.entries.clear(); this.pending.clear(); this.modes.clear();
  }
  async save(tab: DocumentTab, saveAs = false): Promise<SaveResult> {
    const session = this.get(tab.id);
    if (!session || session.busy || (session.edits === session.savedEdits && !saveAs)) return { canceled: true };
    session.busy = true; session.error = undefined; this.notify();
    try {
      // Starting a save commits input the engine was still holding and then captures the document,
      // so the edit count is read after the call and before anything else can run.
      const serializing = session.engine.serialize();
      const edits = session.edits, revision = tab.revision;
      const bytes = await serializing;
      const result = await this.ports.save({ document: structuredClone(tab.document), bytes, revision, saveAs });
      // Edits committed while the file was being written stay unsaved.
      if (result.document && !result.canceled && this.entries.get(tab.id) === session) { session.savedEdits = edits; session.path = result.document.path; }
      return result;
    } catch (error) { session.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { session.busy = false; this.notify(); }
  }
}
export const docxSessions = new DocxSessions();
