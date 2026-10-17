import { ImageHistory, initialRecipe, validRecipe, type ImageRecipe } from '../../core/image/image-recipe';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import type { DocumentContentOwner } from '../ports/document-content';
import type { ImageEditApi, ImageSource } from '../../protocol/image-edit';
import type { SaveResult } from '../../protocol/desktop-api';

export type ImageSession = { source: ImageSource; history: ImageHistory; path: string; busy: boolean; error?: string };
/** The workspace owns these sessions. Media-cache eviction only disposes views. */
class ImageSessions implements DocumentContentOwner {
  private entries = new Map<string, ImageSession>();
  private pending = new Map<string, Promise<ImageSession>>();
  private listeners = new Set<() => void>();
  private tabs: () => DocumentTab[] = () => [];
  private changed: () => void = () => {};
  private api!: ImageEditApi;
  saveFromToolbar: (id: string, saveAs: boolean) => Promise<unknown> = async () => {};
  configure(api: ImageEditApi, tabs: () => DocumentTab[], changed: () => void) { this.api = api; this.tabs = tabs; this.changed = changed; }
  subscribe(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  private notify() { for (const fn of this.listeners) fn(); this.changed(); }
  get(id: string): ImageSession | undefined {
    const tab = this.tabs().find(t => t.id === id);
    if (!tab) return;
    return this.entries.get(id) ?? [...this.entries.values()].find(s => s.path === tab.document.path);
  }
  async open(id: string): Promise<ImageSession> {
    const existing = this.get(id); if (existing) { this.entries.set(id, existing); return existing; }
    const tab = this.tabs().find(t => t.id === id);
    if (!tab) throw Error('The image is no longer open.');
    const file = tab.document.path;
    let task = this.pending.get(file);
    if (!task) {
      task = this.api.open(file, { ...tab.document.diskVersion }).then(source => {
        if (this.pending.get(file) !== task || !this.tabs().some(t => t.document.path === file)) {
          this.api.release(source.id); throw Error('The image is no longer open.');
        }
        const session = { source, path: file, history: new ImageHistory(initialRecipe(source.width, source.height, source.format)), busy: false };
        for (const t of this.tabs()) if (t.document.path === file) this.entries.set(t.id, session);
        this.notify(); return session;
      }).finally(() => { if (this.pending.get(file) === task) this.pending.delete(file); });
      this.pending.set(file, task);
    }
    return task;
  }
  edit(id: string, recipe: ImageRecipe) {
    const s = this.get(id);
    if (!s || !validRecipe(recipe, s.source.width, s.source.height)) throw Error('Invalid crop or output dimensions.');
    if (s.history.commit(recipe)) this.revised(s);
  }
  undo(id: string) { const s = this.get(id); if (s?.history.undo()) this.revised(s); }
  redo(id: string) { const s = this.get(id); if (s?.history.redo()) this.revised(s); }
  private revised(s: ImageSession) { for (const tab of this.tabs()) if (this.get(tab.id) === s) tab.revision++; this.notify(); }
  async renderDetail(id: string, recipe: ImageRecipe) {
    const s = this.get(id); if (!s) throw Error('The image is no longer open.');
    return this.api.render(s.source.id, recipe);
  }
  fail(id: string, error: unknown) { const s = this.get(id); if (s) { s.error = String(error); this.notify(); } }
  accepts(tab: DocumentTab) { return tab.document.kind === 'image'; }
  text() { return ''; }
  dirty(tab: DocumentTab) { return this.get(tab.id)?.history.dirty ?? false; }
  saved() {}
  replace(tab: DocumentTab) {
    const s = this.get(tab.id);
    if (s) { for (const [id, entry] of this.entries) if (entry === s) this.entries.delete(id); this.api.release(s.source.id); }
    this.pending.delete(tab.document.path); this.notify();
  }
  retarget(tab: DocumentTab) { const s = this.entries.get(tab.id); if (s) { s.path = tab.document.path; this.notify(); } }
  release(id: string) {
    const s = this.entries.get(id); this.entries.delete(id);
    if (s && ![...this.entries.values()].includes(s)) this.api.release(s.source.id);
    for (const file of this.pending.keys()) if (!this.tabs().some(t => t.id !== id && t.document.path === file)) this.pending.delete(file);
    this.notify();
  }
  releaseAll() { for (const s of new Set(this.entries.values())) this.api.release(s.source.id); this.entries.clear(); this.pending.clear(); }
  async save(tab: DocumentTab, saveAs = false): Promise<SaveResult> {
    const s = this.get(tab.id);
    if (!s || s.busy || (!s.history.dirty && !saveAs)) return { canceled: true };
    const recipe = structuredClone(s.history.current), revision = tab.revision;
    s.busy = true; s.error = undefined; this.notify();
    try {
      const result = await this.api.save({ sourceId: s.source.id, document: structuredClone(tab.document), recipe, revision, saveAs });
      if (result.document && !result.canceled && this.get(tab.id) === s) {
        s.history.saved(recipe); s.path = result.document.path;
        // Same-file views share the saved disk checkpoint and original source.
        for (const other of this.tabs()) if (other !== tab && this.get(other.id) === s)
          other.document = { ...result.document, revision: other.revision };
      }
      return result;
    } catch (error) { s.error = String(error); throw error; }
    finally { s.busy = false; this.notify(); }
  }
}
export const imageSessions = new ImageSessions();
