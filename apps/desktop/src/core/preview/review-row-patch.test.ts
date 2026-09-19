import assert from 'node:assert/strict';
import { test } from 'vitest';
import { responsiveRenderedDiff } from './rendered-diff';
import { splitPreviewBlocks } from './preview-blocks';
import { diffReviewRows, readReviewRows, shiftReviewHtml, shiftedReviewAttribute,
  type ReviewRows, type ReviewTreePatch } from './review-row-patch';

const fragment = (words: string[], offset = 0) => words.map((word, i) =>
  `<p data-source-line="${i * 2 + 1 + offset}"><span data-source-start="${i * 2 + 1 + offset}:3" data-source-end="${i * 2 + 1 + offset}:8">${word}</span></p>`).join('\n');
const render = (before: string[], after: string[]) => responsiveRenderedDiff(fragment(before), fragment(after), []);
function applyStrings(previous: string[], patch: ReviewTreePatch, split: boolean) {
  const result = [...previous];
  for (const shift of patch.shifts) {
    for (let i = shift.from; i < shift.from + shift.count; i++) {
      if (!split) result[i] = shiftReviewHtml(result[i], shift.deltas[0]);
      else {
        const row = result[i];
        const children = splitPreviewBlocks(row.slice(row.indexOf('>') + 1, row.lastIndexOf('</')));
        result[i] = row.replace(children[0].html, shiftReviewHtml(children[0].html, shift.deltas[0]))
          .replace(children[1].html, shiftReviewHtml(children[1].html, shift.deltas[1]));
      }
    }
  }
  for (const splice of [...patch.splices].reverse()) result.splice(splice.from, splice.removeCount, ...splice.rows);
  return result;
}
function verify(previous: string, next: string) {
  const old = readReviewRows(previous);
  const expected = readReviewRows(next);
  const patch = diffReviewRows(old, expected, 7, 9);
  assert.deepEqual(applyStrings(old.unified, patch.unified, false), expected.unified);
  assert.deepEqual(applyStrings(old.split, patch.split, true), expected.split);
  return patch;
}

test('one word edit transfers one split row, not both document-sized wrappers', () => {
  const words = Array.from({ length: 1_000 }, (_, i) => `Paragraph ${i} has unchanged math and prose`);
  const next = [...words]; next[500] += '!';
  const html = render(words, next);
  const patch = verify(render(words, words), html);
  assert.equal(patch.split.splices.reduce((n, x) => n + x.removeCount, 0), 1);
  assert.equal(patch.split.splices.reduce((n, x) => n + x.rows.length, 0), 1);
  assert.ok(JSON.stringify(patch).length < html.length / 100);
});

test('insertion shifts only after-side metadata while preserving the unchanged rows', () => {
  const words = Array.from({ length: 80 }, (_, i) => `Unique ${i}`);
  const patch = verify(render(words, words), render(words, ['Inserted', ...words]));
  assert.equal(patch.split.splices.reduce((n, x) => n + x.removeCount, 0), 0);
  assert.deepEqual(patch.split.shifts, [{ from: 0, count: 80, deltas: [0, 2] }]);
});

test('deletion and original-side changes retain distinct before/after source spaces', () => {
  const words = ['A', 'B', 'C', 'D'];
  const removal = verify(render(words, words), render(words, words.slice(1)));
  assert.ok(removal.split.shifts.some((shift) => shift.deltas[0] === 0 && shift.deltas[1] === -2));
  const baseline = verify(render(words, words), render(['Before insert', ...words], words));
  assert.ok(baseline.split.shifts.some((shift) => shift.deltas[0] === 2 && shift.deltas[1] === 0));
});

test('disjoint edits do not replace unchanged rows between them', () => {
  const words = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
  const next = [...words]; next[2] += ' changed'; next[90] += ' changed';
  const patch = verify(render(words, words), render(words, next));
  assert.equal(patch.split.splices.length, 2);
  assert.equal(patch.split.splices.reduce((n, x) => n + x.removeCount, 0), 2);
});

test('nonuniform or column-only metadata changes replace only their row', () => {
  const old = responsiveRenderedDiff('', '<p data-source-line="1"><span data-source-start="1:2">A</span></p><p data-source-line="9">B</p>', []);
  const next = old.replaceAll('data-source-start="1:2"', 'data-source-start="1:6"');
  const patch = verify(old, next);
  assert.equal(patch.split.splices.reduce((n, x) => n + x.removeCount, 0), 1);
});

test('source shifts preserve columns, range endpoints and authored content', () => {
  assert.equal(shiftedReviewAttribute('data-source-start', '8:11', 3), '11:11');
  assert.equal(shiftedReviewAttribute('data-source-lines', '8-13', 3), '11-16');
  assert.equal(shiftedReviewAttribute('data-source-line', 'invalid', 3), 'invalid');
  assert.equal(shiftReviewHtml('<p data-source-start="8:11">data-source-line="8"</p>', 3),
    '<p data-source-start="11:11">data-source-line="8"</p>');
});

test('look-alike attribute syntax in prose is not interpreted as source metadata', () => {
  const old = '<p data-source-line="8"><code>data-source-line="8"</code></p>';
  assert.equal(shiftReviewHtml(old, 2), '<p data-source-line="10"><code>data-source-line="8"</code></p>');
  const html = responsiveRenderedDiff('', old, []);
  verify(html, responsiveRenderedDiff('', '<p data-source-line="10"><code>data-source-line="8"</code></p>', []));
});

test('empty and identical reviews need no node replacement', () => {
  const empty: ReviewRows = { split: [], unified: [] };
  assert.deepEqual(diffReviewRows(empty, empty, 1, 2).split.splices, []);
  const html = render(['A', 'A', 'B'], ['A', 'A', 'B']);
  const patch = verify(html, html);
  assert.deepEqual(patch.split.splices, []);
  assert.deepEqual(patch.split.shifts, []);
  verify(render([], []), render([], ['New']));
  verify(render(['Old'], []), render([], []));
});

test('repeated/moved paragraphs and mixed inserts/deletes replay exactly (seeded 120 cases)', () => {
  let seed = 0x51f15e;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let iteration = 0; iteration < 120; iteration++) {
    const baseline = Array.from({ length: 12 }, () => `Word ${random(6)}`);
    const previous = [...baseline]; const next = [...baseline];
    previous.splice(random(previous.length), random(3), 'Prior edit');
    for (let change = 0; change < 4; change++) next.splice(random(next.length + 1), random(3), `New ${random(6)}`);
    verify(render(baseline, previous), render(baseline, next));
  }
});
