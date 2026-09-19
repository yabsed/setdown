import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { mergeRenderedDiff, responsiveRenderedDiff, RENDERED_DIFF_STYLES } from './rendered-diff';
import { alignPreviewBlocks } from './rendered-diff-alignment';
import { splitPreviewBlocks } from './preview-blocks';

const paragraphs = (texts: string[], offset = 1) => texts.map((text, i) => `<p data-source-line="${offset + i * 2}">${text}</p>`).join('');
const aligned = (before: string, after: string) => alignPreviewBlocks(splitPreviewBlocks(before), splitPreviewBlocks(after));
const labels = (before: string[], after: string[]) => aligned(paragraphs(before), paragraphs(after)).map((row) => [
  row.before?.html.replace(/<[^>]*>/g, '') ?? null,
  row.after?.html.replace(/<[^>]*>/g, '') ?? null,
]);
function assertConservation(before: string[], after: string[]) {
  const rows = aligned(paragraphs(before), paragraphs(after));
  assert.deepEqual(rows.flatMap((row) => row.before ? [row.before.key] : []), splitPreviewBlocks(paragraphs(before)).map((block) => block.key));
  assert.deepEqual(rows.flatMap((row) => row.after ? [row.after.key] : []), splitPreviewBlocks(paragraphs(after)).map((block) => block.key));
  for (const row of rows) if (row.kind === 'equal') assert.equal(row.before?.key, row.after?.key);
}

describe('rendered diff alignment', () => {
  test('leading insertion leaves an empty cell, not A|? B|A C|B', () => {
    assert.deepEqual(labels(['A', 'B', 'C'], ['?', 'A', 'B', 'C']), [[null, '?'], ['A', 'A'], ['B', 'B'], ['C', 'C']]);
  });
  test('interior insertion rejoins the next unchanged block', () => {
    assert.deepEqual(labels(['A', 'C'], ['A', 'B', 'C']), [['A', 'A'], [null, 'B'], ['C', 'C']]);
  });
  test('deletion rejoins the next unchanged block', () => {
    assert.deepEqual(labels(['A', 'B', 'C'], ['A', 'C']), [['A', 'A'], ['B', null], ['C', 'C']]);
  });
  test('repeated paragraphs retain order without greedy cross-pairing', () => {
    assert.deepEqual(labels(['A', 'A', 'B'], ['A', '?', 'A', 'B']), [['A', 'A'], [null, '?'], ['A', 'A'], ['B', 'B']]);
  });
  test('replacement followed by insertion does not displace unchanged tail', () => {
    assert.deepEqual(labels(['first second changed', 'tail'], ['first second changed ?', 'new paragraph', 'tail']), [
      ['first second changed', 'first second changed ?'], [null, 'new paragraph'], ['tail', 'tail'],
    ]);
  });
  for (const inserted of [false, true]) test(`blank-line ${inserted ? 'insertion' : 'deletion'} cannot shift block pairing`, () => {
    const before = paragraphs(['A', 'B', 'C']);
    const after = paragraphs(['A', 'B', 'C'], inserted ? 2 : 1).replace('line="3"', 'line="2"').replace('line="5"', 'line="4"');
    const hunks = [{ oldStart: 2, oldLines: inserted ? 0 : 1, newStart: 2, newLines: inserted ? 1 : 0 }];
    const rendered = responsiveRenderedDiff(before, after, hunks);
    assert.equal((rendered.match(/setdown-rendered-diff-row-unchanged/g) ?? []).length, 3);
    assert.equal((rendered.match(/setdown-rendered-diff-row-changed/g) ?? []).length, 0);
    assert.equal((mergeRenderedDiff(before, after, hunks).match(/<p\b/g) ?? []).length, 3);
  });
  test('source-line attributes are retained but ignored for content equality', () => {
    const before = '<p data-source-line="1" data-source-start="1:2" data-source-end="3:4" data-source-lines="1-3">A</p>';
    const after = '<p data-source-line="6" data-source-start="6:2" data-source-end="8:4" data-source-lines="6-8">A</p>';
    assert.equal(aligned(before, after)[0].kind, 'equal');
    const rendered = responsiveRenderedDiff(before, after, []);
    assert.ok(rendered.includes(before) && rendered.includes(after));
  });
  test('identical final documents align identically regardless of source-hunk grouping', () => {
    const before = paragraphs(['A', 'B', 'C']);
    const after = paragraphs(['?', 'A', 'B', 'C']);
    assert.equal(responsiveRenderedDiff(before, after, []), responsiveRenderedDiff(before, after, [
      { oldStart: 1, oldLines: 99, newStart: 1, newLines: 100 },
    ]));
  });
  test('empty and all-new documents preserve every block', () => {
    assert.deepEqual(labels([], ['A', 'B']), [[null, 'A'], [null, 'B']]);
    assert.deepEqual(labels(['A'], []), [['A', null]]);
    assert.deepEqual(labels([], []), []);
  });
  test('split, merge and reordering never drop or duplicate content', () => {
    for (const [before, after] of [
      [['A B', 'C'], ['A', 'B', 'C']], [['A', 'B', 'C'], ['A B', 'C']],
      [['A', 'B', 'C'], ['C', 'A', 'B']], [['A', 'A', 'B'], ['B', 'A', 'A']],
    ]) assertConservation(before, after);
  });
  test('bounded large-document fallback preserves ordered unique anchors', () => {
    const before = Array.from({ length: 1_600 }, (_, i) => `block-${i}`);
    const after = ['new-head', ...before.slice(0, 800), 'new-middle', ...before.slice(800), 'new-tail'];
    assert.equal(aligned(paragraphs(before), paragraphs(after)).filter((row) => row.kind === 'equal').length, before.length);
    assertConservation(before, after);
  });
  test('generated repeated-content edits never assert false equality', () => {
    let seed = 271828;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let trial = 0; trial < 200; trial += 1) {
      const before = Array.from({ length: next() % 25 }, () => `paragraph ${next() % 8}`);
      const after = [...before];
      for (let edit = 0; edit < 6; edit += 1) after.splice(next() % (after.length + 1), next() % 3, `paragraph ${next() % 8}`);
      assertConservation(before, after);
    }
  });
});

describe('rendered diff emphasis', () => {
  test('unified keeps unchanged blocks once and changed words on both sides', () => {
    const merged = mergeRenderedDiff(paragraphs(['Title', 'Old text', 'Same ending']), paragraphs(['Title', 'New text', 'Same ending']), []);
    assert.equal((merged.match(/>Title</g) ?? []).length, 1);
    assert.equal((merged.match(/>Same ending</g) ?? []).length, 1);
    assert.match(merged, /setdown-diff-word-removed">Old<\/span>/);
    assert.match(merged, /setdown-diff-word-added">New<\/span>/);
    assert.ok(merged.indexOf('setdown-diff-removed') < merged.indexOf('setdown-diff-added'));
  });
  test('new/deleted blocks receive whole-change emphasis without inline tokens', () => {
    assert.match(mergeRenderedDiff('', paragraphs(['entirely new']), []), /data-change="added" data-whole="true"/);
    assert.match(mergeRenderedDiff(paragraphs(['entirely gone']), '', []), /data-change="removed" data-whole="true"/);
  });
  test('opaque math changes get whole-block emphasis without corrupting math DOM', () => {
    const before = '<div class="katex-display" data-source-line="1"><span class="katex">x+y</span></div>';
    const after = '<div class="katex-display" data-source-line="1"><span class="katex">x-y</span></div>';
    const result = mergeRenderedDiff(before, after, []);
    assert.ok(result.includes(before) && result.includes(after));
    assert.equal((result.match(/data-whole="true"/g) ?? []).length, 2);
    assert.ok(!result.includes('setdown-diff-word-'));
  });
  test('link destinations and image changes do not disappear behind identical text', () => {
    for (const [before, after] of [
      ['<p><a href="old">same text</a></p>', '<p><a href="new">same text</a></p>'],
      ['<p><img src="old.png"></p>', '<p><img src="new.png"></p>'],
    ]) assert.equal((mergeRenderedDiff(before, after, []).match(/data-whole="true"/g) ?? []).length, 2);
  });
  test('large changes fall back to strong block emphasis', () => {
    assert.match(mergeRenderedDiff(paragraphs(['old '.repeat(600)]), paragraphs(['new '.repeat(600)]), []), /data-whole="true"/);
  });
  test('authored deletion markup is preserved', () => {
    assert.ok(mergeRenderedDiff('<p><del>authored</del> old</p>', '<p><del>authored</del> new</p>', []).includes('<del>authored</del>'));
  });
  test('word styling adds neither strikethrough nor width-changing padding', () => {
    assert.ok(!RENDERED_DIFF_STYLES.includes('line-through'));
    assert.match(RENDERED_DIFF_STYLES, /\.setdown-diff-word-added, \.setdown-diff-word-removed \{\s+padding: 0;/);
    assert.ok(RENDERED_DIFF_STYLES.includes('body[data-preview-theme="dark"]'));
    assert.ok(RENDERED_DIFF_STYLES.includes('content: "+"'));
  });
  test('both responsive views carry a complete comparison', () => {
    const result = responsiveRenderedDiff(paragraphs(['A', 'B', 'C']), paragraphs(['A', 'B', 'C']), []);
    assert.ok(result.includes('setdown-rendered-diff-unified') && result.includes('setdown-rendered-diff-split'));
    assert.equal((result.match(/setdown-rendered-diff-row-unchanged/g) ?? []).length, 3);
  });
});
