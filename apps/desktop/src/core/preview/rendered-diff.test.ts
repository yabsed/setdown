import { describe, expect, test } from 'vitest';
import { mergeRenderedDiff } from './rendered-diff';

describe('rendered diff', () => {
  test('keeps unchanged blocks once and marks only replaced blocks', () => {
    const original = [
      '<h1 data-source-line="1">Title</h1>',
      '<p data-source-line="3">Old text</p>',
      '<p data-source-line="5">Same ending</p>',
    ].join('\n');
    const modified = [
      '<h1 data-source-line="1">Title</h1>',
      '<p data-source-line="3">New text</p>',
      '<p data-source-line="5">Same ending</p>',
    ].join('\n');
    const merged = mergeRenderedDiff(original, modified, [
      { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
    ]);

    expect(merged.match(/>Title</g)).toHaveLength(1);
    expect(merged.match(/>Same ending</g)).toHaveLength(1);
    expect(merged).toContain('class="setdown-diff-removed"');
    expect(merged).toContain('class="setdown-diff-added"');
    expect(merged.indexOf('Old text')).toBeLessThan(merged.indexOf('New text'));
  });

  test('inserts a removed block at a pure-deletion boundary', () => {
    const merged = mergeRenderedDiff(
      '<p data-source-line="1">Keep</p><p data-source-line="3">Delete</p><p data-source-line="5">Tail</p>',
      '<p data-source-line="1">Keep</p><p data-source-line="4">Tail</p>',
      [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 0 }],
    );
    expect(merged.indexOf('Delete')).toBeLessThan(merged.indexOf('Tail'));
    expect(merged).toContain('setdown-diff-removed');
  });
});
