import type { TerminalSize } from '../../protocol/terminal';

const same = (a: TerminalSize, b: TerminalSize) => a.cols === b.cols && a.rows === b.rows;

/** Keep shell redraws inside the old wider grid before shrinking/reflowing it. */
export class TerminalResize {
  private ptySize: TerminalSize;
  private generation = 0;
  private pending: TerminalSize | null = null;
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private applying = 0;
  private disposed = false;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly options: {
    size(): TerminalSize;
    notify(size: TerminalSize): void;
    apply(size: TerminalSize, current: () => boolean): Promise<boolean>;
  }) { this.ptySize = { ...options.size() }; }

  request(size: TerminalSize): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.cancelTimers();
    this.pending = null;
    if (same(size, this.options.size()) && same(size, this.ptySize)) { this.resolve(); return; }
    if (size.cols < this.options.size().cols) {
      this.pending = { ...size };
      this.quiet = setTimeout(() => this.commitPending(), 30);
      // A streaming or unresponsive process must not leave the grid unfitted.
      this.deadline = setTimeout(() => this.commitPending(), 150);
      this.notify(size);
    } else {
      this.commit({ ...size }, generation);
    }
  }

  output(): void {
    if (!this.pending) return;
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.commitPending(), 30);
  }

  get busy(): boolean { return !!this.pending || this.applying > 0; }
  settled(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise(resolve => this.waiters.add(resolve));
  }

  private notify(size: TerminalSize): void {
    if (same(size, this.ptySize)) return;
    this.ptySize = { ...size };
    this.options.notify(size);
  }
  private commitPending(): void {
    const size = this.pending;
    this.pending = null;
    this.cancelTimers();
    if (size) this.commit(size, this.generation);
  }
  private commit(size: TerminalSize, generation: number): void {
    this.applying++;
    const current = () => !this.disposed && generation === this.generation;
    void this.options.apply(size, current).then(applied => {
      if (applied && current()) this.notify(size);
    }, error => { if (!this.disposed) console.error('Terminal resize failed:', error); })
      .finally(() => { this.applying--; this.resolve(); });
  }
  private cancelTimers(): void {
    clearTimeout(this.quiet); clearTimeout(this.deadline);
    this.quiet = this.deadline = undefined;
  }
  private resolve(): void {
    if (!this.disposed && (this.pending || this.applying)) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending = null;
    this.cancelTimers(); this.resolve();
  }
}
