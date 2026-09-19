import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readReviewBookmark, reviewPositionCommand, reviewViewport } from './review-viewport';

test('invalid viewport payloads cannot inject non-finite positions', () => {
  for (const value of [null, '', {}, { sourceLine: NaN, yRatio: 0 },
    { sourceLine: 10, yRatio: Infinity }, { sourceLine: -1, yRatio: .5 }]) {
    assert.equal(readReviewBookmark(value), null);
  }
});
test('bookmark parsing preserves source side and within-block reading offset', () => {
  const value = readReviewBookmark({ sourceLine: 100, sourceColumn: 4, yRatio: .7,
    sourceSide: 'before', blockOffset: .8 });
  assert.equal(value?.sourceSide, 'before'); assert.equal(value?.blockOffset, .8);
  assert.equal(value?.anchor.sourceColumn, 4); assert.deepEqual(value?.band, []);
});
test('bookmark bounds are sanitized and unknown source sides default to after', () => {
  const value = readReviewBookmark({ sourceLine: 100.4, yRatio: 2, blockOffset: -5, sourceSide: 'bad' });
  assert.equal(value?.anchor.sourceLine, 100); assert.equal(value?.anchor.yRatio, 1);
  assert.equal(value?.blockOffset, 0); assert.equal(value?.sourceSide, 'after');
});
test('source position commands remain nonsettling and carry visible-band samples', () => {
  const viewport = reviewViewport(100); viewport.anchor.yRatio = .8;
  viewport.band = [{ sourceLine: 100, yRatio: .8 }];
  const command = reviewPositionCommand(viewport);
  assert.equal(command.settle, false); assert.equal(command.topRatio, .8);
  assert.deepEqual(command.band, viewport.band); assert.equal(command.sourceSide, 'after');
});
