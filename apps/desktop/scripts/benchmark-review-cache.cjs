/** Compare exact diff outputs and a synthetic CPU-only workload.
 * From a full checkout with desktop dependencies installed:
 *   node apps/desktop/scripts/benchmark-review-cache.cjs
 * Not a browser, KaTeX, Electron, or Escape latency benchmark. No timing gate.
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../src/core/preview');
const baseRef = '1e35a904c849dac8f70cef9dcc9c3c722f219d6d';
// Optional baseline file supports a snapshot-only validation environment.
const baseline = process.argv[2] ? fs.readFileSync(path.resolve(process.argv[2]), 'utf8')
  : execFileSync('git', ['show', `${baseRef}:apps/desktop/src/core/preview/rendered-diff.ts`],
      { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
function load(file, cache = new Map(), source) {
  if(cache.has(file)) return cache.get(file).exports;
  const mod = {exports:{}}; cache.set(file,mod);
  const out = ts.transpileModule(source ?? fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const req = id => load(path.resolve(root,id+'.ts'),cache);
  new Function('require','module','exports',out)(req,mod,mod.exports); return mod.exports;
}
const before = load(path.join(root,'rendered-diff.ts'), new Map(), baseline);
const after = load(path.join(root,'rendered-diff.ts'));
const math = '<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html">x</span></span>';
const corpus = ['', '<p data-source-line="1">Hello world</p>', '<p data-source-line="1">Hello friend</p>',
 '<p data-source-line="3">Hello world</p>', `<p data-source-line="1">한국어 ${math}</p>`,
 `<p data-source-line="1">한국어 변경 ${math}</p>`, `<p data-source-line="1">한국어 ${math.replaceAll('>x<','>y<')}</p>`,
 '<ul data-source-line="1"><li>a</li><li>b</li></ul>', '<pre><code>&lt;span&gt;safe&lt;/span&gt;</code></pre>',
 '<p>a</p><p>a</p><p>b</p>', '<p>a</p><p>b</p><p>a</p>', '<svg><text>test</text></svg>',
 '<p style="color:red">a</p>', '<p style="color:blue">a</p>'];
let checked = 0;
for (let round=0;round<3;round++) for(const a of corpus) for(const b of corpus) {
  assert.equal(after.responsiveRenderedDiff(a,b,[]),before.responsiveRenderedDiff(a,b,[]));
  assert.equal(after.mergeRenderedDiff(a,b,[]),before.mergeRenderedDiff(a,b,[])); checked+=2;
}

// CPU-only synthetic accumulated-edit benchmark; not KaTeX generation or Electron.
const bigMath = '<span class="katex">'+('<span class="mord">x</span>'.repeat(400))+'</span>';
const original=Array.from({length:40},(_,i)=>`<p data-source-line="${i+1}">before ${i} ${bigMath}</p>`).join('');
const variants=Array.from({length:12},(_,v)=>Array.from({length:40},(_,i)=>`<p data-source-line="${i+1}">${i<20?'after':'before'} ${i} ${i===21?'edit'+v:''} ${bigMath}</p>`).join(''));
for(const b of variants) assert.equal(after.responsiveRenderedDiff(original,b,[]),before.responsiveRenderedDiff(original,b,[]));
function measure(fn){const values=[]; for(let round=0;round<3;round++)for(const b of variants){const t=performance.now();fn(original,b,[]);values.push(performance.now()-t);}return values.sort((a,b)=>a-b)[Math.floor(values.length/2)];}
const result={equivalentOutputs:checked+variants.length, fixture:'40 synthetic math-containing blocks; 20 prior edits; 12 further edits',originalBytes:Buffer.byteLength(original),
  beforeMedianMs:measure(before.responsiveRenderedDiff),afterMedianMs:measure(after.responsiveRenderedDiff),scope:'rendered-diff CPU only, no KaTeX execution, DOM, Electron, native frames'};
console.log(JSON.stringify({ baseRef, node: process.version, typescript: ts.version, ...result }, null, 2));
