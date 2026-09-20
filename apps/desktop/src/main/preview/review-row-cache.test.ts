import assert from 'node:assert/strict';
import { test } from 'vitest';
import { responsiveRenderedDiff, responsiveRenderedRows } from '../../core/preview/rendered-diff';
import { readReviewRows } from '../../core/preview/review-row-patch';
import { serializeReviewRows, reviewRowsHtmlLength } from '../../core/preview/review-rows';
import { ReviewRowCache } from './review-row-cache';
const base = Array.from({ length: 40 }, (_, i) => `<p data-source-line="${i + 1}">Shared ${i}</p>`).join('');
const html = (value: number) => responsiveRenderedDiff(base, base.replace('Shared 20', `Shared 20 ${value}`), []);

test('A and B patches are based on their own acknowledged revisions', () => {
  const cache = new ReviewRowCache();
  assert.ok(cache.update('a', null, 1, html(1)).html);
  assert.ok(cache.update('b', null, 2, html(2)).html);
  assert.equal(cache.update('a', 1, 3, html(3)).patch?.baseRevision, 1);
  assert.equal(cache.update('b', 2, 4, html(4)).patch?.baseRevision, 2);
});

test('a rejected/lost installation cannot silently advance the page base', () => {
  const cache = new ReviewRowCache(); cache.update('a', null, 1, html(1));
  assert.ok(cache.update('a', 1, 2, html(2)).patch);
  assert.ok(cache.update('a', 1, 3, html(3)).html);
  assert.equal(cache.update('a', 3, 4, html(4)).patch?.baseRevision, 3);
});

test('worker restart, eviction, capacity bypass and closed page all safely reset', () => {
  const cache = new ReviewRowCache(1); cache.update('a', null, 1, html(1));
  cache.update('b', null, 2, html(2));
  assert.ok(cache.update('a', 1, 3, html(3)).html);
  cache.forget('a'); assert.ok(cache.update('a', 3, 4, html(4)).html);
  const tiny = new ReviewRowCache(16, 1); tiny.update('a', null, 1, html(1));
  assert.ok(tiny.update('a', 1, 2, html(2)).html);
  assert.ok(new ReviewRowCache().update('a', 1, 2, html(2)).html);
});

test('a large rewrite uses full-install fallback rather than an inflated patch', () => {
  const cache = new ReviewRowCache(); cache.update('a', null, 1, html(1));
  const rewrite = responsiveRenderedDiff('<p>Unrelated base</p>', '<p>Entirely new</p>', []);
  assert.ok(cache.update('a', 1, 2, rewrite).html);
});

test('standby seeding shares the exact source revision without overwriting a newer target', () => {
  const cache = new ReviewRowCache(); cache.update('a', null, 1, html(1));
  cache.seed('a', 'b', 1);
  assert.equal(cache.update('b', 1, 2, html(2)).patch?.baseRevision, 1);
  cache.seed('a', 'b', 1);
  assert.equal(cache.update('b', 2, 3, html(3)).patch?.baseRevision, 2);
  cache.seed('a', 'c', 999);
  assert.ok(cache.update('c', 999, 4, html(4)).html);
});

test('structured rows preserve parsed HTML, patches, A/B seeds and reset output', () => {
  const structured = new ReviewRowCache(); const parsed = new ReviewRowCache();
  const math = '<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html">x</span></span>';
  const original = base.replace('Shared 20', math);
  const variants = [original, original.replace('Shared 5', 'Edited 한글'),
    original.replace('<mi>x</mi>', '<mi>y</mi>'),
    `<p data-source-line="1">Inserted</p>${original.replace(/data-source-line="(\d+)"/g, (_, n) => `data-source-line="${Number(n) + 2}"`)}`,
    '<p>Entirely new</p>', ''];
  let revision = 0;
  for (const modified of variants) {
    const rows = responsiveRenderedRows(original, modified);
    const html = responsiveRenderedDiff(original, modified, []);
    assert.equal(serializeReviewRows(rows), html);
    assert.equal(reviewRowsHtmlLength(rows), html.length);
    assert.deepEqual(rows, readReviewRows(html));
    const baseRevision = revision || null;
    revision++;
    assert.deepEqual(structured.updateRows('a', baseRevision, revision, rows), parsed.update('a', baseRevision, revision, html));
    structured.seed('a', 'b', revision); parsed.seed('a', 'b', revision);
    // A lost ACK must still select full reset on both paths.
    assert.deepEqual(structured.updateRows('b', -1, revision, rows), parsed.update('b', -1, revision, html));
  }
});
