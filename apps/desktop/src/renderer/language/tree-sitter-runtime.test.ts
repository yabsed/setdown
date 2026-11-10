import { expect, test } from 'vitest';
import { syntaxSegments } from './tree-sitter-runtime';

test('query captures produce ordered non-overlapping tokens with inner captures taking precedence',()=>{
  const spans=syntaxSegments([[0,12,'string'],[2,6,'keyword'],[4,5,'function.call'],[0,1,'unknown.capture']]);
  expect(spans.map(([start,end])=>[start,end])).toEqual([[0,2],[2,4],[4,5],[5,6],[6,12]]);
  expect(spans[0][2]).toBe(spans.at(-1)![2]);
  expect(syntaxSegments([[0,2,'comment'],[2,4,'comment'],[9,9,'keyword']])).toHaveLength(1);
});
