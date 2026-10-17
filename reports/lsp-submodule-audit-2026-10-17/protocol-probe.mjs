import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Focused boundary observations, separate from the real-server corpus run.
// Production classes are bundled unchanged. Only unused UI mounting is stubbed.
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const temporary = await mkdtemp('/tmp/setdown-lsp-protocol-');
const bundle = path.join(temporary, 'audit.cjs');
await build({ stdin: { contents: `
  export { ServerCapabilitiesState } from './apps/desktop/src/main/language/server-capabilities';
  export { ServerItems } from './apps/desktop/src/main/language/server-items';
  export { LanguageClient } from './apps/desktop/src/renderer/language/language-client';
  export { NotebookLanguage } from './apps/desktop/src/renderer/notebook/notebook-language';
  export { NotebookEntry } from './apps/desktop/src/renderer/notebook/notebook-store';
  export { emptyNotebook } from './apps/desktop/src/core/notebook/notebook-document';
  export { clientCapabilities } from './apps/desktop/src/protocol/language-features';
`, resolveDir: repo, loader: 'ts' }, outfile: bundle, bundle: true, format: 'cjs', platform: 'node', packages: 'external',
  banner: { js: `var require = require('node:module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))});` },
  plugins: [{ name: 'unused-results-ui', setup(builder) {
    builder.onResolve({ filter: /\/language-results$/ }, () => ({ path: 'results', namespace: 'unused' }));
    builder.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ contents: 'export function showLanguageResults() { throw Error("UI is outside this boundary probe"); }' }));
  } }],
});
const { ServerCapabilitiesState, ServerItems, LanguageClient, NotebookLanguage, NotebookEntry, emptyNotebook, clientCapabilities } = createRequire(import.meta.url)(bundle);
const findings = [];
const record = (id, expected, observed) => findings.push({ id, expected, observed });
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

// Two independently registered providers for the same document must coexist.
const capabilities = new ServerCapabilitiesState('/project');
capabilities.register([
  { id: 'types', method: 'textDocument/diagnostic', registerOptions: { documentSelector: [{ language: 'python' }], identifier: 'types', interFileDependencies: true, workspaceDiagnostics: false } },
  { id: 'lint', method: 'textDocument/diagnostic', registerOptions: { documentSelector: [{ language: 'python' }], identifier: 'lint', interFileDependencies: false, workspaceDiagnostics: false } },
]);
record('dynamic-diagnostic-providers', 'Both registration IDs remain dispatchable for the document', capabilities.forDocument('file:///project/main.py', 'python').diagnosticProvider);

const items = new ServerItems(), origin = { document: 'one', generation: 'epoch', version: 1 };
const list = items.remember('textDocument/completion', Array.from({ length: 4097 }, (_, i) => ({ label: `symbol${i}`, data: { i } })), origin);
let firstItem;
try { firstItem = items.resolve('completionItem/resolve', list[0], origin); }
catch (error) { firstItem = String(error); }
record('completion-handle-eviction', 'Every returned completion remains resolvable while its list is active', { returned: list.length, first: firstItem, last: items.resolve('completionItem/resolve', list.at(-1), origin) });

// The actual renderer request path must preserve cancellation semantics.
const providers = new Map(), listeners = new Set();
let requestCount = 0;
const api = {
  languages: new Proxy({}, { get: (_target, key) => (_selector, provider) => { providers.set(key, provider); return { dispose() {} }; } }),
  editor: { registerEditorOpener: () => ({ dispose() {} }), setModelMarkers() {} },
};
const model = { uri: { fsPath: '/project/main.py' }, getValue: () => 'x = 1', getVersionId: () => 1,
  getLanguageId: () => 'python', isDisposed: () => false,
  onDidChangeContent: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; } };
const cap = { textDocumentSync: 2, semanticTokensProvider: { legend: { tokenTypes: ['variable'], tokenModifiers: [] }, full: true } };
const port = { onEvent: () => () => {}, open: async () => ({ uri: 'file:///project/main.py', capabilities: cap }), close() {}, cancel() {},
  request: async () => { requestCount++; throw Object.assign(Error('Server cancelled tokens'), { code: -32802 }); } };
const client = new LanguageClient(api, { port, prepare: async () => { throw Error('not used'); }, open: async () => {}, status() {} });
client.bind({ id: 'one', document: { path: '/project/main.py', isUntitled: false } }, model);
await new Promise(resolve => setTimeout(resolve, 0));
const semanticResult = await providers.get('registerDocumentSemanticTokensProvider').provideDocumentSemanticTokens(model, null, token);
await new Promise(resolve => setTimeout(resolve, 300));
record('server-cancelled-semantic-tokens', 'Advertising serverCancelSupport requires retriggering ServerCancelled responses', {
  advertised: clientCapabilities().textDocument.semanticTokens.serverCancelSupport, requestCount, semanticResult,
});
client.dispose();

// Notebook completion uses the actual NotebookLanguage converter and fake port.
const notebookProviders = new Map(), sent = [];
const notebookApi = { languages: new Proxy({}, { get: (_target, key) => key === 'CompletionItemKind' ? { Text: 0 }
  : (_selector, provider) => { notebookProviders.set(key, provider); return { dispose() {} }; } }),
  editor: { registerEditorOpener: () => ({ dispose() {} }), setModelMarkers() {} } };
const entry = new NotebookEntry('audit', emptyNotebook(), emptyNotebook());
const cell = entry.document.add('code'); entry.document.setSource(cell, 'value');
const cellModel = { isDisposed: () => false, getValue: () => 'value', getWordUntilPosition: () => ({ startColumn: 1, endColumn: 6 }), dispose() {} };
entry.models.set(cell, cellModel);
const notebookPort = { close() {}, onEvent: () => () => {}, cancel() {},
  open: async () => ({ uri: 'file:///project/a.ipynb', cells: { [cell]: 'vscode-notebook-cell:/project/a.ipynb#cell' },
    capabilities: { completionProvider: { triggerCharacters: ['.', '[', '"', "'"], resolveProvider: true } } }),
  request: async (_id, _version, _requestId, method, params) => { sent.push({ method, params }); return []; },
};
const notebook = new NotebookLanguage(notebookApi, notebookPort, entry, '/project/a.ipynb', () => {}, async () => {}, async () => {});
await new Promise(resolve => setTimeout(resolve, 0));
const completion = notebookProviders.get('registerCompletionItemProvider');
for (const triggerKind of [0, 1, 2]) await completion.provideCompletionItems(cellModel, { lineNumber: 1, column: 6 }, { triggerKind }, token);
record('notebook-completion-contract', 'Monaco 0/1/2 -> LSP 1/2/3, negotiated triggers and resolve support', {
  sentTriggerKinds: sent.map(s => s.params.context.triggerKind), triggers: completion.triggerCharacters,
  resolveInstalled: typeof completion.resolveCompletionItem === 'function', advertisedResolve: clientCapabilities().textDocument.completion.completionItem.resolveSupport,
});
notebook.dispose(); entry.dispose();

await writeFile(path.join(here, 'protocol-evidence.json'), JSON.stringify({ revision: 'a00d7aef1c6c5868777fc5b04fb97ef225ce69a4', findings }, null, 2) + '\n');
console.log(JSON.stringify(findings, null, 2));
await rm(temporary, { recursive: true, force: true });
