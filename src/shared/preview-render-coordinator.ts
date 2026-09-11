export type PreviewRenderExecutor = (revision: number) => Promise<boolean>;

/**
 * Preview 요청을 하나의 실행 흐름으로 합친다.
 *
 * 이미 시작한 렌더는 끝까지 기다리되, 그동안 들어온 중간 revision은 버리고
 * 가장 최근 요청 하나만 다음 작업으로 실행한다. executor의 true는 해당
 * revision이 iframe에 정상적으로 load됐다는 뜻이다.
 */
export class PreviewRenderCoordinator {
  readyRevision: number | null = null;
  inFlightRevision: number | null = null;

  private epoch = 0;
  private inFlightEpoch: number | null = null;
  private requested: { revision: number; epoch: number } | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly execute: PreviewRenderExecutor) {}

  get isRendering(): boolean {
    return this.loopPromise !== null;
  }

  reset() {
    this.epoch += 1;
    this.readyRevision = null;
    this.requested = null;
  }

  async ensure(revision: number): Promise<boolean> {
    if (this.readyRevision === revision) return true;

    if (this.inFlightRevision !== revision || this.inFlightEpoch !== this.epoch) {
      this.requested = { revision, epoch: this.epoch };
    }
    if (!this.loopPromise) {
      const loop = this.runLoop();
      this.loopPromise = loop;
      void loop.finally(() => {
        if (this.loopPromise === loop) this.loopPromise = null;
      });
    }

    await this.loopPromise;
    return this.readyRevision === revision;
  }

  private async runLoop() {
    while (this.requested !== null) {
      const { revision, epoch } = this.requested;
      this.requested = null;
      if (this.readyRevision === revision) continue;

      this.inFlightRevision = revision;
      this.inFlightEpoch = epoch;
      const loaded = await this.execute(revision);
      if (loaded && epoch === this.epoch) this.readyRevision = revision;
    }
    this.inFlightRevision = null;
    this.inFlightEpoch = null;
  }
}
