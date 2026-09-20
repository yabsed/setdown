import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fastBlockMath, installFastBlockMath, type BlockMathConfig, type BlockMathRule,
  type BlockMathParser } from './fast-block-math';

import { referenceBlockMath, stateFor } from '../../../test/fixtures/crossnote-block-math-0.9.35';

const standard: BlockMathConfig = { mathRenderingOption: 'KaTeX', mathBlockDelimiters: [['$$', '$$'], ['\\[', '\\]']] };

function equivalent(lines: string[], prefixes: number[] = [], options = standard, start = 0, end = lines.length) {
  for (const silent of [false, true]) {
    const a = stateFor(lines, prefixes); const b = stateFor(lines, prefixes);
    const original = referenceBlockMath(() => options);
    assert.equal(fastBlockMath(original, () => options)(a.state, start, end, silent), original(b.state, start, end, silent));
    assert.deepEqual(a.tokens, b.tokens); assert.equal(a.state.line, b.state.line);
  }
}

test('same-line, multiline, adjacent blocks, trailing source and missing delimiters match', () => {
  for (const lines of [['$$x$$'], ['$$', 'x+y', '$$', 'tail'], ['$$$$', '$$z$$'],
    ['$$x$$ trailing words'], ['$$never', 'closed'], ['normal text'], ['$$', '', '$$'],
    ['$$x\\$$y$$'], ['$$x\\\\$$'], ['$$x\\', '$$'], ['\\[', 'a\\]']]) equivalent(lines);
});
test('container-adjusted lines and bounded parsing ranges retain exact token maps', () => {
  equivalent(['> $$', '> a', '> $$', '> tail'], [2, 2, 2, 2]);
  equivalent(['  $$a', '    b', '  $$', 'tail'], [2, 4, 2, 0]);
  equivalent(['prefix', '$$', 'x', '$$', 'tail'], [], standard, 1, 4);
  equivalent(['$$', 'x', '$$'], [], standard, 0, 2);
  equivalent(['$$\r', 'x\r', '$$\r']);
});
test('disabled math and custom delimiters preserve upstream ordering and escapes', () => {
  equivalent(['$$x$$'], [], { ...standard, mathRenderingOption: 'None' });
  equivalent(['BEGIN a END', 'tail'], [], { ...standard, mathBlockDelimiters: [['BEGIN', 'END']] });
  equivalent(['<< a >>'], [], { ...standard, mathBlockDelimiters: [['<', '>'], ['<<', '>>']] });
  equivalent(['$$x$$'], [], { ...standard, mathBlockDelimiters: [] });
});
test('unusual newline delimiters fall back unchanged', () => {
  equivalent(['OPEN', 'x', 'CLOSE', 'END'], [], { ...standard, mathBlockDelimiters: [['OPEN\n', 'CLOSE\nEND']] });
  let calls = 0;
  const original: BlockMathRule = () => { calls++; return true; };
  assert.equal(fastBlockMath(original, () => ({ ...standard, mathBlockDelimiters: [['', '']] }))
    (stateFor(['$$']).state, 0, 1, false), true);
  assert.equal(calls, 1);
});
test('successful block parsing does not read the unrelated document suffix', () => {
  const lines = ['$$x$$', ...Array.from({ length: 10_000 }, () => 'unrelated source')];
  const original = referenceBlockMath(() => standard);
  const a = stateFor(lines); const b = stateFor(lines);
  fastBlockMath(original, () => standard)(a.state, 0, lines.length, false);
  original(b.state, 0, lines.length, false);
  assert.deepEqual(a.tokens, b.tokens);
  assert.ok(a.reads() <= 3); assert.ok(b.reads() >= 10_000);
});
test('installation is idempotent and an unknown version or missing rule is untouched', () => {
  const original = referenceBlockMath(() => standard);
  const entry = { name: 'math_block', fn: original }; let replacements = 0;
  const md: BlockMathParser = { block: { ruler: { __rules__: [entry], at(_name, rule) { entry.fn = rule; replacements++; } } } };
  assert.equal(installFastBlockMath(md, () => standard, '0.9.36'), false);
  assert.equal(entry.fn, original);
  assert.equal(installFastBlockMath(md, () => standard, '0.9.35'), true);
  assert.equal(installFastBlockMath(md, () => standard, '0.9.35'), false);
  assert.equal(replacements, 1);
  assert.equal(installFastBlockMath({ block: { ruler: { at() { assert.fail(); } } } }, () => standard, '0.9.35'), false);
});
test('seeded delimiter, escape, container and range combinations match the reference', () => {
  let seed = 7718;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const atoms = ['a', '$', '$$', '\\', '\\\\', ' ', '>', '\\]', '<'];
  for (let trial = 0; trial < 2500; trial++) {
    const quoted = random(2) === 1; const prefix = quoted ? '> ' : '';
    const lines = Array.from({ length: 1 + random(12) }, () => prefix + Array.from({ length: random(20) }, () => atoms[random(atoms.length)]).join(''));
    lines[0] = prefix + '$$' + lines[0].slice(prefix.length);
    equivalent(lines, lines.map(() => prefix.length));
  }
});
