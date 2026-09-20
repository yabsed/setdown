/** One explicit Source -> Viewer intent. Actual visibility stays in the caller.
 * The notice timer never delays completion. Completing keeps the generation
 * valid for the existing post-show native-position verification.
 */
export class ReviewTransition {
  private request: { tabId: string; generation: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  constructor(private readonly changed: (state: { pending: boolean; notice: boolean; error: string }) => void,
    private readonly noticeMs = 200) {}

  get generation(): number { return this.epoch; }
  forTab(tabId: string): boolean { return this.request?.tabId === tabId; }

  begin(tabId: string): void {
    if (this.forTab(tabId)) return;
    this.cancel();
    const request = { tabId, generation: this.epoch };
    this.request = request;
    this.changed({ pending: true, notice: false, error: '' });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.request === request) this.changed({ pending: true, notice: true, error: '' });
    }, this.noticeMs);
  }

  complete(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.request = null;
    this.changed({ pending: false, notice: false, error: '' });
  }

  cancel(): void { this.epoch += 1; this.complete(); }
  fail(error: string): void {
    this.cancel();
    this.changed({ pending: false, notice: false, error });
  }
}
