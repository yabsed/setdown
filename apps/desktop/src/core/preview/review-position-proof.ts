export type ReviewPositionTarget = {
  sourceSide: 'before' | 'after'; sourceLine: number; topRatio: number;
  band: readonly { sourceLine: number; yRatio: number }[]; blockOffset: number;
};
export type ReviewPositionState = {
  revision: number; layoutGeneration: number; width: number; height: number;
  scale: number; scrollTop: number; scrollLeft: number;
};
const targetKey = (target: ReviewPositionTarget): string => JSON.stringify([
  target.sourceSide, target.sourceLine, target.topRatio, target.blockOffset,
  target.band.map((sample) => [sample.sourceLine, sample.yRatio]),
]);
const valid = (state: ReviewPositionState) => Object.values(state).every(Number.isFinite)
  && state.revision >= 0 && state.width > 0 && state.height > 0 && state.scale > 0;

/** Page-local proof, issued synchronously AFTER positioning, never from an ACK.
 * Values are copied at issue time: later target/geometry mutation cannot certify
 * a different request. A new page starts empty even when its A/B ID is reused.
 */
export class ReviewPositionProof {
  private proof: { target: string; state: Readonly<ReviewPositionState> } | null = null;
  invalidate(): void { this.proof = null; }
  remember(target: ReviewPositionTarget, state: ReviewPositionState): void {
    this.proof = valid(state) ? { target: targetKey(target), state: Object.freeze({ ...state }) } : null;
  }
  matches(target: ReviewPositionTarget, state: ReviewPositionState): boolean {
    const proof = this.proof;
    return !!proof && valid(state) && proof.target === targetKey(target)
      && (Object.keys(state) as Array<keyof ReviewPositionState>).every((key) => proof.state[key] === state[key]);
  }
}
