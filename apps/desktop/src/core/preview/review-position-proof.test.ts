import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ReviewPositionProof, type ReviewPositionState, type ReviewPositionTarget } from './review-position-proof';

const target = (): ReviewPositionTarget => ({ sourceSide: 'after', sourceLine: 120, topRatio: .7,
  band: [{ sourceLine: 118, yRatio: .2 }, { sourceLine: 120, yRatio: .7 }], blockOffset: .1 });
const state = (): ReviewPositionState => ({ revision: 2, layoutGeneration: 3, width: 800, height: 600,
  scale: 1, scrollTop: 1500, scrollLeft: 0 });
test('only a successfully recorded exact page state permits a warm no-op', () => {
  const proof = new ReviewPositionProof();
  assert.equal(proof.matches(target(), state()), false);
  proof.remember(target(), state());
  assert.equal(proof.matches(target(), state()), true);
});
for (const key of ['revision', 'layoutGeneration', 'width', 'height', 'scale', 'scrollTop', 'scrollLeft'] as const) {
  test(`a changed ${key} rejects the previous preparation`, () => {
    const proof = new ReviewPositionProof(); proof.remember(target(), state());
    const changed = state(); changed[key] += 1;
    assert.equal(proof.matches(target(), changed), false);
  });
}
for (const change of ['sourceSide', 'sourceLine', 'topRatio', 'band', 'blockOffset'] as const) {
  test(`a different ${change} is never retroactively certified`, () => {
    const proof = new ReviewPositionProof(); proof.remember(target(), state());
    const changed = target();
    if (change === 'sourceSide') changed.sourceSide = 'before';
    else if (change === 'band') changed.band = [{ sourceLine: 1, yRatio: .2 }];
    else changed[change] += 1;
    assert.equal(proof.matches(changed, state()), false);
  });
}
test('recording snapshots values rather than holding mutable request/bounds references', () => {
  const proof = new ReviewPositionProof(), request = target(), layout = state();
  proof.remember(request, layout);
  request.sourceLine = 1;
  (request.band[0] as { sourceLine: number }).sourceLine = 1;
  layout.width = 500;
  assert.equal(proof.matches(target(), state()), true);
  assert.equal(proof.matches(request, layout), false);
});
test('content, font or resource invalidation revokes an otherwise matching proof', () => {
  const proof = new ReviewPositionProof(); proof.remember(target(), state()); proof.invalidate();
  assert.equal(proof.matches(target(), state()), false);
});
test('an A/B id reused by a new page has no inherited proof', () => {
  const old = new ReviewPositionProof(); old.remember(target(), state());
  assert.equal(new ReviewPositionProof().matches(target(), state()), false);
});
for (const broken of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`invalid width ${broken} never becomes presentation-ready`, () => {
    const proof = new ReviewPositionProof(), geometry = { ...state(), width: broken };
    proof.remember(target(), geometry);
    assert.equal(proof.matches(target(), geometry), false);
  });
}
