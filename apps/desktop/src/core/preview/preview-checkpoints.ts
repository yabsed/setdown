/** One trailing idle timer and one non-resetting checkpoint per document. */
export class PreviewCheckpoints {
  private readonly pending = new Map<string, {
    idle?: ReturnType<typeof setTimeout>;
    checkpoint?: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly execute: (id: string) => void,
    private readonly idleMs = 150, private readonly checkpointMs = 500) {}

  schedule(id: string, immediate = false): void {
    const timers = this.pending.get(id) ?? {};
    clearTimeout(timers.idle);
    const run = () => {
      if (this.pending.get(id) !== timers) return;
      this.cancel(id);
      this.execute(id);
    };
    timers.idle = setTimeout(run, immediate ? 0 : this.idleMs);
    timers.checkpoint ??= setTimeout(run, this.checkpointMs);
    this.pending.set(id, timers);
  }

  cancel(id: string): void {
    const timers = this.pending.get(id);
    if (!timers) return;
    clearTimeout(timers.idle);
    clearTimeout(timers.checkpoint);
    this.pending.delete(id);
  }

  clear(): void { for (const id of this.pending.keys()) this.cancel(id); }
}
