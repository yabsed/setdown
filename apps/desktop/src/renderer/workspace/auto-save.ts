import type { DocumentSnapshot } from '../../protocol/desktop-api';
import type { DocumentTab as WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';

export const AUTO_SAVE_DELAY = 1000;

type Options = {
  desktop: DesktopPort;
  tabs: WorkspaceTab[];
  activeId(): string | null;
  text(tab: WorkspaceTab): string;
  dirty(tab: WorkspaceTab): boolean;
  acceptSaved(tab: WorkspaceTab, document: DocumentSnapshot): Promise<void>;
  beforeSave?(tab: WorkspaceTab): Promise<void>;
  saved(document: DocumentSnapshot): void | Promise<void>;
};

/** VS Code-style afterDelay auto save: debounced, quiet and never modal. */
export class AutoSaveController {
  enabled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingTabId: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pauses = 0;
  private generation = 0;

  constructor(private readonly options: Options) {}

  setEnabled(enabled: boolean): void {
    this.generation++;
    this.enabled = enabled;
    this.cancel();
    if (enabled) void this.saveDirtyTabs();
  }

  schedule(tab: WorkspaceTab): void {
    if (this.pauses || !this.enabled || tab.id !== this.options.activeId()) return;
    if (tab.document.isUntitled || tab.document.kind !== undefined) return;
    this.cancel();
    this.pendingTabId = tab.id;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pendingTabId = null;
      this.enqueue(tab.id, true);
    }, AUTO_SAVE_DELAY);
  }

  cancel(tabId?: string): void {
    if (tabId !== undefined && tabId !== this.pendingTabId) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingTabId = null;
  }

  /** Drain in-flight saves before changing paths; a canceled timer alone is insufficient. */
  async hold(): Promise<() => void> {
    this.pauses++;
    this.cancel();
    await this.queue;
    return () => {
      this.pauses--;
      const active = this.options.tabs.find(tab => tab.id === this.options.activeId());
      if (active && this.options.dirty(active)) this.schedule(active);
    };
  }

  /** Enabling auto save writes every dirty file-backed tab immediately. */
  private async saveDirtyTabs(): Promise<void> {
    for (const tab of [...this.options.tabs]) {
      if (tab.document.isUntitled || tab.document.kind !== undefined || !this.options.dirty(tab)) continue;
      this.enqueue(tab.id, false);
    }
    await this.queue;
  }

  private enqueue(tabId: string, requireActive: boolean): void {
    const generation = this.generation;
    this.queue = this.queue.then(() => this.save(tabId, requireActive, generation));
  }

  private async save(tabId: string, requireActive: boolean, generation: number): Promise<void> {
    const canceled = () => this.pauses || !this.enabled || generation !== this.generation;
    if (canceled()) return;
    const { desktop, tabs, text, dirty, acceptSaved, saved } = this.options;
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !dirty(tab)) return;
    if (tab.document.isUntitled || tab.document.kind !== undefined) return;
    if (requireActive && tab.id !== this.options.activeId()) return;
    try {
      await this.options.beforeSave?.(tab);
      if (canceled() || !tabs.includes(tab) || (requireActive && tab.id !== this.options.activeId())) return;
      const result = await desktop.saveTabDocument(tab.document, text(tab), tab.revision, true);
      // A conflict-canceled save stays dirty; the external-change banner informs the user.
      if (result.canceled || !result.document || !tabs.includes(tab)) return;
      await acceptSaved(tab, result.document);
      await saved(result.document);
    } catch (error) {
      console.error('Auto save failed', error);
    }
  }
}
