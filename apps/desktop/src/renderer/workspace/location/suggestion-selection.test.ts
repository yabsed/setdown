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
