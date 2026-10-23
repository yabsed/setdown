import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { DocumentSnapshot } from '../../core/document/document';
import type { HwpApi, HwpState } from '../../protocol/hwp';
import type { DocumentContentOwner } from '../ports/document-content';

/** Runtime ownership outlives surface visibility; no media cache eviction. */
export class HwpSessions implements DocumentContentOwner {
  private api!: HwpApi;
  private states = new Map<string, HwpState>();
  private pending = new Map<string, Promise<HwpState>>();
  private saving = new Set<string>();
  private listeners = new Set<() => void>();
  private tabs: () => readonly DocumentTab[] = () => [];
  private changed = () => {};
  configure(api: HwpApi, tabs: () => readonly DocumentTab[], changed: () => void) {
    this.api = api; this.tabs = tabs; this.changed = changed;
    return api.onState(state => this.update(state));
  }
  private update(state: HwpState) {
    const tab = this.tabs().find(tab => tab.id === state.id && this.accepts(tab));
    if (!tab || (state.path !== tab.document.path && !this.saving.has(tab.id))) return;
    const previous = this.states.get(state.id);
    if (previous?.generation === state.generation && (previous.revision > state.revision || (previous.ready && !state.ready && !state.error))) return;
    this.states.set(state.id, state); tab.revision = state.revision;
    this.changed(); for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  state(id: string) { return this.states.get(id); }
  accepts = (tab: DocumentTab) => tab.document.kind === 'hwp';
  text = () => '';
  dirty = (tab: DocumentTab) => { const state = this.states.get(tab.id); return state ? state.revision !== state.savedRevision : tab.revision !== tab.document.savedRevision; };
  async ensure(tab: DocumentTab): Promise<HwpState> {
    const existing = this.states.get(tab.id); if (existing) return existing;
    const pending = this.pending.get(tab.id); if (pending) return pending;
    const promise: Promise<HwpState> = this.api.open(tab.id, JSON.parse(JSON.stringify(tab.document))).then(state => { if (this.pending.get(tab.id) === promise) this.update(state); return this.states.get(tab.id) ?? state; })
      .finally(() => { if (this.pending.get(tab.id) === promise) this.pending.delete(tab.id); });
    this.pending.set(tab.id, promise); return promise;
  }
  save = async (tab: DocumentTab, saveAs = false) => {
    await this.ensure(tab); this.saving.add(tab.id);
    try { return await this.api.save(tab.id, saveAs); } finally { this.saving.delete(tab.id); }
  };
  saved = () => {}; // Only the runtime's exact exported revision is acknowledged.
  replace(tab: DocumentTab, snapshot: DocumentSnapshot) {
    this.states.delete(tab.id);
    void this.api.reload(tab.id, JSON.parse(JSON.stringify(snapshot))).then(state => this.update(state)).catch(error => this.fail(tab.id, error));
  }
  retarget(tab: DocumentTab) { void this.api.retarget(tab.id, JSON.parse(JSON.stringify(tab.document))).catch(error => this.fail(tab.id, error)); }
  fail(id: string, error: unknown) {
    const state = this.states.get(id) ?? { id, path: this.tabs().find(tab => tab.id === id)?.document.path ?? '', generation: '', revision: 0, savedRevision: 0, ready: false };
    this.update({ ...state, error: String(error) });
  }
  release(id: string) { this.states.delete(id); this.pending.delete(id); this.api.release(id); }
  releaseAll() { for (const id of this.states.keys()) this.release(id); }
}
export const hwpSessions = new HwpSessions();
