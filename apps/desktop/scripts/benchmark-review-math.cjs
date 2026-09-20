/** CPU-only synthetic benchmark. NOT KaTeX execution, DOM, Electron or Esc latency.
 * Run from a complete checkout with dev dependencies:
 *   node apps/desktop/scripts/benchmark-review-math.cjs
 * A verified baseline file can replace git show in an isolated environment:
 *   node .../benchmark-review-math.cjs --baseline-file=/path/to/review-row-cache.ts
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baselineRef = '222f58a65a0d48a2d703dfea2f8077e386bda1a2';
const baselineSha = '2a20590ea809fe9b412f25df0bc0bd26857ea8fe';
const baselineArg = process.argv.find((value) => value.startsWith('--baseline-file='));
const baseline = baselineArg ? fs.readFileSync(baselineArg.slice('--baseline-file='.length), 'utf8')
  : execFileSync('git', ['show', `${baselineRef}:apps/desktop/src/main/preview/review-row-cache.ts`],
    { cwd: root, encoding: 'utf8' });
const bytes = Buffer.from(baseline);
assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), baselineSha,
  'Benchmark baseline must be the exact pre-change implementation.');

// Execute repository TypeScript with its actual relative dependencies; no math,
// alignment, highlighting or row-patch stubs. This is NOT the Vitest runner.
const modules = new Map();
const baselinePath = path.join(root, 'src/main/preview/review-row-cache.baseline.ts');
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const source = filename === baselinePath ? baseline : fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const errors = (result.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${filename}: ${errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')).join('\n')}`);
  const module = { exports: {} }; modules.set(filename, module);
  const localRequire = (id) => id.startsWith('.')
    ? load(path.resolve(path.dirname(filename), `${id}.ts`)) : require(id);
  new Function('require', 'module', 'exports', result.outputText)(localRequire, module, module.exports);
  return module.exports;
}
const { ReviewRowCache: Before } = load(baselinePath);
const { ReviewRowCache: After } = load(path.join(root, 'src/main/preview/review-row-cache.ts'));
const { responsiveRenderedDiff: render } = load(path.join(root, 'src/core/preview/rendered-diff.ts'));
const math = (x, repeat = 3) => `<span class="katex"><span class="katex-mathml"><math><mi>${x}</mi></math></span><span class="katex-html">${'<span class="mord"><span class="vlist">x</span></span>'.repeat(repeat)}</span></span>`;
const html = (items, repeat = 3) => items.map((v) => `<${v.tag} data-source-line="${v.line}">${v.text} ${math(v.math, repeat)}</${v.tag}>`).join('\n');
function compact(cache, original, modified, revision) {
  const packed = cache.prepareMath(original, modified);
  assert.ok(packed);
  const result = render(packed.documents[0], packed.documents[1], []);
  return { expanded: packed.restore(result),
    update: cache.update('A', revision === 1 ? null : revision - 1, revision, result, packed) };
}
let seed = 38;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
let equivalenceCases = 0;
for (let corpus = 0; corpus < 30; corpus++) {
  let items = Array.from({ length: 20 }, (_, i) => ({ tag: i % 3 ? 'p' : 'blockquote',
    text: `prose ${i}`, math: `x${i % 5}`, line: i * 3 + 1 }));
  const original = html(items), before = new Before(), after = new After();
  for (let revision = 1; revision <= 30; revision++) {
    const i = random() % items.length;
    items = items.map((v) => ({ ...v }));
    switch (random() % 6) {
      case 0: items[i].text += ' text'; break;
      case 1: items[i].math += 'y'; break;
      case 2: items.splice(i, 0, { tag: 'p', text: `insert${revision}`, math: 'x', line: i * 3 + 1 }); break;
      case 3: if (items.length > 1) items.splice(i, 1); break;
      case 4: items.forEach((v) => v.line++); break;
      case 5: items[i].tag = items[i].tag === 'p' ? 'blockquote' : 'p'; break;
    }
    const modified = html(items), expected = render(original, modified, []);
    const actual = compact(after, original, modified, revision);
    assert.equal(actual.expanded, expected);
    assert.deepEqual(actual.update, before.update('A', revision === 1 ? null : revision - 1, revision, expected));
    equivalenceCases++;
  }
}
const items = Array.from({ length: 80 }, (_, i) => ({ tag: 'p', text: `prose ${i}`, math: `x${i % 7}`, line: i * 3 + 1 }));
const original = html(items, 160);
const inputs = Array.from({ length: 10 }, (_, j) => html(items.map((v, i) => i === 35
  ? { ...v, text: v.text + 'z'.repeat(j) } : v), 160));
const samples = { before: [], after: [] };
let compactReviewBytes = 0;
for (let run = 0; run < 8; run++) {
  for (const name of run % 2 ? ['after', 'before'] : ['before', 'after']) {
    const cache = new (name === 'before' ? Before : After)();
    const step = (j) => {
      if (name === 'before') cache.update('A', j === 0 ? null : j, j + 1, render(original, inputs[j], []));
      else {
        const packed = cache.prepareMath(original, inputs[j]);
        assert.ok(packed);
        const result = render(packed.documents[0], packed.documents[1], []);
        compactReviewBytes = Buffer.byteLength(result);
        cache.update('A', j === 0 ? null : j, j + 1, result, packed);
      }
    };
    step(0);
    const started = performance.now();
    for (let j = 1; j < inputs.length; j++) step(j);
    samples[name].push((performance.now() - started) / (inputs.length - 1));
  }
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
console.log(JSON.stringify({ scope: 'synthetic comparison + row-patch CPU; not native presentation',
  node: process.version, baselineRef, equivalenceCases,
  sourceHtmlBytes: Buffer.byteLength(original),
  reviewHtmlBytes: Buffer.byteLength(render(original, inputs.at(-1), [])), compactReviewBytes,
  medianMs: { before: median(samples.before), after: median(samples.after) }, samples }, null, 2));
