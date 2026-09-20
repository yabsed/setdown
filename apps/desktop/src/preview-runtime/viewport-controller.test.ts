import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { SourceAtlas } from './source-atlas';
import { ViewportController } from './viewport-controller';

afterEach(() => vi.unstubAllGlobals());

function fixture(review: boolean) {
  let next = 0;
  let scans = 0;
  const frames = new Map<number, () => void>();
  const messages: Record<string, unknown>[] = [];
  vi.stubGlobal('window', {
    innerHeight: 600,
    requestAnimationFrame(callback: () => void) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  vi.stubGlobal('document', { readyState: 'complete',
    querySelector: () => review ? {} : null,
    documentElement: { scrollTop: 200, scrollHeight: 1200 }, body: { scrollTop: 0 } });
  const anchor = () => { scans++; return { sourceLine: 20, yRatio: .372 }; };
  const controller = new ViewportController({ revision: () => 1, send: m => messages.push(m),
    sourceAtlas: { invalidate() {}, bookmarkAt: anchor, viewportAnchorAt: anchor } as unknown as SourceAtlas });
  const frame = () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  };
  controller.start();
  return { controller, frame, messages, scans: () => scans };
}

test('unobserved review updates do not measure or publish hidden math geometry', () => {
  const f = fixture(true);
  f.frame();
  f.controller.schedule(); f.frame();
  assert.equal(f.scans(), 0);
  assert.equal(f.messages.length, 0);
});

test('active review observation publishes and flushes its final bookmark before parking', () => {
  const f = fixture(true);
  f.controller.observe(7); f.frame();
  assert.equal(f.scans(), 1);
  assert.equal(f.messages[0].observationId, 7);
  f.controller.observe(null);
  assert.equal(f.scans(), 2);
  assert.equal(f.messages[1].observationId, 7);
  f.controller.schedule(); f.frame();
  assert.equal(f.scans(), 2);
});

test('ordinary documents retain unscoped viewport reporting', () => {
  const f = fixture(false);
  f.frame();
  assert.equal(f.scans(), 1);
  assert.equal(f.messages[0].observationId, null);
  assert.equal(f.messages[0].scrollRatio, 1 / 3);
});
