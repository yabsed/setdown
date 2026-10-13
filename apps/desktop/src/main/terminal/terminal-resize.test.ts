import { afterEach, expect, test, vi } from 'vitest';
import { TerminalResize } from './terminal-resize';
import type { TerminalSize } from '../../protocol/terminal';

const disposables: TerminalResize[] = [];
afterEach(() => { for (const item of disposables.splice(0)) item.dispose(); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers();
  let size = { cols: 110, rows: 40 };
  const events: string[] = [];
  const resize = new TerminalResize({ size: () => size,
    notify: next => events.push(`pty:${next.cols}x${next.rows}`),
    apply: async (next, current) => {
      await Promise.resolve();
      if (!current()) return false;
      size = next; events.push(`grid:${next.cols}x${next.rows}`); return true;
    } });
  disposables.push(resize);
  const request = (cols: number, rows = 40) => resize.request({ cols, rows });
  return { resize, events, request, size: () => size };
}
test('shrink notifies the PTY before reflow and waits for the redraw to finish', async () => {
  const f = fixture(); f.request(80);
  await vi.advanceTimersByTimeAsync(20); f.resize.output();
  await vi.advanceTimersByTimeAsync(29);
  expect(f.events).toEqual(['pty:80x40']);
  expect(f.size().cols).toBe(110);
  await vi.advanceTimersByTimeAsync(1); await f.resize.settled();
  expect(f.events).toEqual(['pty:80x40', 'grid:80x40']);
});
test('growth enlarges the grid before notifying the PTY', async () => {
  const f = fixture(); f.request(140, 50); await f.resize.settled();
  expect(f.events).toEqual(['grid:140x50', 'pty:140x50']);
});
test('continuous output has a bounded resize deadline', async () => {
  const f = fixture(); f.request(80);
  for (let i = 0; i < 7; i++) { await vi.advanceTimersByTimeAsync(20); f.resize.output(); }
  expect(f.events).toEqual(['pty:80x40']);
  await vi.advanceTimersByTimeAsync(10); await f.resize.settled();
  expect(f.events).toEqual(['pty:80x40', 'grid:80x40']);
});
test('new requests cancel an uninstalled grid change and retain only the latest target', async () => {
  const f = fixture(); f.request(140); f.request(80);
  await vi.advanceTimersByTimeAsync(30); await f.resize.settled();
  expect(f.events).toEqual(['pty:80x40', 'grid:80x40']);
});
test('returning to the original width cancels a pending shrink and restores the PTY', async () => {
  const f = fixture(); f.request(80); f.request(110); await f.resize.settled();
  await vi.advanceTimersByTimeAsync(200);
  expect(f.events).toEqual(['pty:80x40', 'grid:110x40', 'pty:110x40']);
});
test('unchanged dimensions do not notify the process or reflow its grid', async () => {
  const f = fixture(); f.request(110); await f.resize.settled();
  expect(f.events).toEqual([]);
});
test('close cancels pending work and releases inputs waiting on resize', async () => {
  const f = fixture(); f.request(80);
  const settled = f.resize.settled(); f.resize.dispose(); await settled;
  await vi.advanceTimersByTimeAsync(200);
  expect(f.events).toEqual(['pty:80x40']);
});
test('later caller mutations cannot change a queued target', async () => {
  const f = fixture(); const size: TerminalSize = { cols: 80, rows: 40 };
  f.resize.request(size); size.cols = 70;
  await vi.advanceTimersByTimeAsync(30); await f.resize.settled();
  expect(f.size()).toEqual({ cols: 80, rows: 40 });
});
