import type { DocumentSnapshot } from '../../protocol/desktop-api';
import type { DocumentContent as WorkspaceTab } from '../../core/workspace/document-store';
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
  failed?(tab: WorkspaceTab, message: string): void;
};

/** VS Code-style afterDelay auto save: debounced, quiet and never modal. */
export class AutoSaveController {
  enabled = false;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
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
    if (this.pauses || !this.enabled) return;
    if (tab.document.isUntitled || tab.document.kind !== undefined) return;
    this.cancel(tab.id);
    this.timers.set(tab.id, setTimeout(() => {
      this.timers.delete(tab.id);
      this.enqueue(tab.id);
    }, AUTO_SAVE_DELAY));
  }

  cancel(tabId?: string): void {
    for (const [id, timer] of this.timers) {
      if (tabId !== undefined && tabId !== id) continue;
      clearTimeout(timer); this.timers.delete(id);
    }
  }

  /** Drain in-flight saves before changing paths; a canceled timer alone is insufficient. */
  async hold(): Promise<() => void> {
    this.pauses++;
    this.cancel();
    await this.queue;
    return () => {
      this.pauses--;
      for (const tab of this.options.tabs) if (this.options.dirty(tab)) this.schedule(tab);
    };
  }

  /** Enabling auto save writes every dirty file-backed tab immediately. */
  private async saveDirtyTabs(): Promise<void> {
    for (const tab of [...this.options.tabs]) {
      if (tab.document.isUntitled || tab.document.kind !== undefined || !this.options.dirty(tab)) continue;
      this.enqueue(tab.id);
    }
    await this.queue;
  }

  private enqueue(tabId: string): void {
    const generation = this.generation;
    this.queue = this.queue.then(() => this.save(tabId, generation));
  }

  private async save(tabId: string, generation: number): Promise<void> {
    const canceled = () => this.pauses || !this.enabled || generation !== this.generation;
    if (canceled()) return;
    const { desktop, tabs, text, dirty, acceptSaved, saved } = this.options;
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !dirty(tab)) return;
    if (tab.document.isUntitled || tab.document.kind !== undefined) return;
    try {
      await this.options.beforeSave?.(tab);
      if (canceled() || !this.options.tabs.includes(tab)) return;
      const result = await desktop.saveTabDocument(tab.document, text(tab), tab.revision, true);
      if (!this.options.tabs.includes(tab)) return;
      if (result.canceled || !result.document) {
        this.options.failed?.(tab, 'Auto save paused because the file changed on disk. Your edits are preserved.');
        return;
      }
      await acceptSaved(tab, result.document);
      await saved(result.document);
    } catch (error) {
      this.options.failed?.(tab, `Auto save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
