/* Run at the repository root:
 *   node apps/desktop/scripts/benchmark-block-math.cjs --isolated
 *   node apps/desktop/scripts/benchmark-block-math.cjs
 * --isolated measures only block-rule CPU on synthetic markdown-it line state.
 * Default measures actual Crossnote warm template generation + math restoration.
 * Neither mode measures native edit-to-Esc pixel presentation.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const app = path.resolve(__dirname, '..');
const oldTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0, `Failed to transpile ${filename}`);
  module._compile(output.outputText, filename);
};
const { fastBlockMath, installFastBlockMath } = require(path.join(app, 'src/main/preview/fast-block-math.ts'));
const { DeferredMath } = require(path.join(app, 'src/main/preview/deferred-math.ts'));
const { referenceBlockMath, stateFor } = require(path.join(app, 'test/fixtures/crossnote-block-math-0.9.35.ts'));
const median = (values) => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
const result = { node: process.version, cpu: os.cpus()[0]?.model, mode: process.argv.includes('--isolated') ? 'isolated-block-rule' : 'crossnote-template', results: [] };
const config = { mathRenderingOption: 'KaTeX', mathBlockDelimiters: [['$$','$$']] };

function isolated() {
  const original = referenceBlockMath(() => config); const optimized = fastBlockMath(original, () => config);
  for (const count of [100, 500, 1000]) {
    const lines = Array.from({length: count}, (_,i) => ['$$', `\\frac{x_${i}+1}{y_${i}+2} + \\sqrt{a^2+b^2}`, '$$', '']).flat();
    const run = (rule, state) => { state.line = 0; for (let i=0; i<count; i++) assert.equal(rule(state, i*4, lines.length, false),true); };
    const a = stateFor(lines); const b = stateFor(lines);
    run(original,a.state); run(optimized,b.state); assert.deepEqual(a.tokens,b.tokens);
    // Instrumented reads are NOT used in timed samples.
    const make = () => { const f=stateFor(lines); f.state.eMarks=Array.from(f.state.eMarks); return f; };
    const samples={original:[],optimized:[]};
    for (let batch=0; batch<10; batch++) {
      for (const [name,rule] of batch%2 ? [['optimized',optimized],['original',original]] : [['original',original],['optimized',optimized]]) {
        const f=make(); const start=performance.now(); run(rule,f.state); const elapsed=performance.now()-start;
        if (batch>=3) samples[name].push(elapsed);
      }
    }
    result.results.push({ blocks: count, sourceLines:lines.length, lineReads:{original:a.reads(),optimized:b.reads()},
      medianMs:{original:median(samples.original),optimized:median(samples.optimized)},samples });
  }
}

async function crossnote() {
  const { Notebook, getDefaultNotebookConfig } = require('crossnote');
  const { installSourceAnchors } = require(path.join(app,'src/main/preview/source-anchors.ts'));
  const out=path.resolve(path.dirname(require.resolve('crossnote')),'..');
  result.crossnote=JSON.parse(fs.readFileSync(path.join(out,'..','package.json'),'utf8')).version;
  assert.equal(result.crossnote,'0.9.35','Revalidate compatibility before benchmarking an upgraded engine');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'setdown-math-'));
  const decode=(template) => (template.match(/<body\b[^>]*\bdata-html="([^"]*)"/i)?.[1] ?? '')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  try {
    const make=async (fast) => {
      const notebook=await Notebook.init({notebookPath:root,config:{...getDefaultNotebookConfig(),enableScriptExecution:false,includeInHeader:'',globalCss:''}});
      const deferred=new DeferredMath();
      if(fast) {
        assert.equal(installFastBlockMath(notebook.md,()=>notebook.config,result.crossnote),true);
        deferred.install(notebook.md,()=>!notebook.config.katexConfig?.trust);
      } else {
        // Match the app's previous inline-only deferral, not a slower no-cache baseline.
        const inline={renderer:{rules:{math:notebook.md.renderer.rules.math}}};
        deferred.install(inline,()=>!notebook.config.katexConfig?.trust);
        notebook.md.renderer.rules.math=inline.renderer.rules.math;
      }
      installSourceAnchors(notebook.md);
      const engine=notebook.getNoteMarkdownEngine(path.join(root,'bench.md'));
      return async (text) => {
        deferred.reset(); const start=performance.now();
        const template=await engine.generateHTMLTemplateForPreview({inputString:text,config:{...notebook.config,sourceUri:'file://'+path.join(root,'bench.md'),isVSCode:false},vscodePreviewPanel:{},head:'',scripts:'',styles:''});
        const html=deferred.restore(decode(template));
        const ms=performance.now()-start;
        assert.equal(decode(deferred.restoreTemplate(template)),html,'full and fragment restoration disagree');
        return {html,ms};
      };
    };
    const original=await make(false); const optimized=await make(true);
    for(const count of [64,256]) {
      const text=Array.from({length:count},(_,i)=>`Paragraph ${i}.\n\n$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}+\\frac{1}{1+x_${i%4}^2}\n$$\n`).join('\n');
      const samples={original:[],optimized:[]};
      for(let batch=0;batch<9;batch++) {
        const input=text+`\nLatest edit ${batch}.\n`; const outputs={};
        for(const [name,render] of batch%2 ? [['optimized',optimized],['original',original]] : [['original',original],['optimized',optimized]]) {
          const response=await render(input); outputs[name]=response.html;
          if(batch>=2) samples[name].push(response.ms);
        }
        assert.equal(outputs.original,outputs.optimized,'Crossnote rendered output changed');
      }
      result.results.push({blocks:count,medianMs:{original:median(samples.original),optimized:median(samples.optimized)},samples});
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
(async()=>{
  try { if(result.mode==='isolated-block-rule') isolated(); else await crossnote(); console.log(JSON.stringify(result,null,2)); }
  finally {if(oldTs) require.extensions['.ts']=oldTs; else delete require.extensions['.ts'];}
})().catch(error=>{console.error(error);process.exitCode=1;});
