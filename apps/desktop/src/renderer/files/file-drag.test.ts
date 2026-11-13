import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fileDrag, FILE_DRAG_END } from './file-drag';

const events: string[] = [];
const listeners = new Map<string, () => void>();
const dragEvent = (...types: string[]) => ({ dataTransfer: { types } }) as unknown as DragEvent;
beforeEach(() => {
  vi.useFakeTimers(); events.length = 0; listeners.clear();
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => { events.push(event.type); return true; },
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
    removeEventListener: (type: string, listener: () => void) => { if (listeners.get(type) === listener) listeners.delete(type); },
  });
});
afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('records the OS file drag of a folder tab until the drag is over, and proves ownership by the dropped paths', async () => {
  let finish = () => {};
  const startDrag = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), cancelDrag = vi.fn();
  const drag = fileDrag.start({ startDrag, cancelDrag }, ['/home/a.md', '/home/data'], ['/home/a.md']);
  expect(startDrag).toHaveBeenCalledWith(['/home/a.md', '/home/data']);
  // A mouseup can only reach this window before the OS drag holds the pointer: the pending drag is called off.
  expect(cancelDrag).not.toHaveBeenCalled();
  listeners.get('mouseup')!();
  expect(cancelDrag).toHaveBeenCalledOnce();
  expect(events).toEqual([]);
  expect(fileDrag.owns(dragEvent('Files'))).toBe(true);
  // Another payload in the same window (a tab, Explorer entries) is not this drag.
  expect(fileDrag.owns(dragEvent('application/x-setdown-tab'))).toBe(false);
  expect(fileDrag.documents).toEqual(['/home/a.md']);
  expect(fileDrag.dropped(['/home/data'])).toBe(true);
  expect(fileDrag.dropped(['/home/a.md', '/elsewhere/b.md'])).toBe(false);
  expect(fileDrag.dropped([])).toBe(false);
  finish(); await drag;
  expect(listeners.has('mouseup')).toBe(false);
  expect(events).toEqual([FILE_DRAG_END]);
  // The drop may be delivered just after main reports the end of the drag.
  expect(fileDrag.dropped(['/home/a.md'])).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(fileDrag.paths).toEqual([]); expect(fileDrag.owns(dragEvent('Files'))).toBe(false);
  expect(fileDrag.dropped(['/home/a.md'])).toBe(false);
});

it('ends a failed drag and lets a newer drag keep its own record', async () => {
  await expect(fileDrag.start({ startDrag: () => Promise.reject(Error('gone')), cancelDrag() {} }, ['/home/old.md'], [])).rejects.toThrow('gone');
  expect(events).toEqual([FILE_DRAG_END]);
  const next = fileDrag.start({ startDrag: () => new Promise<void>(() => {}), cancelDrag() {} }, ['/home/new.md'], []);
  vi.advanceTimersByTime(1000);
  expect(fileDrag.paths).toEqual(['/home/new.md']);
  void next;
  await fileDrag.start({ startDrag: vi.fn(), cancelDrag() {} }, [], []);
  expect(fileDrag.paths).toEqual(['/home/new.md']);
});
