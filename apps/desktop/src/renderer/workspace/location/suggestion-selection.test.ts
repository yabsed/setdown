import { expect, test } from 'vitest';
import { stepSuggestion } from './suggestion-selection';

test('arrow keys walk the rows and pass through the typed text at either end', () => {
  const walk = (start: number, count: number, step: 1 | -1, times: number) => {
    const seen: number[] = [];
    for (let selected = start, index = 0; index < times; index++) seen.push(selected = stepSuggestion(selected, count, step));
    return seen;
  };
  expect(walk(-1, 3, 1, 5)).toEqual([0, 1, 2, -1, 0]);
  expect(walk(-1, 3, -1, 5)).toEqual([2, 1, 0, -1, 2]);
  expect(walk(-1, 1, 1, 3)).toEqual([0, -1, 0]);
});

test('presses held until the rows arrive land where pressing them one by one would', () => {
  expect(stepSuggestion(-1, 3, 2)).toBe(1);
  expect(stepSuggestion(-1, 3, -2)).toBe(1);
  expect(stepSuggestion(-1, 3, 4)).toBe(-1);
  expect(stepSuggestion(1, 3, -9)).toBe(0);
  // No rows: the typed text is the only stop.
  expect(stepSuggestion(-1, 0, 3)).toBe(-1);
});
