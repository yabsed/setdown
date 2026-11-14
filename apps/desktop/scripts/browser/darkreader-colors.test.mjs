import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lightColorSource, rawColorDefault, rawHSLColor, readableLightText, simpleRawColor, patchDarkReaderColors } from './darkreader-colors.mjs';

test('light-dark colors retain nested variable fallbacks, gradients and quoted text', () => {
  assert.equal(lightColorSource('light-dark(var(--article,var(--light-article,#fff)),var(--dark,#111))'), 'var(--article,var(--light-article,#fff))');
  assert.equal(lightColorSource('linear-gradient(light-dark(rgb(10, 20, 30), black), light-dark(white, #222))'), 'linear-gradient(rgb(10, 20, 30), white)');
  assert.equal(lightColorSource('"light-dark(red, blue)" url("/light-dark(a,b).png")'), '"light-dark(red, blue)" url("/light-dark(a,b).png")');
  assert.equal(lightColorSource('light-dark(light-dark(red,blue), black)'), 'red');
  assert.equal(lightColorSource('light-dark(red) light-dark(red,blue'), 'light-dark(red) light-dark(red,blue');
  assert.equal(lightColorSource('url(/light-dark(red,blue).png) light-dark(red,blue,green)'), 'url(/light-dark(red,blue).png) light-dark(red,blue,green)');
});
test('pinned Dark Reader integration fails closed when its read paths change', () => {
  for (const file of ['css-rules.ts', 'modify-css.ts', 'modify-colors.ts', 'index.ts', 'stylesheet-proxy.ts', 'variables.ts']) {
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
test('raw HSL tokens are themed in their own component form', () => {
  const token = rawHSLColor('48 33.3% 97.1%');
  assert.deepEqual(token.rgb, { r: 250, g: 249, b: 245, a: 1 });
  assert.equal(token.restore('#fdf6e3'), '43.846 86.667% 94.118%');
  assert.equal(rawHSLColor('0, 0%, 100%').restore('rgb(36, 41, 46)'), '210, 12.195%, 16.078%');
  assert.deepEqual(rawHSLColor('0.5turn 100% 50%').rgb, { r: 0, g: 255, b: 255, a: 1 });
  assert.deepEqual(rawHSLColor('-120deg 100% 50%').rgb, { r: 0, g: 0, b: 255, a: 1 });
  assert.equal(token.restore('var(--darkreader-background-ffffff, #fdf6e3)'), '48 33.3% 97.1%');
  for (const value of ['250 249 245', '250, 249, 245', '210 40%', '0 5% 110%', '48 33.3% 97.1% / .5', 'initial', '1']) assert.equal(rawHSLColor(value), null, value);
});
test('only a single color token with an optional alpha stays on the variable path', () => {
  for (const value of ['hsl(var(--bg))', 'hsl(var(--bg) / 1)', 'hsl(var(--bg)/24%)', 'hsla(var(--bg) / 35%)', 'hsla(var(--bg), 0.5)',
    'hsl(var(--bg) / var(--tw-bg-opacity))', 'hsl(var(--bg) / var(--tw-bg-opacity, 1))', 'rgb(var(--bg))', 'rgba(var(--bg), .5)']) assert.equal(simpleRawColor(value), true, value);
  for (const value of ['hsl(var(--hs), 50%)', 'hsl(var(--hs), var(--l))', 'hsl(var(--h) var(--s) var(--l))', 'hsl(var(--h), var(--s), var(--l))',
    'hsl(from var(--bg) h s l / .5)', 'hsl(var(--bg) / calc(var(--a) * 2))', 'hsl(var(--bg)) transparent', 'rgb(var(--bg) / var(--a))', 'var(--bg)']) assert.equal(simpleRawColor(value), false, value);
  assert.equal(rawColorDefault('rgb(var(--bg))', true), '255, 255, 255');
  assert.equal(rawColorDefault('rgba(var(--ink), .5)', false), '0, 0, 0');
  assert.equal(rawColorDefault('hsl(var(--bg) / .5)', true), '0 0% 100%');
  assert.equal(rawColorDefault('hsla(var(--ink), .5)', false), '0, 0%, 0%');
});
