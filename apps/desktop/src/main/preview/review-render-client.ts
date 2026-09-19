import { utilityProcess } from 'electron';
import type { ReviewRowsPatch } from '../../core/preview/review-row-patch';

export type ReviewAssembly = {
  originalHtml: string;
  modifiedHtml: string;
  template?: string;
  needsTemplate: boolean;
  pageKey: string;
  baseRevision: number | null;
  revision: number;
};
export type ReviewAssemblyResult = { supported: boolean; html?: string; template?: string; patch?: ReviewRowsPatch };

/** Main owns IPC bookkeeping; HTML parsing/alignment never executes here. */
export class ReviewRenderClient {
  private worker: Electron.UtilityProcess | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve(value: ReviewAssemblyResult): void;
    reject(error: Error): void;
  }>();

  constructor(private readonly workerPath: string) {}

  forget(pageKey: string): void {
    try { this.worker?.postMessage({ kind: 'forget', pageKey }); } catch { /* Worker exit discards its cache. */ }
  }

  seed(sourceKey: string, targetKey: string, revision: number): void {
    // Same-worker ordering places this before the target's next assembly.
    try { this.worker?.postMessage({ kind: 'seed', sourceKey, targetKey, revision }); } catch { /* Cache miss is safe. */ }
  }

  assemble(input: ReviewAssembly): Promise<ReviewAssemblyResult> {
    if (!this.worker) {
      const worker = utilityProcess.fork(this.workerPath);
      this.worker = worker;
      worker.on('message', (reply: { id: number; ok: boolean; error?: string } & ReviewAssemblyResult) => {
        const request = this.pending.get(reply.id);
        if (!request) return;
        this.pending.delete(reply.id);
        if (reply.ok) request.resolve(reply);
        else request.reject(new Error(reply.error ?? 'Rendered comparison failed.'));
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const request of this.pending.values()) request.reject(new Error('Comparison worker stopped.'));
        this.pending.clear();
      });
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, ...input }); }
      catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}
