import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { PreviewCheckpoints } from './preview-checkpoints';

for (const kind of ['idle', 'continuous', 'immediate', 'cancel', 'independent'] as const) {
  test(`preview checkpoints: ${kind}`, async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const scheduler = new PreviewCheckpoints((id) => calls.push(id));
    try {
      scheduler.schedule('a');
      if (kind === 'idle') {
        await vi.advanceTimersByTimeAsync(149); assert.equal(calls.length, 0);
        await vi.advanceTimersByTimeAsync(1); assert.deepEqual(calls, ['a']);
        await vi.advanceTimersByTimeAsync(500); assert.equal(calls.length, 1);
      } else if (kind === 'continuous') {
        for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(100); scheduler.schedule('a'); }
        assert.equal(calls.length, 0);
        await vi.advanceTimersByTimeAsync(100); assert.deepEqual(calls, ['a']);
      } else if (kind === 'immediate') {
        scheduler.schedule('a', true); await vi.advanceTimersByTimeAsync(0);
        assert.deepEqual(calls, ['a']); await vi.advanceTimersByTimeAsync(600); assert.equal(calls.length, 1);
      } else if (kind === 'cancel') {
        scheduler.cancel('a'); await vi.advanceTimersByTimeAsync(1000); assert.equal(calls.length, 0);
      } else {
        await vi.advanceTimersByTimeAsync(100); scheduler.schedule('b');
        await vi.advanceTimersByTimeAsync(50); assert.deepEqual(calls, ['a']);
        await vi.advanceTimersByTimeAsync(100); assert.deepEqual(calls, ['a', 'b']);
      }
    } finally { scheduler.clear(); vi.useRealTimers(); }
  });
}
