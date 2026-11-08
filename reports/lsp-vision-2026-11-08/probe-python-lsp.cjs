// Reproducible research probe. Runs installed servers over stdio; no GUI or user settings.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

const source = [
  'from typing import Any, Literal',
  'def choose(mode: Literal["fast", "safe"]) -> str:',
  '    return mode',
  'valid = choose("fast")',
  'invalid = choose("turbo")',
  'count: int = "wrong"',
  'opaque: Any = choose',
  'unchecked = opaque("turbo")',
  'import setdown_probe_missing_package',
  'print(setdown_probe_missing_name)',
  '',
].join('\n');
const base = { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' };
const core = { reportMissingImports: 'warning', reportMissingModuleSource: 'warning', reportInvalidTypeForm: 'warning', reportUndefinedVariable: 'warning' };
const variants = [
  ...['off', 'basic', 'standard', 'strict'].map(mode => ({ server: 'pyright', mode })),
  { server: 'pyright', mode: 'off', projectMode: 'basic' },
  { server: 'pyright', mode: 'off', vscodeMode: 'basic' },
  ...['off', 'basic', 'standard'].map(mode => ({ server: 'basedpyright', mode, notebook: true })),
];
function bounded(promise, ms, description) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(description)), ms); })])
    .finally(() => clearTimeout(timer));
}
async function run(variant) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-lsp-vision-'));
  const analysis = { ...base, typeCheckingMode: variant.mode,
    ...(variant.server === 'basedpyright' && variant.mode === 'off' ? { diagnosticSeverityOverrides: core } : {}) };
  const config = { python: { analysis }, ...(variant.server === 'basedpyright' ? { basedpyright: { analysis } } : {}) };
  if (variant.projectMode) await fs.writeFile(path.join(root, 'pyrightconfig.json'), JSON.stringify({ typeCheckingMode: variant.projectMode }));
  if (variant.vscodeMode) {
    await fs.mkdir(path.join(root, '.vscode'));
    await fs.writeFile(path.join(root, '.vscode/settings.json'), JSON.stringify({ 'python.analysis.typeCheckingMode': variant.vscodeMode }));
  }
  const file = path.join(root, variant.notebook ? 'sample.ipynb' : 'sample.py');
  const fileUri = pathToFileURL(file).href;
  const uri = variant.notebook ? fileUri.replace(/^file:/, 'vscode-notebook-cell:') + '#cell1' : fileUri;
  if (!variant.notebook) await fs.writeFile(file, source);
  const child = spawn(process.execPath, [require.resolve(`${variant.server}/langserver.index.js`), '--stdio'], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, stdio: 'pipe',
  });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const messages = [], requests = [], publications = [], waits = [];
  let stderr = '', wire = '';
  child.stdout.on('data', data => { wire = (wire + data).slice(-16384); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); });
  connection.onNotification('window/logMessage', value => messages.push(value));
  connection.onNotification('window/showMessage', value => messages.push(value));
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onNotification('$/progress', () => {});
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: 'probe' }]);
  connection.onRequest('workspace/configuration', params => params.items.map(item => {
    requests.push(item);
    return item.section ? item.section.split('.').reduce((value, part) => value?.[part], config) ?? null : config;
  }));
  connection.onNotification('textDocument/publishDiagnostics', params => {
    publications.push(params);
    for (const waiter of waits) if (params.uri === uri && params.version === waiter.version) waiter.resolve(params);
  });
  const diagnosticsAt = version => {
    const existing = publications.findLast(item => item.uri === uri && item.version === version);
    return existing ? Promise.resolve(existing) : bounded(new Promise(resolve => waits.push({ version, resolve })), 20000, `No diagnostics for ${variant.server}/${variant.mode}/v${version}`);
  };
  connection.listen();
  try {
    const initialized = await bounded(connection.sendRequest('initialize', {
      processId: process.pid, rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'probe' }],
      initializationOptions: { disablePullDiagnostics: true },
      capabilities: {
        general: { positionEncodings: ['utf-16'] }, workspace: { configuration: true, workspaceFolders: true },
        notebookDocument: { synchronization: { dynamicRegistration: false, executionSummarySupport: true } },
        textDocument: { publishDiagnostics: { versionSupport: true, relatedInformation: true } },
      },
    }), 20000, 'Initialization timeout');
    await connection.sendNotification('initialized', {});
    await connection.sendNotification('workspace/didChangeConfiguration', { settings: config });
    if (variant.notebook) {
      if (!initialized.capabilities.notebookDocumentSync) throw Error('Notebook sync unavailable');
      await connection.sendNotification('notebookDocument/didOpen', {
        notebookDocument: { uri: fileUri, notebookType: 'jupyter-notebook', version: 1, cells: [{ kind: 2, document: uri }] },
        cellTextDocuments: [{ uri, languageId: 'python', version: 1, text: source }],
      });
    } else await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: source } });
    const initial = await diagnosticsAt(1);
    const hover = await bounded(connection.sendRequest('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 5 } }), 15000, 'Hover timeout');
    const fixed = source.replace('choose("turbo")', 'choose("safe")').replace('count: int = "wrong"', 'count: int = 3')
      .replace('import setdown_probe_missing_package\n', '').replace('print(setdown_probe_missing_name)\n', '');
    if (variant.notebook) await connection.sendNotification('notebookDocument/didChange', {
      notebookDocument: { uri: fileUri, version: 2 }, change: { cells: { textContent: [{ document: { uri, version: 2 }, changes: [{ text: fixed }] }] } },
    });
    else await connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] });
    const afterFix = await diagnosticsAt(2);
    const compact = publication => publication.diagnostics.map(d => ({ code: d.code ?? null, severity: d.severity, line: d.range.start.line + 1, range: d.range, message: d.message }));
    return { ...variant, version: require(`${variant.server}/package.json`).version, configuration: config, initialize: initialized,
      initial: compact(initial), afterFix: compact(afterFix), hover, configurationRequests: requests, messages, stderr };
  } catch (error) {
    console.error(JSON.stringify({ variant, message: String(error), messages, stderr, wire, exitCode: child.exitCode, signal: child.signalCode }));
    throw error;
  } finally {
    try { await bounded(connection.sendRequest('shutdown', null), 1500, 'Shutdown timeout'); await connection.sendNotification('exit'); } catch {}
    connection.dispose(); child.kill();
    await fs.rm(root, { recursive: true, force: true });
  }
}
(async () => {
  const results = [];
  for (const variant of variants) {
    const result = await run(variant); results.push(result);
    console.log(JSON.stringify({ ...variant, initial: result.initial.map(d => ({ code: d.code, severity: d.severity, line: d.line })), afterFix: result.afterFix.map(d => d.code) }));
  }
  await fs.writeFile(path.join(__dirname, 'python-lsp-results.json'), JSON.stringify({ completedAt: new Date().toISOString(), node: process.version, source,
    scope: 'Real installed language servers over stdio, including native notebookDocument synchronization. Not an Electron marker/UI test.', results }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
