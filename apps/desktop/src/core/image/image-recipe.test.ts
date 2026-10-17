import { expect, test } from 'vitest';
import { initialRecipe, rotateRecipe, flipRecipe, ImageHistory, validRecipe } from './image-recipe';

test('quarter turns preserve crop pixels and swap output dimensions; four turns restore exactly', () => {
  const initial = { ...initialRecipe(800, 400, 'png'), crop: { x: 200, y: 100, width: 300, height: 200 }, width: 150, height: 100 };
  let current = rotateRecipe(initial, 800, 400);
  expect(current.crop).toEqual({ x: 100, y: 200, width: 200, height: 300 });
  expect([current.width, current.height]).toEqual([100, 150]);
  for (let n = 0; n < 3; n++) current = rotateRecipe(current, 800, 400);
  expect(current).toEqual(initial);
  expect(flipRecipe(flipRecipe(initial, 'X', 800, 400), 'X', 800, 400)).toEqual(initial);
  expect(flipRecipe(initial, 'X', 800, 400).crop.x).toBe(300);
});
test('history includes color edits, returns to saved content and acknowledges only the captured save', () => {
  const initial = initialRecipe(80, 40, 'png'), h = new ImageHistory(initial);
  h.commit(rotateRecipe(h.current, 80, 40)); const first = h.current;
  h.commit(rotateRecipe(h.current, 80, 40)); expect(h.current.turns).toBe(2);
  h.undo(); expect(h.current.turns).toBe(1); h.redo(); expect(h.current.turns).toBe(2);
  h.saved(first); expect(h.dirty).toBe(true); h.undo(); expect(h.dirty).toBe(false);
  h.commit({ ...h.current, brightness: .5 }); expect(h.dirty).toBe(true); expect(h.canRedo).toBe(false);
  h.undo(); expect(h.dirty).toBe(false); h.undo(); expect(h.current).toEqual(initial); expect(h.dirty).toBe(true);
});
test('rejects invalid geometry, excessive allocations and non-finite adjustments', () => {
  const r = initialRecipe(800, 400, 'png'); expect(validRecipe(r, 800, 400)).toBe(true);
  for (const bad of [{ ...r, width: 0 }, { ...r, width: 8192, height: 8192 }, { ...r, saturation: NaN },
    { ...r, turns: 1.5 }, { ...r, crop: { ...r.crop, x: 1 } }]) expect(validRecipe(bad, 800, 400)).toBe(false);
});
