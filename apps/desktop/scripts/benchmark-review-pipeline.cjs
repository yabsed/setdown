/** Real sample.md + production render bundle; CPU diagnostics, not pixel latency.
 * Run npm run build first, then node apps/desktop/scripts/benchmark-review-pipeline.cjs.
 * The port adapter runs the real worker serially in Node; Electron IPC is excluded.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { buildSync } = require('esbuild');
const desktop = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'setdown-review-cpu-'));
buildSync({ stdin: { contents: `export { responsiveRenderedDiff, responsiveRenderedRows } from './src/core/preview/rendered-diff';
  export { readReviewRows, diffReviewRows } from './src/core/preview/review-row-patch';
  export { ReviewRowCache } from './src/main/preview/review-row-cache';`, resolveDir: desktop },
  bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temporary, 'core.cjs') });
const { responsiveRenderedDiff, ReviewRowCache, readReviewRows, diffReviewRows } = require(path.join(temporary, 'core.cjs'));
// Independent analysis caches prevent the second path benefiting from the first.
fs.copyFileSync(path.join(temporary, 'core.cjs'), path.join(temporary, 'structured.cjs'));
const structuredCore = require(path.join(temporary, 'structured.cjs'));
const port = new EventEmitter();
let reply;
port.postMessage = (message) => reply(message);
process.parentPort = port;
require(path.join(desktop, 'dist-electron/render-worker.cjs'));
const file = path.resolve(process.argv[2] || path.join(desktop, 'test/fixtures/sample.md'));
const source = fs.readFileSync(file, 'utf8');
let revision = 0;
async function render(text) {
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    reply = (message) => message.ok ? resolve(message) : reject(new Error(message.message));
    port.emit('message', { data: { kind: 'render', id: ++revision, tabId: 'benchmark',
      text, revision, documentPath: file, themeId: 'github-light', roots: [path.dirname(file)],
      hasPage: false, deferOffscreenHtml: false, htmlOnly: true } });
  });
  return { html: result.html, ms: performance.now() - started };
}
function time(operation) {
  const start = performance.now();
  const result = operation();
  return { result, ms: performance.now() - start };
}
async function main() {
  const baseline = await render(source);
  console.log(JSON.stringify({ file, sourceBytes: Buffer.byteLength(source),
    htmlBytes: Buffer.byteLength(baseline.html), mathCount: (baseline.html.match(/class="katex"/g) || []).length,
    coldRenderMs: baseline.ms }));
  const cache = new ReviewRowCache();
  const structuredCache = new structuredCore.ReviewRowCache();
  let baseRevision = ++revision;
  const initial = time(() => responsiveRenderedDiff(baseline.html, baseline.html, []));
  const seed = time(() => cache.update('page', null, baseRevision, initial.result));
  structuredCache.updateRows('page', null, baseRevision, structuredCore.responsiveRenderedRows(baseline.html, baseline.html));
  let previousRows = readReviewRows(initial.result);
  console.log(JSON.stringify({ initialDiffMs: initial.ms, initialRowsMs: seed.ms,
    reviewBytes: Buffer.byteLength(initial.result) }));
  for (const scenario of ['prose', 'math', 'line-shift']) {
    const samples = [];
    for (let iteration = 0; iteration < 7; iteration++) {
      const text = scenario === 'prose' ? source.replace('**Scope.**', `**Scope.** Edited ${iteration}.`)
        : scenario === 'math' ? source.replace('Iv=v', `Iv=${iteration + 2}v`)
          : `New paragraph ${iteration}.\n${'\n'.repeat(iteration + 1)}${source}`;
      const rendered = await render(text);
      const diff = time(() => responsiveRenderedDiff(baseline.html, rendered.html, []));
      const nextRevision = ++revision;
      const rows = time(() => cache.update('page', baseRevision, nextRevision, diff.result));
      const structured = time(() => structuredCore.responsiveRenderedRows(baseline.html, rendered.html));
      const structuredUpdate = time(() => structuredCache.updateRows('page', baseRevision, nextRevision, structured.result));
      require('node:assert/strict').deepEqual(structuredUpdate.result, rows.result);
      const read = time(() => readReviewRows(diff.result));
      const compare = time(() => diffReviewRows(previousRows, read.result, baseRevision, nextRevision));
      previousRows = read.result;
      baseRevision = nextRevision;
      samples.push({ renderMs: rendered.ms, diffMs: diff.ms, rowsMs: rows.ms,
        rowReadMs: read.ms, rowCompareMs: compare.ms,
        structuredDiffMs: structured.ms, structuredRowsMs: structuredUpdate.ms,
        patch: !!rows.result.patch, payloadBytes: Buffer.byteLength(JSON.stringify(rows.result)) });
    }
    const median = (key) => {
      const ordered = samples.slice(1).map((s) => s[key]).sort((a, b) => a - b);
      return (ordered[2] + ordered[3]) / 2;
    };
    console.log(JSON.stringify({ scenario, samples, medianExcludingFirst: {
      renderMs: median('renderMs'), diffMs: median('diffMs'), rowsMs: median('rowsMs'),
      rowReadMs: median('rowReadMs'), rowCompareMs: median('rowCompareMs'),
      structuredDiffMs: median('structuredDiffMs'), structuredRowsMs: median('structuredRowsMs') } }));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temporary, { recursive: true, force: true }));
