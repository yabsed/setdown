import { expect, test, vi } from 'vitest';
import { FIRST_LONG_LINE_STEP, installLongLineSteps } from './long-line-steps';

const CONTENT_TEXT = 6, GUTTER = 2;
function fixture() {
  let model: object | null = { name: 'first' };
  const mouse: ((event: unknown) => void)[] = [], changed: (() => void)[] = [];
  const updateOptions = vi.fn();
  const editor = { getModel: () => model, updateOptions,
    onMouseDown: (listener: (event: unknown) => void) => { mouse.push(listener); return { dispose: () => { mouse.length = 0; } }; },
    onDidChangeModel: (listener: () => void) => { changed.push(listener); return { dispose: () => { changed.length = 0; } }; } };
  const installed = installLongLineSteps(CONTENT_TEXT, editor as never);
  const click = async (column: number, type = CONTENT_TEXT) => {
    for (const listener of mouse) listener({ target: { type, position: { lineNumber: 1, column } } });
    // What the editor's own helper does on the same click.
    updateOptions({ stopRenderingLineAfter: -1 });
    await Promise.resolve();
  };
  const show = (next: object | null) => { model = next; for (const listener of changed) listener(); };
  return { click, show, installed, limit: () => updateOptions.mock.calls.at(-1)?.[0].stopRenderingLineAfter as number | undefined, updateOptions, mouse };
}

test('each Show more draws ten times more of the lines, never all of them', async () => {
  const f = fixture();
  await f.click(FIRST_LONG_LINE_STEP + 1);
  expect(f.limit()).toBe(100_000);
  await f.click(100_001);
  expect(f.limit()).toBe(1_000_000);
});

test('a click inside the part already drawn, or outside the text, changes nothing', async () => {
  const f = fixture();
  for (const listener of f.mouse) listener({ target: { type: CONTENT_TEXT, position: { lineNumber: 1, column: 9_999 } } });
  for (const listener of f.mouse) listener({ target: { type: GUTTER, position: { lineNumber: 1, column: 20_000 } } });
  for (const listener of f.mouse) listener({ target: { type: CONTENT_TEXT, position: null } });
  await Promise.resolve();
  expect(f.updateOptions).not.toHaveBeenCalled();
  // Past the first step but short of the step this document is at.
  await f.click(FIRST_LONG_LINE_STEP);
  f.updateOptions.mockClear();
  for (const listener of f.mouse) listener({ target: { type: CONTENT_TEXT, position: { lineNumber: 1, column: 50_000 } } });
  await Promise.resolve();
  expect(f.updateOptions).not.toHaveBeenCalled();
});

test('the step belongs to the document: another one starts over and the first keeps its own', async () => {
  const f = fixture(), first = { name: 'first' }, second = { name: 'second' };
  f.show(first);
  await f.click(FIRST_LONG_LINE_STEP);
  expect(f.limit()).toBe(100_000);
  f.show(second);
  expect(f.limit()).toBe(FIRST_LONG_LINE_STEP);
  f.show(first);
  expect(f.limit()).toBe(100_000);
  f.show(null);
  expect(f.limit()).toBe(FIRST_LONG_LINE_STEP);
});

test('disposing stops listening and cancels a queued option update', async () => {
  const f = fixture();
  const pending = f.click(FIRST_LONG_LINE_STEP);
  f.installed.dispose();
  f.updateOptions.mockClear();
  await pending;
  expect(f.updateOptions).not.toHaveBeenCalled();
  expect(f.mouse).toEqual([]);
});
