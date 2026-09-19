import type { ReviewViewport } from '../../../core/preview/review-viewport';

type Reader = (tabId: string) => ReviewViewport | null;

/**
 * Renderer-local synchronous port for the Svelte-owned Monaco instance.
 * Esc reads the current viewport before hiding it; no IPC round trip, timer,
 * model writes, or stale scroll-event snapshot is involved.
 */
export class GitDiffViewportPort {
  private reader: Reader | null = null;
  private readonly sourceTargets = new Map<string, ReviewViewport>();

  register(reader: Reader): () => void {
    this.reader = reader;
    return () => { if (this.reader === reader) this.reader = null; };
  }

  read(tabId: string): ReviewViewport | null { return this.reader?.(tabId) ?? null; }
  requestSource(tabId: string, target: ReviewViewport): void { this.sourceTargets.set(tabId, target); }
  takeSourceTarget(tabId: string): ReviewViewport | null {
    const target = this.sourceTargets.get(tabId) ?? null;
    this.sourceTargets.delete(tabId);
    return target;
  }
  forget(tabId: string): void { this.sourceTargets.delete(tabId); }
}

// One workspace/Monaco instance per renderer. Does not cross window boundaries.
export const gitDiffViewport = new GitDiffViewportPort();
