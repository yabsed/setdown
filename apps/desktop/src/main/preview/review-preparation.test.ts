import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { PreviewViewState } from './preview-manager';
import { ReviewPreparation } from './review-preparation';

function fixture() {
  let visible = false;
  const calls: Array<Record<string, unknown>> = [];
  const view = { ownerWebContentsId: 7, view: {
    getVisible: () => visible,
    setVisible() { throw new Error('Prewarming may not change visibility'); },
    webContents: { isDestroyed: () => false, getURL: () => 'marktex-preview://document/existing',
      focus() { throw new Error('Prewarming may not focus'); },
      send(_name: string, value: Record<string, unknown>) { calls.push(value); } },
  } } as unknown as PreviewViewState;
  const manager = new ReviewPreparation({ views: new Map([['r', view]]), navigating: () => false,
    applyBounds: (_view, bounds) => calls.push({ command: 'bounds', ...bounds }) });
  const prime = () => manager.command(7, 'r', { command: 'marktex:prime-review',
    bounds: { x: 10, y: 80, width: 900, height: 600 },
    position: { sourceLine: 120, sourceSide: 'before', topRatio: .8, band: [] } });
  return { manager, calls, prime, show: () => { visible = true; } };
}

test('hidden prime sets bounds then position without focus or visibility changes', () => {
  const f = fixture(); f.prime();
  assert.deepEqual(f.calls.map((call) => call.command), ['bounds', 'marktex:prime-position']);
  assert.equal(f.calls[1].sourceSide, 'before'); assert.equal(f.calls[1].topRatio, .8);
});
test('a visible front rejects late prime commands', () => {
  const f = fixture(); f.show(); f.prime(); assert.equal(f.calls.length, 0);
});
test('ready requires the matching revision and preparation token', async () => {
  const f = fixture(); f.prime();
  let completed = false;
  const work = f.manager.prepare(7, 'r', 10).then(() => { completed = true; });
  const command = f.calls.at(-1)!;
  f.manager.receive('r', { type: 'marktex:review-prepared', revision: 9, requestId: command.requestId });
  await Promise.resolve(); assert.equal(completed, false);
  f.manager.receive('r', { type: 'marktex:review-prepared', revision: 10, requestId: command.requestId });
  await work; assert.equal(completed, true);
});
test('close rejects the pending preparation', async () => {
  const f = fixture(); f.prime();
  const work = f.manager.prepare(7, 'r', 10);
  const rejection = assert.rejects(work, /closed/);
  f.manager.forget('r'); await rejection;
});
test('preparation timeout is failure, not readiness', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    f.prime(); const work = f.manager.prepare(7, 'r', 10);
    const rejection = assert.rejects(work, /did not acknowledge/);
    await vi.advanceTimersByTimeAsync(5000); await rejection;
  } finally { f.manager.forget('r'); vi.useRealTimers(); }
});
test('invalid geometry and wrong owner never authorize preparation', async () => {
  const f = fixture();
  f.manager.command(8, 'r', { command: 'marktex:prime-review', bounds: { x: 0, y: 0, width: 800, height: 500 }, position: { sourceLine: 1 } });
  await f.manager.prepare(8, 'r', 1); assert.equal(f.calls.length, 0);
  f.manager.command(7, 'r', { command: 'marktex:prime-review', bounds: { x: 0, y: 0, width: 0, height: 500 }, position: { sourceLine: 1 } });
  await f.manager.prepare(7, 'r', 1); assert.equal(f.calls.length, 0);
});
