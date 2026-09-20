import assert from 'node:assert/strict';
import { test } from 'vitest';
import { WorkspaceZoom, nativeZoomBounds } from './workspace-zoom';
import { WheelZoomAccumulator } from '../../preload/wheel-zoom';

function target(id: number) {
  const listeners = new Map<string, () => void>();
  return { id, factors: [] as number[], closed: false,
    isDestroyed() { return this.closed; },
    setZoomFactor(factor: number) { this.factors.push(factor); },
    on(event: string, fn: () => void) { listeners.set(event, fn); },
    once(event: string, fn: () => void) { listeners.set(event, fn); },
    emit(event: string) { if (event === 'destroyed') this.closed = true; listeners.get(event)?.(); },
  };
}

test('shell/front/back/another window use one scale', () => {
  const zoom = new WorkspaceZoom(); const views = [1, 2, 3, 4].map(target);
  views.forEach(view => zoom.track(view)); zoom.change(1);
  assert.ok(views.every(view => view.factors.at(-1) === 1.1));
  zoom.change(-1); assert.ok(views.every(view => view.factors.at(-1) === 1));
});
test('new views and reloads inherit scale without navigation', () => {
  const zoom = new WorkspaceZoom(); zoom.change(3); const view = target(1); zoom.track(view);
  assert.equal(view.factors.at(-1), 1.3); view.emit('did-finish-load');
  assert.equal(view.factors.at(-1), 1.3);
});
test('reset restores every view to 100%', () => {
  const zoom = new WorkspaceZoom(); const view = target(1); zoom.track(view); zoom.change(2); zoom.change(0);
  assert.equal(zoom.factor, 1); assert.equal(view.factors.at(-1), 1);
});
test('zoom clamps at 50%-300%', () => {
  const zoom = new WorkspaceZoom(); for (let i = 0; i < 100; i++) zoom.change(-4);
  assert.equal(zoom.factor, .5); for (let i = 0; i < 100; i++) zoom.change(4); assert.equal(zoom.factor, 3);
});
test('malformed IPC requests cannot change zoom', () => {
  const zoom = new WorkspaceZoom();
  for (const value of [NaN, Infinity, 1.5, 5, '1', null, {}, undefined]) assert.equal(zoom.change(value), false);
  assert.equal(zoom.factor, 1);
});
test('destroyed targets are removed and duplicate track is harmless', () => {
  const zoom = new WorkspaceZoom(); const view = target(1); zoom.track(view); zoom.track(view);
  assert.equal(view.factors.length, 1); view.emit('destroyed'); zoom.change(1);
  assert.equal(view.factors.length, 1);
});
test('a closing target does not stop updates for other targets', () => {
  const zoom = new WorkspaceZoom(); const a = target(1), b = target(2);
  a.setZoomFactor = () => { throw new Error('closed'); }; zoom.track(a); zoom.track(b); zoom.change(1);
  assert.equal(b.factors.at(-1), 1.1);
});
test('title-bar callback follows the applied scale', () => {
  const zoom = new WorkspaceZoom(); const heights: number[] = [];
  zoom.track(target(1), () => heights.push(Math.round(36 * zoom.factor)));
  zoom.change(2); assert.deepEqual(heights, [36, 43]);
});
for (const factor of [.5, 1, 1.25, 2]) test(`CSS-to-DIP conversion at ${factor}`, () => {
  assert.deepEqual(nativeZoomBounds({ x: 100, y: 80, width: 600, height: 400 }, factor),
    { x: 100 * factor, y: 80 * factor, width: 600 * factor, height: 400 * factor });
});
test('native rounding keeps adjacent edges aligned', () => {
  const a = nativeZoomBounds({ x: 0, y: 0, width: 100.5, height: 400 }, 1.25);
  const b = nativeZoomBounds({ x: 100.5, y: 0, width: 100.5, height: 400 }, 1.25);
  assert.equal(a.x + a.width, b.x);
});
test('wheel units, directions and fine trackpad accumulation', () => {
  const wheel = new WheelZoomAccumulator();
  assert.equal(wheel.consume({ deltaY: -80, deltaMode: 0 }, 0), 1);
  assert.equal(wheel.consume({ deltaY: 2, deltaMode: 1 }, 500), -1);
  assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1000), 0);
  for (let i = 1; i < 7; i++) assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1000 + i * 10), 0);
  assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1070), 1);
});
test('wheel direction reversal and idle reset discard residual motion', () => {
  const wheel = new WheelZoomAccumulator();
  wheel.consume({ deltaY: 60, deltaMode: 0 }, 0);
  assert.equal(wheel.consume({ deltaY: -40, deltaMode: 0 }, 10), 0);
  assert.equal(wheel.consume({ deltaY: -40, deltaMode: 0 }, 20), 1);
  wheel.consume({ deltaY: -60, deltaMode: 0 }, 30);
  assert.equal(wheel.consume({ deltaY: -20, deltaMode: 0 }, 400), 0);
});
test('huge or invalid deltas never flood the IPC channel', () => {
  const wheel = new WheelZoomAccumulator();
  assert.equal(wheel.consume({ deltaY: Infinity, deltaMode: 0 }, 0), 0);
  assert.equal(wheel.consume({ deltaY: -1e12, deltaMode: 0 }, 0), 4);
});
