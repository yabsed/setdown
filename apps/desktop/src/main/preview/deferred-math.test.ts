import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { MarkdownItLike } from './source-anchors';
import { DeferredMath, encodeMathAttribute } from './deferred-math';

function fixture() {
  const inline = '<span class="katex"><math><mi>&lt;x&amp;y&gt;</mi></math><span>a</span></span>';
  const block = '<span class="katex-display">' + inline + '</span>';
  const math = new DeferredMath(); let allowed = true; const calls: string[] = [];
  const rules = { math: () => { calls.push('inline'); return inline; }, math_block: () => { calls.push('block'); return block; } };
  const md = { renderer: { rules } } as unknown as MarkdownItLike;
  math.reset(); math.install(md, () => allowed);
  return { math, md, inline, block, calls, rules, deny: () => { allowed = false; } };
}
test('both inline and block math stay opaque and restore byte-exact HTML/MathML', () => {
  const f = fixture(); const a = f.rules.math(); const b = f.rules.math_block();
  assert.ok(!a.includes('<math>') && !b.includes('<math>'));
  assert.equal(f.math.restore(a + b), f.inline + f.block);
  assert.deepEqual(f.calls, ['inline', 'block']);
});
test('source range wrappers outside the placeholder survive fragment and template restoration', () => {
  const f = fixture(); const placeholder = f.rules.math_block();
  const wrap = (body: string) => `<div class="crossnote-math-source" data-source-line="200" data-source-lines="200-208">${body}</div>`;
  assert.equal(f.math.restore(wrap(placeholder)), wrap(f.block));
  assert.equal(f.math.restoreTemplate(`<body data-html="${encodeMathAttribute(wrap(placeholder))}">`),
    `<body data-html="${encodeMathAttribute(wrap(f.block))}">`);
});
test('quotes and entities are encoded exactly once in full-page payloads', () => {
  const f = fixture(); const value = f.rules.math();
  assert.equal(f.math.restoreTemplate(encodeMathAttribute(value)), encodeMathAttribute(f.inline));
});
test('reset releases old output; stale and authored numeric placeholders are not substituted', () => {
  const f = fixture(); const old = f.rules.math();
  const authored = '<span data-marktex-math="0"></span>';
  assert.equal(f.math.restore(authored), authored);
  f.math.reset(); const next = f.rules.math_block();
  assert.notEqual(old, next); assert.equal(f.math.restore(old), old);
  assert.equal(f.math.restore(next), f.block);
});
test('HTML-enabled math and error output retain the normal sanitizer path', () => {
  const f = fixture(); f.deny(); assert.equal(f.rules.math_block(), f.block);
  const error = '<span style="color:red">Invalid <img src=x onerror=bad></span>';
  const md = { renderer: { rules: { math_block: () => error } } } as unknown as MarkdownItLike;
  f.math.install(md, () => true);
  assert.equal(md.renderer.rules.math_block!([], 0, {}, {}, {}), error);
});
test('double installation does not nest wrappers; missing renderers remain missing', () => {
  const f = fixture(); f.math.install(f.md, () => true);
  assert.equal(f.math.restore(f.rules.math_block()), f.block); assert.equal(f.calls.length, 1);
  const empty = { renderer: { rules: {} } } as unknown as MarkdownItLike;
  f.math.install(empty, () => true); assert.deepEqual(empty.renderer.rules, {});
});
test('unknown slots and markers with extra attributes are left to ordinary HTML handling', () => {
  const f = fixture(); const marker = f.rules.math();
  const invalid = marker.replace(':0"', ':999"'); assert.equal(f.math.restore(invalid), invalid);
  const decorated = marker.replace('<span ', '<span class="authored" ');
  assert.equal(f.math.restore(decorated), decorated);
});
