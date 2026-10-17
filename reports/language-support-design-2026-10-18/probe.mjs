import assert from 'node:assert/strict';
import { fork, execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// No application source, settings, or dependencies are changed.
// The only file written is this investigation's probe-results.json.
// This executes Monaco's installed worker implementation in Node, not a GUI test.
const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const sourcePath = path.join(root, 'apps/desktop/src/main/project/explorer-clipboard.test.ts');
const sourceText = readFileSync(sourcePath, 'utf8');
const workerPath = path.join(root, 'node_modules/monaco-editor/esm/vs/languages/features/typescript/tsWorker.js');
const bundled = await build({ entryPoints: [workerPath], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports);
const { TypeScriptWorker } = module.exports;
const options = { allowNonTsExtensions: true, target: 99 };
const model = (uri, text) => ({ uri: { path: new URL(uri).pathname, toString: () => uri }, version: 1, getValue: () => text });
const summarize = diagnostics => diagnostics.map(diagnostic => ({
  code: diagnostic.code,
  message: ts.flattenDiagnosticMessageText(diagnostic.messageText ?? diagnostic.text, '\n'),
}));
async function workerDiagnostics(models, compilerOptions = options) {
  const worker = new TypeScriptWorker({ getMirrorModels: () => models }, { compilerOptions, extraLibs: {} });
  const file = models[0].uri.toString();
  return { semantic: summarize(await worker.getSemanticDiagnostics(file)), syntax: summarize(await worker.getSyntacticDiagnostics(file)) };
}
const observedUri = `${pathToFileURL(sourcePath).href}?investigation-tab`;
const singleModel = await workerDiagnostics([model(observedUri, sourceText)]);
assert(singleModel.semantic.some(d => d.code === 2792 && d.message.includes("'vitest'")));
assert(singleModel.semantic.some(d => d.code === 2792 && d.message.includes("'./explorer-clipboard'")));
const configPath = path.join(root, 'apps/desktop/tsconfig.json');
const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, path.dirname(configPath));
assert.equal(config.errors.length, 0);
const resolvedImports = Object.fromEntries(['vitest', './explorer-clipboard'].map(name => [name,
  path.relative(root, ts.resolveModuleName(name, sourcePath, config.options, ts.sys).resolvedModule.resolvedFileName),
]));
const pair = suffix => [
  model(`file:///setdown-investigation/main.ts${suffix && '?main-tab'}`, "import { value } from './sibling'; export const result: number = value;"),
  model(`file:///setdown-investigation/sibling.ts${suffix && '?sibling-tab'}`, 'export const value = 42;'),
];
const canonicalPair = await workerDiagnostics(pair(''));
const queriedPair = await workerDiagnostics(pair('query'));
assert.equal(canonicalPair.semantic.length, 0);
assert(queriedPair.semantic.some(d => d.code === 2792));
const syntaxControl = await workerDiagnostics([model('file:///setdown-investigation/broken.ts', 'export const value = ;')]);
assert(syntaxControl.syntax.length > 0);
const jsxOptions = { ...options, jsx: 1 };
const jsxText = 'export const view = <div>hello</div>;';
const canonicalTsx = await workerDiagnostics([model('file:///setdown-investigation/view.tsx', jsxText)], jsxOptions);
const queriedTsx = await workerDiagnostics([model('file:///setdown-investigation/view.tsx?view-tab', jsxText)], jsxOptions);
assert.equal(canonicalTsx.syntax.length, 0);
assert(queriedTsx.syntax.length > 0);

async function tsserverProbe() {
  const { NODE_OPTIONS: _options, ELECTRON_RUN_AS_NODE: _electron, ...environment } = process.env;
  const child = fork(require.resolve('typescript/lib/tsserver.js'), ['--useNodeIpc', '--useInferredProjectPerProjectRoot', '--disableAutomaticTypingAcquisition'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env: { ...environment, TSS_LOG: '' },
  });
  let sequence = 0, stderr = '';
  const pending = new Map();
  const exited = new Promise(resolve => child.once('exit', (code, signal) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`tsserver exited (${signal ?? code}): ${stderr}`)); }
    pending.clear(); resolve();
  }));
  child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  child.stdout.resume();
  child.on('message', message => {
    if (message.type === 'response') {
      const request = pending.get(message.request_seq);
      if (request) {
        pending.delete(message.request_seq); clearTimeout(request.timer);
        if (message.success) request.resolve(message.body);
        else request.reject(new Error(message.message));
      }
    }
  });
  const request = (command, args) => new Promise((resolve, reject) => {
    const seq = ++sequence;
    const timer = setTimeout(() => { pending.delete(seq); reject(new Error(`tsserver timed out: ${command}; ${stderr}`)); }, 30000);
    pending.set(seq, { resolve, reject, timer });
    child.send({ seq, type: 'request', command, arguments: args });
  });
  try {
    await request('open', { file: sourcePath, fileContent: sourceText, projectRootPath: path.dirname(configPath) });
    const project = await request('projectInfo', { file: sourcePath, needFileNameList: false });
    const diagnostics = await request('semanticDiagnosticsSync', { file: sourcePath });
    assert.equal(diagnostics.length, 0);
    assert.equal(path.resolve(project.configFileName), configPath);
    await request('close', { file: sourcePath });
    await request('open', { file: sourcePath, fileContent: sourceText + "\nimport './__setdown_missing_probe_module__';\nimport { missingProbe } from './__setdown_missing_probe_module__';\nconst __setdownProbe: number = 'wrong'; void __setdownProbe; void missingProbe;\n", projectRootPath: path.dirname(configPath) });
    const invalidDiagnostics = await request('semanticDiagnosticsSync', { file: sourcePath });
    assert(invalidDiagnostics.some(d => d.code === 2307));
    assert(invalidDiagnostics.some(d => d.code === 2322));
    return { projectConfig: path.relative(root, project.configFileName), diagnostics: summarize(diagnostics), unsavedNegativeControl: summarize(invalidDiagnostics) };
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.kill();
    await exited;
  }
}
const server = await tsserverProbe();
const gitHead = cwd => new Promise((resolve, reject) => execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
const result = {
  date: '2026-10-18',
  method: 'Installed Monaco TypeScriptWorker instantiated in Node and a real local tsserver process. No Electron UI or VS Code UI execution.',
  setdownCommit: await gitHead(root),
  vscodeCommit: await gitHead(path.join(root, 'vendor/vscode')),
  versions: { typescript: ts.version, monaco: JSON.parse(readFileSync(path.join(root, 'node_modules/monaco-editor/package.json'), 'utf8')).version },
  source: path.relative(root, sourcePath),
  projectModuleResolution: ts.ModuleResolutionKind[config.options.moduleResolution], resolvedImports,
  singleModel, canonicalPair, queriedPair,
  tsx: { canonicalSyntax: canonicalTsx.syntax, queriedSyntax: queriedTsx.syntax },
  syntaxControl: syntaxControl.syntax, tsserver: server,
};
writeFileSync(path.join(directory, 'probe-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
