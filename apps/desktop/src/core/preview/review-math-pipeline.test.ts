import assert from 'node:assert/strict';
import { test } from 'vitest';
import { responsiveRenderedDiff } from './rendered-diff';
import { ReviewRowCache } from '../../main/preview/review-row-cache';

const math = (value: string) => `<span class="katex"><span class="katex-mathml"><math><mi>${value}</mi></math></span><span class="katex-html">${value}</span></span>`;
const paragraph = (text: string, formula = math('x'), line = 200) =>
  `<p data-source-line="${line}">${text} ${formula}</p>`;
function assemble(cache: ReviewRowCache, original: string, modified: string,
  revision: number, base: number | null = revision - 1, key = 'A') {
  const packed = cache.prepareMath(original, modified);
  const html = responsiveRenderedDiff(packed?.documents[0] ?? original, packed?.documents[1] ?? modified, []);
  assert.equal(packed ? packed.restore(html) : html, responsiveRenderedDiff(original, modified, []));
  return cache.update(key, base, revision, html, packed);
}

test('comparison preserves exact math output and surrounding word emphasis', () => {
  const cache = new ReviewRowCache();
  assemble(cache, paragraph('old'), paragraph('new'), 1, null);
  const next = assemble(cache, paragraph('old'), paragraph('newer'), 2);
  assert.ok(next.patch);
  assert.ok(!JSON.stringify(next).includes('data-setdown-opaque-math'));
});
test('changed rendered math never becomes an unchanged comparison', () => {
  const result = assemble(new ReviewRowCache(), paragraph('same'), paragraph('same', math('y')), 1, null);
  assert.ok(result.html?.includes('block-level change'));
  assert.ok(result.html?.includes('<mi>x</mi>') && result.html.includes('<mi>y</mi>'));
});
test('legacy single-quoted math follows exactly the legacy comparison path', () => {
  const formula = math('x').replaceAll('"', "'");
  assemble(new ReviewRowCache(), paragraph('old', formula), paragraph('new', formula), 1, null);
});
test('entities and duplicate equations preserve alignment and MathML', () => {
  const formula = math('&lt;x&gt;&amp;y') + math('&lt;x&gt;&amp;y');
  assemble(new ReviewRowCache(), paragraph('one', formula), paragraph('two', formula), 1, null);
});
test('source metadata inside math is never concealed from row shifts', () => {
  const formula = math('x').replace('<mi>', '<mi data-source-line="200">');
  const original = paragraph('text', formula);
  assemble(new ReviewRowCache(), original, original.replaceAll('="200"', '="201"'), 1, null);
});
test('lost patch acknowledgement forces a complete expanded reset', () => {
  const cache = new ReviewRowCache(), original = paragraph('old');
  assemble(cache, original, original, 1, null);
  assemble(cache, original, paragraph('new'), 2);
  const next = assemble(cache, original, paragraph('newer'), 3, 1);
  assert.equal(next.html, responsiveRenderedDiff(original, paragraph('newer'), []));
});
test('seeded A/B pages retain independent acknowledged revision bases', () => {
  const cache = new ReviewRowCache();
  const tail = Array.from({ length: 8 }, (_, i) => paragraph(`unchanged ${i}`, math('x'), 201 + i)).join('');
  const original = paragraph('old') + tail;
  assemble(cache, original, original, 1, null);
  cache.seed('A', 'B', 1);
  const a = assemble(cache, original, paragraph('next A') + tail, 2, 1, 'A');
  const b = assemble(cache, original, paragraph('next B') + tail, 3, 1, 'B');
  assert.equal(a.patch?.baseRevision, 1); assert.equal(b.patch?.baseRevision, 1);
});
test('authored internal-looking markers trigger raw fallback, never payload substitution', () => {
  const cache = new ReviewRowCache(), original = paragraph('old');
  assemble(cache, original, original, 1, null);
  const authored = paragraph('<span class="katex" data-setdown-opaque-math="m1">authored</span>');
  const next = assemble(cache, original, authored, 2);
  assert.equal(next.html, responsiveRenderedDiff(original, authored, []));
  const reset = assemble(cache, original, paragraph('normal again'), 3);
  assert.equal(reset.html, responsiveRenderedDiff(original, paragraph('normal again'), []));
});
