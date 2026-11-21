import { describe, expect, it } from 'vitest';
import { MIN_SCALE, PAGE, planSheet, type PrintSheet } from './spreadsheet-print';

const sheet = (overrides: Partial<PrintSheet>): PrintSheet => ({
  name: 'Sheet1', data: [], cell: {}, merge: [], colWidths: undefined, rowHeights: undefined, hiddenColumns: new Set(),
  defaults: { colWidth: 80, rowHeight: 20 }, images: [], charts: [], ...overrides,
});
const grid = (rows: number, cols: number) => Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => `${row}:${col}`));
const portrait = PAGE.short - 2 * PAGE.margin, landscape = PAGE.long - 2 * PAGE.margin;

describe('planSheet', () => {
  it('prints a narrow sheet upright at its own size', () => {
    const plan = planSheet(sheet({ data: grid(61, 3) }));
    expect(plan).toMatchObject({ landscape: false, scale: 1, width: 240, bands: [{ from: 0, to: 3 }] });
    expect(plan.rows).toHaveLength(61);
    expect(plan.cols).toEqual([0, 1, 2]);
  });

  it('turns the paper and then shrinks the columns until they fit one page width', () => {
    const turned = planSheet(sheet({ data: grid(4, 12) }));
    expect(turned.width).toBe(960);
    expect(turned).toMatchObject({ landscape: true, scale: 1, bands: [{ from: 0, to: 12 }] });
    const shrunk = planSheet(sheet({ data: grid(4, 20) }));
    expect(shrunk.landscape).toBe(true);
    expect(shrunk.scale).toBeCloseTo(landscape / 1600, 5);
    expect(shrunk.scale).toBeGreaterThan(MIN_SCALE);
    expect(shrunk.bands).toEqual([{ from: 0, to: 20 }]);
    expect(240).toBeLessThan(portrait);
  });

  it('continues a very wide sheet in further column bands instead of shrinking it past legibility', () => {
    const plan = planSheet(sheet({ data: grid(3, 100) }));
    expect(plan.scale).toBe(MIN_SCALE);
    // Every column is printed exactly once, in order, and each band fits the page.
    expect(plan.bands[0].from).toBe(0);
    expect(plan.bands.at(-1)!.to).toBe(100);
    plan.bands.forEach((band, index) => {
      if (index) expect(band.from).toBe(plan.bands[index - 1].to);
      expect((band.to - band.from) * 80 * plan.scale).toBeLessThanOrEqual(landscape + .5);
    });
    expect(plan.bands.length).toBe(Math.ceil(100 / Math.floor(landscape / MIN_SCALE / 80)));
  });

  it('gives a column wider than the page a band of its own', () => {
    const plan = planSheet(sheet({ data: grid(2, 3), colWidths: [100, 5000, 100] }));
    expect(plan.bands).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }]);
  });

  it('leaves out hidden rows and columns and what lies past the content', () => {
    const data = grid(5, 6).map((row, r) => row.map((value, c) => r >= 3 || c >= 4 ? '' : value));
    const plan = planSheet(sheet({ data, hiddenColumns: new Set([1]), rowHeights: [20, 0, 20] }));
    expect(plan.cols).toEqual([0, 2, 3]);
    expect(plan.rows).toEqual([0, 2]);
    expect(plan.width).toBe(240);
  });

  it('keeps formatted empty cells and the cells a picture or chart covers', () => {
    const bordered = planSheet(sheet({ data: grid(1, 1), cell: { '3-2': { style: { borderTopWidth: '1px' } }, '9-9': { style: { fontWeight: 'bold' } } } }));
    expect(bordered.rows.at(-1)).toBe(3);
    expect(bordered.cols.at(-1)).toBe(2);
    const picture = { left: 160, top: 40, width: 200, height: 90, row: 2, col: 2 };
    const pictured = planSheet(sheet({ data: grid(1, 1), images: [{ ...picture, src: 'data:image/png;base64,AA==' }] }));
    // 160..360px covers columns 2-4; 40..130px covers rows 2-6.
    expect(pictured.cols.at(-1)).toBe(4);
    expect(pictured.rows.at(-1)).toBe(6);
  });

  it('reports an empty sheet as having nothing to print', () => {
    expect(planSheet(sheet({ data: [['', ''], ['']] }))).toMatchObject({ cols: [], rows: [], bands: [] });
  });
});
