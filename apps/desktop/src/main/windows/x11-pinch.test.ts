import { expect, test, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, screen: {} }));
import { PinchScale, type PinchSample } from './x11-pinch';
import { ContentZoomInput } from '../../core/wheel-zoom';

const sample = (type: PinchSample['type'], scale = 1, device = 2): PinchSample => ({ type, scale, device, x: 10, y: 20, cancelled: false });
test('absolute XI2 scale becomes continuous, reversible tab zoom without cumulative drift', () => {
  const pinch = new PinchScale(), wheel = new ContentZoomInput();
  pinch.consume(sample('begin'));
  let factor = 1;
  for (const next of [1.05, 1.2, 2, 1.1, 1]) {
    for (const deltaY of pinch.consume(sample('update', next))) {
      const change = wheel.consume({ deltaY, deltaMode: 0 }, 100);
      expect(typeof change).toBe('object');
      if (typeof change === 'object') factor *= change.scale;
    }
    expect(factor).toBeCloseTo(next, 10);
  }
});
test('rejects invalid scales, mismatched devices and updates after cancellation or completion', () => {
  const pinch = new PinchScale();
  expect(pinch.consume(sample('update', 2))).toEqual([]);
  pinch.consume(sample('begin'));
  for (const scale of [NaN, Infinity, 0, -1, 1001]) expect(pinch.consume(sample('update', scale))).toEqual([]);
  expect(pinch.consume(sample('update', 2, 3))).toEqual([]);
  expect(pinch.consume(sample('update', 1.1)).reduce((a, b) => a + b, 0)).toBeCloseTo(-100 * Math.log(1.1));
  pinch.consume({ ...sample('update', 1.2), cancelled: true });
  expect(pinch.consume(sample('update', 2))).toEqual([]);
  pinch.consume(sample('begin')); pinch.consume(sample('end'));
  expect(pinch.consume(sample('update', 2))).toEqual([]);
});
