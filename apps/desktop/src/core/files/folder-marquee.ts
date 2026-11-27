/**
 * Rubber-band selection in a folder tab: dragging on the background draws a box and
 * selects the items it touches. The list is virtualized, so the items under the box
 * come from the layout's arithmetic, never from the rows that happen to be mounted.
 */

/** A box in the scrolled content's coordinates: the origin is the top-left corner of the first line. */
export type MarqueeBox = { left: number; top: number; right: number; bottom: number };
/**
 * Lines of `columns` items. A list is one column as wide as the pane. `inset` is the part of
 * an item's edge that is padding: a box that only reaches the padding has not reached the item.
 */
export type MarqueeLayout = { columns: number; itemWidth: number; itemHeight: number; lineHeight: number; left: number; inset: number };
/** Inclusive lines and columns under a box. */
export type MarqueeSpan = { firstLine: number; lastLine: number; firstColumn: number; lastColumn: number };
/** Plain drag replaces the selection, Shift adds to it, Ctrl (Cmd) toggles what the box touches. */
export type MarqueeMode = 'replace' | 'add' | 'toggle';

export const listMarqueeLayout = (rowHeight: number): MarqueeLayout =>
  ({ columns: 1, itemWidth: Infinity, itemHeight: rowHeight, lineHeight: rowHeight, left: -Infinity, inset: 0 });

/**
 * Inclusive range of the tracks that overlap `[from, to]`. Track `n` holds its item in
 * `[start + n * step + inset, start + n * step + size - inset)`: a pixel belongs to the item it is drawn in.
 */
function tracks(from: number, to: number, start: number, step: number, size: number, inset: number, count: number): [number, number] | null {
  if (!Number.isFinite(step)) return count > 0 ? [0, 0] : null;
  const first = Math.max(0, Math.floor((from - start - size + inset) / step) + 1);
  const last = Math.min(count - 1, Math.floor((to - start - inset) / step));
  return first <= last ? [first, last] : null;
}

export function marqueeSpan(box: MarqueeBox, layout: MarqueeLayout, count: number): MarqueeSpan | null {
  const lines = tracks(box.top, box.bottom, 0, layout.lineHeight, layout.itemHeight, layout.inset, Math.ceil(count / layout.columns));
  const columns = tracks(box.left, box.right, layout.left, layout.itemWidth, layout.itemWidth, layout.inset, layout.columns);
  if (!lines || !columns) return null;
  // The last line may be short: a box over its unused end touches nothing.
  if (lines[0] * layout.columns + columns[0] >= count) return null;
  return { firstLine: lines[0], lastLine: lines[1], firstColumn: columns[0], lastColumn: columns[1] };
}

/** Item indexes under a span, in list order. */
export function marqueeIndexes(span: MarqueeSpan | null, columns: number, count: number): number[] {
  const indexes: number[] = [];
  if (!span) return indexes;
  for (let line = span.firstLine; line <= span.lastLine; line++) {
    for (let column = span.firstColumn; column <= span.lastColumn; column++) {
      const index = line * columns + column;
      if (index < count) indexes.push(index);
    }
  }
  return indexes;
}

/**
 * The item at one corner of a span: the corner the drag started from anchors a later
 * Shift selection, the corner under the pointer takes the keyboard focus.
 */
export function marqueeCorner(span: MarqueeSpan, columns: number, count: number, toward: { down: boolean; right: boolean }): number {
  const line = toward.down ? span.lastLine : span.firstLine, column = toward.right ? span.lastColumn : span.firstColumn;
  const index = line * columns + column;
  if (index < count) return index;
  // Only the short last line lacks that column: take its last item when the span holds it, else the line above.
  return (count - 1) % columns >= span.firstColumn ? count - 1 : (line - 1) * columns + column;
}

export const marqueeMode = (modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): MarqueeMode =>
  modifiers.ctrlKey || modifiers.metaKey ? 'toggle' : modifiers.shiftKey ? 'add' : 'replace';

/** The selection while the box touches `hit`, given what was selected when the drag began. */
export function marqueeSelection(base: readonly string[], hit: readonly string[], mode: MarqueeMode): string[] {
  if (mode === 'replace') return [...hit];
  const held = new Set(base), touched = new Set(hit);
  const added = hit.filter(path => !held.has(path));
  return mode === 'add' ? [...base, ...added] : [...base.filter(path => !touched.has(path)), ...added];
}

/**
 * Pixels to scroll after `elapsed` ms while the pointer is `position` pixels below the top of a
 * viewport `size` pixels tall. Scrolling starts in a band at each edge and speeds up with the
 * distance past it, so a box can reach rows that are out of view.
 */
export function marqueeScroll(position: number, size: number, elapsed: number): number {
  const band = Math.min(24, size / 4);
  const past = position < band ? position - band : position > size - band ? position - (size - band) : 0;
  if (!past || elapsed <= 0) return 0;
  const speed = Math.min(2400, 120 + Math.abs(past) * 18);
  return Math.sign(past) * speed * Math.min(elapsed, 64) / 1000;
}
