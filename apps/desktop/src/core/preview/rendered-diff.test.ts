import { describe, expect, test } from 'vitest';
import {
  mergeRenderedDiff,
  responsiveRenderedDiff,
  RENDERED_DIFF_STYLES,
} from './rendered-diff';
import { textDiffHunks } from '../diff/text-diff';

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
    expect(merged).toContain('class="setdown-diff-word-removed">Old</span>');
    expect(merged).toContain('class="setdown-diff-word-added">New</span>');
    expect(merged.indexOf('setdown-diff-removed'))
      .toBeLessThan(merged.indexOf('setdown-diff-added'));
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

  test('carries complete before and after documents for the wide layout', () => {
    const rendered = responsiveRenderedDiff(
      '<h1 data-source-line="1">Title</h1><p data-source-line="3">Old text</p>',
      '<h1 data-source-line="1">Title</h1><p data-source-line="3">New text</p>',
      [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 }],
    );

    expect(rendered).toContain('setdown-rendered-diff-unified');
    expect(rendered).toContain('setdown-rendered-diff-before');
    expect(rendered).toContain('setdown-rendered-diff-after');
    expect(rendered).toContain('setdown-diff-word-removed">Old</span>');
    expect(rendered).toContain('setdown-diff-word-added">New</span>');
  });

  test('aligns an insertion with an empty opposite cell and rejoins unchanged content', () => {
    const rendered = responsiveRenderedDiff(
      [
        '<p data-source-line="1">A</p>',
        '<p data-source-line="3">C</p>',
      ].join(''),
      [
        '<p data-source-line="1">A</p>',
        '<p data-source-line="3">B</p>',
        '<p data-source-line="5">C</p>',
      ].join(''),
      [{ oldStart: 3, oldLines: 0, newStart: 3, newLines: 1 }],
    );
    const rows = rendered.split(/<div class="setdown-rendered-diff-row [^"]+">/).slice(1);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('<section class="setdown-rendered-diff-before" aria-label="Before"></section>');
    expect(rows[1]).toContain('>B</p>');
    expect(rows[2].match(/>C<\/p>/g)).toHaveLength(2);
  });

  test('keeps an edited block at the top when paragraphs are appended after its line', () => {
    const originalText = ['same', '', 'first', 'second', 'changed', '', 'tail'].join('\n');
    const modifiedText = [
      'same', '', 'first', 'second', 'changed ?', '', 'inserted one', '', 'inserted two', '', 'tail',
    ].join('\n');
    const rendered = responsiveRenderedDiff(
      [
        '<p data-source-line="1">same</p>',
        '<p data-source-line="3">first<br>second<br>changed</p>',
        '<p data-source-line="7">tail</p>',
      ].join(''),
      [
        '<p data-source-line="1">same</p>',
        '<p data-source-line="3">first<br>second<br>changed ?</p>',
        '<p data-source-line="7">inserted one</p>',
        '<p data-source-line="9">inserted two</p>',
        '<p data-source-line="11">tail</p>',
      ].join(''),
      textDiffHunks(originalText, modifiedText),
    );
    const rows = rendered.split(/<div class="setdown-rendered-diff-row [^"]+">/).slice(1);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('first<br>second<br>changed</p>');
    expect(rows[1]).toContain('first<br>second<br>changed <span');
    expect(rows[1]).toContain('>?</span>');
    expect(rows[1]).toContain('inserted one');
    expect(rows[1]).toContain('inserted two');
    expect(rows[2].match(/>tail<\/p>/g)).toHaveLength(2);
  });

  test('keeps split cells inside their equal-width grid tracks', () => {
    const sideRule = RENDERED_DIFF_STYLES.match(
      /\.setdown-rendered-diff-before,\n\s+\.setdown-rendered-diff-after \{([\s\S]*?)\n\s+\}/,
    )?.[1];

    expect(sideRule).toContain('box-sizing: border-box');
    expect(sideRule).not.toContain('width: 100%');
  });
});
