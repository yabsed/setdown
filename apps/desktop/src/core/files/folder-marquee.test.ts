import { describe, expect, it } from 'vitest';
import { listMarqueeLayout, marqueeCorner, marqueeIndexes, marqueeMode, marqueeScroll, marqueeSelection, marqueeSpan, type MarqueeLayout } from './folder-marquee';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const list = listMarqueeLayout(28);
// Four 116 px cells per line behind 8 px of padding; a cell is 120 px tall in a 124 px line.
const grid: MarqueeLayout = { columns: 4, itemWidth: 116, itemHeight: 120, lineHeight: 124, left: 8, inset: 6 };
const hit = (area: ReturnType<typeof box>, layout: MarqueeLayout, count: number) => marqueeIndexes(marqueeSpan(area, layout, count), layout.columns, count);

describe('folder rubber-band selection', () => {
  it('selects the rows a box touches, wherever it lies across the pane', () => {
    expect(hit(box(600, 30, 900, 100), list, 10)).toEqual([1, 2, 3]);
    expect(hit(box(0, 0, 5, 27), list, 10)).toEqual([0]);
    // A sideways sweep inside one row still selects that row.
    expect(hit(box(100, 40, 400, 40), list, 10)).toEqual([1]);
    // The pixel on a boundary belongs to the row below it.
    expect(hit(box(0, 28, 10, 55), list, 10)).toEqual([1]);
    expect(hit(box(0, 27, 10, 56), list, 10)).toEqual([0, 1, 2]);
  });

  it('selects nothing below the last row and stops at it', () => {
    expect(hit(box(0, 120, 300, 400), list, 4)).toEqual([]);
    expect(hit(box(0, 100, 300, 400), list, 4)).toEqual([3]);
    expect(hit(box(0, -50, 300, 400), list, 4)).toEqual([0, 1, 2, 3]);
    expect(hit(box(0, 0, 300, 400), list, 0)).toEqual([]);
  });

  it('reaches rows that are not mounted: the answer is arithmetic over the whole list', () => {
    const span = marqueeSpan(box(0, 28 * 10, 10, 28 * 90_000 + 5), list, 100_000);
    expect(span).toEqual({ firstLine: 10, lastLine: 90_000, firstColumn: 0, lastColumn: 0 });
  });

  it('selects the grid cells whose content a box reaches, not the ones whose padding it grazes', () => {
    // Cell 1 spans x 124..240; its content begins 6 px in.
    expect(hit(box(126, 10, 128, 20), grid, 12)).toEqual([]);
    expect(hit(box(126, 10, 131, 20), grid, 12)).toEqual([1]);
    expect(hit(box(100, 50, 260, 200), grid, 12)).toEqual([0, 1, 2, 4, 5, 6]);
    // The 4 px between two lines, and the padding on either side of it, belong to neither.
    expect(hit(box(20, 114, 200, 129), grid, 12)).toEqual([]);
    expect(hit(box(20, 113, 200, 130), grid, 12)).toEqual([0, 1, 4, 5]);
  });

  it('ignores the unused end of a short last line', () => {
    // 6 items: the second line holds only columns 0 and 1.
    expect(hit(box(260, 140, 460, 230), grid, 6)).toEqual([]);
    expect(hit(box(140, 60, 460, 230), grid, 6)).toEqual([1, 2, 3, 5]);
    expect(hit(box(480, 10, 900, 400), grid, 6)).toEqual([]);
  });

  it('names the corner under the pointer and the one the drag began at', () => {
    const span = marqueeSpan(box(140, 60, 460, 230), grid, 6)!;
    expect(marqueeCorner(span, 4, 6, { down: false, right: false })).toBe(1);
    expect(marqueeCorner(span, 4, 6, { down: false, right: true })).toBe(3);
    expect(marqueeCorner(span, 4, 6, { down: true, right: false })).toBe(5);
    // Column 3 of the short line is empty: the nearest item the box holds is the last one.
    expect(marqueeCorner(span, 4, 6, { down: true, right: true })).toBe(5);
    // Columns 2..3 only: the short line holds nothing there, so the corner is on the line above.
    const right = marqueeSpan(box(260, 60, 460, 230), grid, 6)!;
    expect(marqueeCorner(right, 4, 6, { down: true, right: true })).toBe(3);
    expect(marqueeCorner(right, 4, 6, { down: true, right: false })).toBe(2);
    const rows = marqueeSpan(box(0, 30, 10, 100), list, 10)!;
    expect([marqueeCorner(rows, 1, 10, { down: false, right: true }), marqueeCorner(rows, 1, 10, { down: true, right: false })]).toEqual([1, 3]);
  });

  it('replaces, adds to or toggles the selection the drag began with', () => {
    expect(marqueeMode({})).toBe('replace');
    expect(marqueeMode({ shiftKey: true })).toBe('add');
    expect(marqueeMode({ ctrlKey: true, shiftKey: true })).toBe('toggle');
    expect(marqueeMode({ metaKey: true })).toBe('toggle');
    expect(marqueeSelection(['a', 'b'], ['b', 'c'], 'replace')).toEqual(['b', 'c']);
    expect(marqueeSelection(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c']);
    expect(marqueeSelection(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
    // A box that shrinks again gives back what it had changed.
    expect(marqueeSelection(['a', 'b'], [], 'toggle')).toEqual(['a', 'b']);
  });

  it('scrolls only near an edge, faster the farther the pointer is past it', () => {
    expect(marqueeScroll(200, 400, 16)).toBe(0);
    expect(marqueeScroll(390, 400, 16)).toBeGreaterThan(0);
    expect(marqueeScroll(5, 400, 16)).toBeLessThan(0);
    expect(marqueeScroll(520, 400, 16)).toBeGreaterThan(marqueeScroll(390, 400, 16));
    expect(marqueeScroll(-300, 400, 16)).toBeLessThan(marqueeScroll(5, 400, 16));
    // A stalled frame does not jump the list.
    expect(marqueeScroll(9_000, 400, 5_000)).toBeLessThanOrEqual(2400 * .064);
  });
});
