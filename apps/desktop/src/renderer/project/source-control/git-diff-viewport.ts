import type { ReviewViewport } from '../../../core/preview/review-viewport';

type Reader = (tabId: string) => ReviewViewport | null;

/**
 * Renderer-local synchronous port for the Svelte-owned Monaco instance.
 * Esc samples the current viewport; notifications schedule optional prewarming.
 */
export class GitDiffViewportPort {
  private reader: Reader | null = null;
  private readonly sourceTargets = new Map<string, ReviewViewport>();
  private readonly listeners = new Set<() => void>();

  register(reader: Reader): () => void {
    this.reader = reader;
    return () => { if (this.reader === reader) this.reader = null; };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  changed(): void { for (const listener of this.listeners) listener(); }
  read(tabId: string): ReviewViewport | null { return this.reader?.(tabId) ?? null; }
  requestSource(tabId: string, target: ReviewViewport): void { this.sourceTargets.set(tabId, target); }
  takeSourceTarget(tabId: string): ReviewViewport | null {
    const target = this.sourceTargets.get(tabId) ?? null;
    this.sourceTargets.delete(tabId);
    return target;
  }
  forget(tabId: string): void { this.sourceTargets.delete(tabId); }
}

export const gitDiffViewport = new GitDiffViewportPort();
