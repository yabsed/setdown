// Read-only notebook analysis. No kernel, GUI, notebook execution or project edits.
// Usage: node probe.cjs /absolute/notebook.ipynb /absolute/python
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');

const repo = path.resolve(__dirname, '../..');
const [notebook, python] = process.argv.slice(2);
assert(notebook && python && path.isAbsolute(notebook) && path.isAbsolute(python));
const source = fs.readFileSync(notebook);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const data = JSON.parse(source);
const sourceDirectory = path.resolve(path.dirname(notebook), '../../vlm-flash/src');
assert(fs.existsSync(path.join(sourceDirectory, 'vlmflash/__init__.py')));
const temporary = fs.mkdtempSync(path.join(__dirname, '.probe-'));
const configFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'setdown-import-config-'));

esbuild.buildSync({
  stdin: { contents: [
    "export { ServerSession } from './apps/desktop/src/main/language/server-session';",
    "export { notebookPythonAnalysis } from './apps/desktop/src/main/language/python-analysis';",
    "export { notebookClientCapabilities } from './apps/desktop/src/protocol/language-features';",
    "export { languageRoot } from './apps/desktop/src/main/language/language-root';",
    "export { builtinLanguageServers } from './apps/desktop/src/main/language/catalog/profiles';",
  ].join('\n'), resolveDir: repo, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  outfile: path.join(temporary, 'adapter.cjs'), logLevel: 'silent',
});
const { ServerSession, notebookPythonAnalysis, notebookClientCapabilities,
  languageRoot, builtinLanguageServers } = require(path.join(temporary, 'adapter.cjs'));
const profile = builtinLanguageServers.find(p => p.id === 'pyright');
const root = languageRoot(notebook, profile);
const targetIndex = data.cells.findIndex(c => c.cell_type === 'code' && c.source.join('').includes('import vlmflash'));
const targetId = `cell-${targetIndex}`;
const missing = 'setdown_import_probe_nonexistent_8fd913';

async function analyze(name, file, analysisRoot, pythonExtra, basedExtra) {
  const notebookUri = pathToFileURL(file).href;
  const cells = [
    { id: '', text: 'from IPython import get_ipython as get_ipython' },
    ...data.cells.flatMap((c, i) => c.cell_type === 'code' ? [{ id: `cell-${i}`, text: c.source.join('') }] : []),
    { id: 'negative-control', text: `import ${missing}` },
  ].map(c => ({ ...c, uri: notebookUri.replace(/^file:/, 'vscode-notebook-cell:') + '#' + c.id + '.0' }));
  const target = cells.find(c => c.id === targetId);
  const negative = cells.at(-1);
  const diagnostics = new Map();
  let failure;
  const server = new ServerSession({ executable: process.execPath,
    args: [require.resolve('basedpyright/langserver.index.js'), '--stdio'], env: process.env }, analysisRoot,
  params => diagnostics.set(params.uri, params), error => { failure = error; }, {
    name: 'Notebook Python', capabilities: notebookClientCapabilities(), watches: () => false,
    initializationOptions: { disablePullDiagnostics: true },
    configuration: {
      python: { pythonPath: python, analysis: { ...notebookPythonAnalysis, ...pythonExtra } },
      basedpyright: { analysis: { ...notebookPythonAnalysis, ...basedExtra } },
    },
  });
  try {
    const capabilities = await server.ready;
    assert(capabilities.notebookDocumentSync, 'Native notebook synchronization required');
    await server.notify('notebookDocument/didOpen', {
      notebookDocument: { uri: notebookUri, notebookType: 'jupyter-notebook', version: 1,
        cells: cells.map(c => ({ kind: 2, document: c.uri })) },
      cellTextDocuments: cells.map(c => ({ uri: c.uri, languageId: 'python', version: 1, text: c.text })),
    });
    const deadline = Date.now() + 45000;
    while (!diagnostics.has(target.uri) || !diagnostics.has(negative.uri)) {
      if (failure) throw Error(failure);
      if (Date.now() > deadline) throw Error(`${name}: missing diagnostic publication`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const position = { line: 1, character: 10 };
    const hover = await server.request('textDocument/hover', { textDocument: { uri: target.uri }, position });
    const definition = await server.request('textDocument/definition', { textDocument: { uri: target.uri }, position });
    const result = { name, root: analysisRoot,
      target: diagnostics.get(target.uri), negativeControl: diagnostics.get(negative.uri),
      hover, definition, logs: server.logs.slice() };
    const missingImport = result.target.diagnostics.some(d => d.code === 'reportMissingImports' && d.message.includes('vlmflash'));
    const shouldResolve = name === 'basedpyright-extraPaths' || name === 'project-config';
    assert.equal(missingImport, !shouldResolve, `${name}: expected import resolution`);
    assert(result.negativeControl.diagnostics.some(d => d.code === 'reportMissingImports'), 'Real missing imports remain diagnosed');
    if (shouldResolve) {
      assert(JSON.stringify(hover).includes('Neuron Chunking'), `${name}: module docstring missing`);
      assert(JSON.stringify(definition).includes('vlmflash/__init__.py'), `${name}: definition missing`);
    }
    console.log(JSON.stringify({ name, importDiagnostic: result.target.diagnostics,
      hoverHasDocstring: JSON.stringify(hover).includes('Neuron Chunking'), definition,
      negativeControlPreserved: true }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({ name, failure, logs: server.logs }));
    throw error;
  } finally { await server.stop(); }
}

(async () => {
  const results = [];
  results.push(await analyze('current-settings', notebook, root.path, {}, {}));
  results.push(await analyze('python-extraPaths-only', notebook, root.path, { extraPaths: [sourceDirectory] }, {}));
  results.push(await analyze('basedpyright-extraPaths', notebook, root.path, {}, { extraPaths: [sourceDirectory] }));

  // Test the proposed project-level config without writing into the user's project.
  fs.mkdirSync(path.join(configFixture, 'results/02'), { recursive: true });
  fs.mkdirSync(path.join(configFixture, 'vlm-flash'));
  fs.symlinkSync(sourceDirectory, path.join(configFixture, 'vlm-flash/src'), 'dir');
  const projectConfig = { extraPaths: ['./vlm-flash/src'], typeCheckingMode: 'off',
    reportMissingImports: 'warning', reportMissingModuleSource: 'warning',
    reportInvalidTypeForm: 'warning', reportUndefinedVariable: 'warning' };
  fs.writeFileSync(path.join(configFixture, 'pyrightconfig.json'), JSON.stringify(projectConfig));
  const fixtureNotebook = path.join(configFixture, 'results/02', path.basename(notebook));
  const fixtureRoot = languageRoot(fixtureNotebook, profile);
  assert.equal(fixtureRoot.reason, 'Project marker: pyrightconfig.json');
  results.push(await analyze('project-config', fixtureNotebook, fixtureRoot.path, {}, {}));
  assert.equal(hash(fs.readFileSync(notebook)), hash(source), 'Notebook must stay unchanged');
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({
    date: '2026-10-23', basedpyright: require('basedpyright/package.json').version,
    notebook, notebookSha256: hash(source), python, root, sourceDirectory,
    nativeNotebookSync: true, kernelStarted: false, guiStarted: false,
    projectConfig, results,
  }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(configFixture, { recursive: true, force: true });
});
