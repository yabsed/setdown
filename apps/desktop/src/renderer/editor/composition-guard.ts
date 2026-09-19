/** Shared only inside this renderer. Native EditContext composition need not bubble through the DOM. */
const composingEditors = new Set<CompositionGuard>();

export function isComposingInput(event?: { isComposing?: boolean; keyCode?: number }): boolean {
  return composingEditors.size > 0 || event?.isComposing === true || event?.keyCode === 229;
}

/** Protects an IME transaction and invalidates asynchronous, programmatic navigation. */
export class CompositionGuard {
  private epoch = 0;
  private ending: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly settled: () => void) {}

  get active(): boolean { return composingEditors.has(this); }

  start(): void {
    if (this.disposed) return;
    if (this.ending !== null) clearTimeout(this.ending);
    this.ending = null;
    composingEditors.add(this);
    this.interrupt();
  }

  end(): void {
    if (this.disposed || !this.active) return;
    if (this.ending !== null) clearTimeout(this.ending);
    // Let the final model/input event and the IME's terminating key finish first.
    // A following syllable can start before this task; start() cancels this release.
    this.ending = setTimeout(() => {
      this.ending = null;
      composingEditors.delete(this);
      this.settled();
    }, 0);
  }

  interrupt(): void { this.epoch += 1; }

  navigationTicket(): () => boolean {
    const epoch = this.epoch;
    return () => !this.disposed && !this.active && epoch === this.epoch;
  }

  dispose(): void {
    this.disposed = true;
    this.interrupt();
    if (this.ending !== null) clearTimeout(this.ending);
    this.ending = null;
    composingEditors.delete(this);
  }
}
