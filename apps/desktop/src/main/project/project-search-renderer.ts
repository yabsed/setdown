import { utilityProcess } from 'electron';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import type { VisibleSearchMatch } from './visible-search';
import type { MemoryPressure } from '../../core/memory/memory-policy';

type Reply = {
  kind?: string;
  id?: number;
  ok?: boolean;
  message?: string;
  matches?: VisibleSearchMatch[];
};

export class ProjectSearchRenderer {
  private worker: Electron.UtilityProcess | null = null;
  private lastUsed = Date.now();
  get running() { return !!this.worker; }
  reclaim(pressure: MemoryPressure) {
    if (this.waiters.size || Date.now() - this.lastUsed < (pressure === 'normal' ? 120_000 : 15_000)) return;
    const worker = this.worker; this.worker = null; worker?.kill();
  }
  private requestId = 0;
  private readonly waiters = new Map<number, {
    resolve(value: VisibleSearchMatch[]): void;
    reject(error: Error): void;
  }>();

  constructor(
    private readonly workerPath: string,
    private readonly theme: () => PreviewThemeId,
  ) {}

  search(
    documentPath: string,
    text: string,
    query: string,
    limit: number,
    root: string,
  ): Promise<VisibleSearchMatch[]> {
    const worker = this.ensureWorker();
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      worker.postMessage({
        kind: 'search', id, documentPath, text, query, limit,
        themeId: this.theme(), roots: [root],
      });
    });
  }

  private ensureWorker() {
    this.lastUsed = Date.now();
    if (this.worker) return this.worker;
    const worker = utilityProcess.fork(this.workerPath);
    this.worker = worker;
    worker.on('message', (reply: Reply) => {
      if (reply?.kind !== 'search' || typeof reply.id !== 'number') return;
      const waiter = this.waiters.get(reply.id);
      if (!waiter) return;
      this.lastUsed = Date.now();
      this.waiters.delete(reply.id);
      if (!reply.ok) waiter.reject(new Error(String(reply.message ?? 'Project search failed.')));
      else waiter.resolve(Array.isArray(reply.matches) ? reply.matches : []);
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const waiter of this.waiters.values()) {
        waiter.reject(new Error('The project search renderer stopped.'));
      }
      this.waiters.clear();
    });
    return worker;
  }
}
