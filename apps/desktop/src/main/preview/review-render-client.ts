import { utilityProcess } from 'electron';

export type ReviewAssembly = {
  originalHtml: string;
  modifiedHtml: string;
  template: string;
  needsTemplate: boolean;
};
export type ReviewAssemblyResult = { supported: boolean; html?: string; template?: string };

/** Main owns IPC bookkeeping; HTML parsing/alignment never executes here. */
export class ReviewRenderClient {
  private worker: Electron.UtilityProcess | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve(value: ReviewAssemblyResult): void;
    reject(error: Error): void;
  }>();

  constructor(private readonly workerPath: string) {}

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
