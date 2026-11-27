import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { readerMathCss } from './reader-math-css.mjs';

const katex = path.dirname(path.dirname(createRequire(import.meta.url).resolve('katex')));

test('the installed KaTeX style sheet is embedded with one WOFF2 file per font face', () => {
  const read = [];
  const css = readerMathCss(readFileSync(path.join(katex, 'dist/katex.min.css'), 'utf8'), file => { read.push(file); return readFileSync(path.join(katex, 'dist/fonts', file)); });
  assert.equal(read.length, css.match(/@font-face/g).length);
  assert.ok(read.length >= 20 && read.every(file => file.endsWith('.woff2')));
  assert.ok(!/url\((?!data:font\/woff2;base64,)/.test(css));
  // WOFF2 files start with the signature "wOF2".
  assert.ok(css.includes(`url(data:font/woff2;base64,${Buffer.from('wOF2').toString('base64').slice(0, 5)}`));
  assert.match(css, /\.katex\b/);
});

test('a style sheet whose font faces are worded differently is refused', () => {
  assert.throws(() => readerMathCss('@font-face{font-family:X;src:url(other/X.woff) format("woff")}', () => Buffer.alloc(0)), /not all embedded/);
  assert.throws(() => readerMathCss('.katex{color:red}', () => Buffer.alloc(0)), /not all embedded/);
});
