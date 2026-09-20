import { expect, test } from 'vitest';
import { isRuntimePreparationCommand, readPreviewBounds } from './preview-preparation';

test('CSS bounds preserve subpixels and validate all IPC dimensions', () => {
  const box = { x: 20.25, y: 40.75, width: 650.125, height: .5 };
  expect(readPreviewBounds(box)).toEqual(box);
  for (const key of Object.keys(box)) for (const invalid of [NaN, Infinity, '1', null, undefined]) {
    expect(readPreviewBounds({ ...box, [key]: invalid })).toBeNull();
  }
  for (const width of [0, -1]) expect(readPreviewBounds({ ...box, width })).toBeNull();
  expect(readPreviewBounds(null)).toBeNull();
  expect(readPreviewBounds({ x: -2, y: 200_000, width: 200_000, height: .5 }))
    .toEqual({ x: 0, y: 100_000, width: 100_000, height: .5 });
});
test('runtime preparation distinguishes background and final presentation IDs', () => {
  const message = { command: 'marktex:prepare-review', sourceLine: 12, revision: 2, requestId: 1 };
  expect(isRuntimePreparationCommand(message)).toBe(true);
  expect(isRuntimePreparationCommand({ ...message, requestId: 'present:3' })).toBe(true);
  for (const requestId of [null, 0, -1, '1', 'present:0', 'present:old'])
    expect(isRuntimePreparationCommand({ ...message, requestId })).toBe(false);
  expect(isRuntimePreparationCommand({ ...message, revision: NaN })).toBe(false);
  expect(isRuntimePreparationCommand({ ...message, sourceLine: Infinity })).toBe(false);
  for (const invalid of [{ band: 'invalid' }, { band: [null] }, { sourceSide: 'unknown' },
    { topRatio: NaN }, { blockOffset: '0' }, { primeId: -1 }])
    expect(isRuntimePreparationCommand({ ...message, ...invalid })).toBe(false);
  expect(isRuntimePreparationCommand({ command: 'marktex:prime-position', sourceLine: 1, primeId: 0 })).toBe(true);
  expect(isRuntimePreparationCommand({ command: 'marktex:prepare-document' })).toBe(true);
});
