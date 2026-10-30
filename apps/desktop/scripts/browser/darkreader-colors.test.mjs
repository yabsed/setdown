import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lightColorSource, readableLightText, patchDarkReaderColors } from './darkreader-colors.mjs';

test('light-dark colors retain nested variable fallbacks, gradients and quoted text', () => {
  assert.equal(lightColorSource('light-dark(var(--article,var(--light-article,#fff)),var(--dark,#111))'), 'var(--article,var(--light-article,#fff))');
  assert.equal(lightColorSource('linear-gradient(light-dark(rgb(10, 20, 30), black), light-dark(white, #222))'), 'linear-gradient(rgb(10, 20, 30), white)');
  assert.equal(lightColorSource('"light-dark(red, blue)" url("/light-dark(a,b).png")'), '"light-dark(red, blue)" url("/light-dark(a,b).png")');
  assert.equal(lightColorSource('light-dark(light-dark(red,blue), black)'), 'red');
  assert.equal(lightColorSource('light-dark(red) light-dark(red,blue'), 'light-dark(red) light-dark(red,blue');
  assert.equal(lightColorSource('url(/light-dark(red,blue).png) light-dark(red,blue,green)'), 'url(/light-dark(red,blue).png) light-dark(red,blue,green)');
});
test('pinned Dark Reader integration fails closed when its read paths change', () => {
  for (const file of ['css-rules.ts', 'modify-css.ts', 'modify-colors.ts', 'index.ts', 'stylesheet-proxy.ts']) {
    const source = readFileSync(new URL(`../../../../vendor/darkreader/src/inject/dynamic-theme/${file}`, import.meta.url), 'utf8');
    assert.notEqual(patchDarkReaderColors(source, file), source);
    assert.throws(() => patchDarkReaderColors('', file), /Review/);
    assert.throws(() => patchDarkReaderColors(source + source, file), /Review/);
  }
});
test('light text correction preserves white header text and existing dark colors', () => {
  assert.equal(readableLightText({r:255,g:255,b:255,a:1}, '#fdf6e3', '#fdf6e3', '#586e75'), '#fdf6e3');
  assert.equal(readableLightText({r:0,g:0,b:0,a:1}, '#586e75', '#fdf6e3', '#586e75'), '#586e75');
  const corrected = readableLightText({r:169,g:169,b:169,a:1}, '#f7da8c', '#fdf6e3', '#586e75');
  assert.notEqual(corrected, '#f7da8c');
  assert.match(corrected, /^#[\da-f]{6}$/);
});
