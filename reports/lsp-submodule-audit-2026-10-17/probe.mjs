import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Audit harness only. Runs the built Setdown app, its real renderer and IPC,
// LanguageManager, ServerSession and external servers. Never saves a vendor file.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..'), appDir = path.join(repo, 'apps/desktop');
const require = createRequire(path.join(appDir, 'package.json'));
const electronPath = require('electron');
const toolsDir = process.env.SETDOWN_AUDIT_TOOLS ?? '/tmp/setdown-lsp-audit-tools-20261017';
const cases = [
  { name: 'python-standalone', file: 'vendor/nbformat/nbformat/notebooknode.py', needle: 'value = from_dict(value)', symbol: 'from_dict', rename: true, ui: true },
  { name: 'python-completion-ui', file: 'vendor/nbformat/nbformat/notebooknode.py', needle: 'value = from_dict(value)', symbol: 'from_dict', ui: true, uiPrefix: 'from_di' },
  { name: 'python-project', file: 'vendor/nbformat/nbformat/notebooknode.py', root: 'vendor/nbformat', needle: 'value = from_dict(value)', symbol: 'from_dict', rename: true },
  { name: 'python-superproject', file: 'vendor/nbformat/nbformat/notebooknode.py', root: '.', needle: 'value = from_dict(value)', symbol: 'from_dict', rename: true },
  { name: 'python-standalone-rename-ui', file: 'vendor/nbformat/nbformat/notebooknode.py', needle: 'value = from_dict(value)', symbol: 'from_dict', uiRename: true },
  { name: 'python-project-rename-ui', file: 'vendor/nbformat/nbformat/notebooknode.py', root: 'vendor/nbformat', needle: 'value = from_dict(value)', symbol: 'from_dict', uiRename: true },
  { name: 'python-superproject-rename-ui', file: 'vendor/nbformat/nbformat/notebooknode.py', root: '.', needle: 'value = from_dict(value)', symbol: 'from_dict', uiRename: true },
  { name: 'python-sublime', file: 'vendor/sublime-lsp/plugin/core/url.py', root: 'vendor/sublime-lsp', needle: 'return unparse_uri(parse_uri(uri))', symbol: 'parse_uri' },
  { name: 'python-jupyterlab', file: 'vendor/jupyterlab/jupyterlab/commands.py', root: 'vendor/jupyterlab', needle: 'class ProgressProcess', symbol: 'ProgressProcess' },
  { name: 'cpp-dolphin', file: 'vendor/dolphin/src/global.cpp', root: 'vendor/dolphin', needle: 'QUrl Dolphin::homeUrl()', symbol: 'homeUrl' },
  { name: 'c-ptyxis', file: 'vendor/ptyxis/src/ptyxis-util.c', root: 'vendor/ptyxis', needle: 'ptyxis_shell_supports_dash_l (const', symbol: 'ptyxis_shell_supports_dash_l' },
  { name: 'ts-missing-server', file: 'vendor/gitgraph.js/packages/gitgraph-core/src/branches-order.ts', needle: 'class BranchesOrder', symbol: 'BranchesOrder' },
  { name: 'ts-gitgraph', file: 'vendor/gitgraph.js/packages/gitgraph-core/src/branches-order.ts', needle: 'class BranchesOrder', symbol: 'BranchesOrder', tools: true, rename: true, ui: true },
  { name: 'ts-gitgraph-completion-ui', file: 'vendor/gitgraph.js/packages/gitgraph-core/src/branches-order.ts', needle: 'return this.colors[this.get(branchName)', symbol: 'get', tools: true, ui: true },
  { name: 'ts-gitgraph-configured', file: 'vendor/gitgraph.js/packages/gitgraph-core/src/branches-order.ts', needle: 'class BranchesOrder', symbol: 'BranchesOrder', tools: true, configureHints: true },
  { name: 'ts-crossnote', file: 'vendor/crossnote/src/utility.ts', root: 'vendor/crossnote', needle: 'export ', symbol: '', tools: true },
  { name: 'ts-languageclient', file: 'vendor/monaco-languageclient/packages/vscode-ws-jsonrpc/src/socket/writer.ts', root: 'vendor/monaco-languageclient', needle: 'export class WebSocketMessageWriter', symbol: 'WebSocketMessageWriter', tools: true },
  { name: 'js-readability', file: 'vendor/readability/Readability-readerable.js', root: 'vendor/readability', needle: 'visibilityChecker: isNodeVisible', symbol: 'isNodeVisible', tools: true, rename: true },
  { name: 'json-nbformat', file: 'vendor/nbformat/nbformat/v4/nbformat.v4.schema.json', root: 'vendor/nbformat', needle: '"definitions"', symbol: 'definitions', tools: true },
  { name: 'html-readability', file: 'vendor/readability/test/test-pages/001/source.html', root: 'vendor/readability', needle: '<html', symbol: 'html', tools: true },
  { name: 'css-min', file: 'vendor/min/css/windowControls.css', root: 'vendor/min', needle: 'display: none', symbol: 'display', tools: true },
  { name: 'css-min-configured', file: 'vendor/min/css/windowControls.css', root: 'vendor/min', needle: 'display: none', symbol: 'display', tools: true, configureCss: true },
  { name: 'css-min-invalid', file: 'vendor/min/css/windowControls.css', root: 'vendor/min', needle: 'display: none', symbol: 'display', tools: true, injectCss: true },
  { name: 'css-min-configured-invalid', file: 'vendor/min/css/windowControls.css', root: 'vendor/min', needle: 'display: none', symbol: 'display', tools: true, configureCss: true, injectCss: true },
  { name: 'rust-brave', file: 'vendor/brave-core/tools/crates/vendor/itoa/src/lib.rs', needle: 'pub struct Buffer', symbol: 'Buffer' },
  { name: 'notebook-nbformat', file: 'vendor/nbformat/tests/test4.5.ipynb', root: 'vendor/nbformat', notebook: true },
];
const selected = process.argv.slice(2);
const output = { revision: 'a00d7aef1c6c5868777fc5b04fb97ef225ce69a4', node: process.version, started: new Date().toISOString(), cases: [] };
const pos = (text, needle, symbol) => {
  const base = text.indexOf(needle);
  if (base < 0) throw Error(`Missing probe anchor: ${needle}`);
  const offset = symbol ? text.indexOf(symbol, base) : base;
  const before = text.slice(0, offset), lines = before.split('\n');
  return { line: lines.length - 1, character: lines.at(-1).length + (symbol ? 1 : 0) };
};
for (const entry of cases.filter(c => !selected.length || selected.includes(c.name))) {
  const result = { ...entry, requests: {}, console: [], events: [] };
  output.cases.push(result);
  const config = await mkdtemp('/tmp/setdown-lsp-audit-profile-');
  const initial = path.join(config, 'start.txt');
  await writeFile(initial, 'Setdown LSP submodule audit\n');
  const file = path.join(repo, entry.file), source = await readFile(file, 'utf8');
  result.sourceSha256 = createHash('sha256').update(source).digest('hex');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  let application;
  try {
    application = await _electron.launch({ executablePath: electronPath, cwd: appDir, args: ['.', initial], chromiumSandbox: true,
      env: { ...env, XDG_CONFIG_HOME: config, SETDOWN_LSP_INHERIT_ENV: '1',
        PATH: entry.tools ? `${toolsDir}/node_modules/.bin:${env.PATH}` : env.PATH } });
    const page = await application.firstWindow();
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) result.console.push(message.text()); });
    await expect(page.locator('.editor-host')).toBeVisible({ timeout: 20000 });
    await application.evaluate(({ ipcMain, app, BrowserWindow }) => {
      globalThis.audit = { opens: [], changes: [], requests: [] };
      for (const channel of ['language:open', 'language:change', 'language:request']) {
        const original = ipcMain._invokeHandlers.get(channel);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (event, ...args) => {
          const began = Date.now();
          try {
            const response = await original(event, ...args);
            if (channel === 'language:open') {
              const { text, ...document } = args[0];
              globalThis.audit.opens.push({ document, response, ms: Date.now() - began });
            } else if (channel === 'language:change') globalThis.audit.changes.push({ id: args[0], version: args[1] });
            else globalThis.audit.requests.push({ method: args[3], ms: Date.now() - began });
            return response;
          } catch (error) {
            if (channel === 'language:open') globalThis.audit.opens.push({ document: { path: args[0].path }, error: String(error), ms: Date.now() - began });
            throw error;
          }
        });
      }
      const window = BrowserWindow.getAllWindows()[0];
      app.focus({ steal: true }); window.show(); window.focus(); window.webContents.focus();
    });
    await page.evaluate(() => { globalThis.auditEvents = []; window.marktex.language.onEvent(event => globalThis.auditEvents.push(event)); });
    if (entry.configureHints) await page.evaluate(async () => {
      const catalog = await window.marktex.language.catalog();
      const profile = catalog.entries.find(e => e.id === 'typescript-language-server');
      await window.marktex.language.configure(profile.id, { ...profile.options, settings: {
        typescript: { inlayHints: { includeInlayParameterNameHints: 'all', includeInlayFunctionParameterTypeHints: true,
          includeInlayVariableTypeHints: true, includeInlayFunctionLikeReturnTypeHints: true } },
      } });
    });
    if (entry.configureCss) await page.evaluate(async () => {
      const catalog = await window.marktex.language.catalog();
      const profile = catalog.entries.find(e => e.id === 'css-lsp');
      await window.marktex.language.configure(profile.id, { ...profile.options, settings: {
        css: { validate: true, lint: {}, completion: {}, hover: {} },
        scss: { validate: true, lint: {}, completion: {}, hover: {} },
        less: { validate: true, lint: {}, completion: {}, hover: {} },
      } });
    });
    if (entry.root) await page.evaluate(root => window.marktex.restoreProjectFolder(root), path.resolve(repo, entry.root));
    const began = performance.now();
    const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), file);
    await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
    await expect.poll(() => application.evaluate(() => globalThis.audit.opens.length), { timeout: 30000 }).toBeGreaterThan(0);
    const opened = await application.evaluate(() => globalThis.audit.opens.at(-1));
    Object.assign(result, { connection: opened, openToConnectionMs: Math.round(performance.now() - began) });
    if (opened.error || opened.response?.unavailable) {
      const catalog = await page.evaluate(() => window.marktex.language.catalog());
      result.sessions = catalog.entries.filter(e => e.sessions.length && e.id !== 'notebook-python');
      continue;
    }
    const { id } = opened.document;
    let version = opened.document.version;
    if (entry.injectCss) {
      const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
      await editor.press('Control+End');
      result.unsavedInjection = '\n.audit { zzz-invalid-property: 1; color: ; }\n';
      await page.keyboard.insertText(result.unsavedInjection);
      await expect(page.locator('.editor-surface .view-lines')).toContainText('zzz-invalid-property');
      await expect.poll(() => application.evaluate(() => globalThis.audit.changes.length), { timeout: 5000 }).toBeGreaterThan(0);
      version = await application.evaluate(() => globalThis.audit.changes.at(-1).version);
    }
    const cell = entry.notebook ? opened.document.cells.find(c => c.text.includes('print("hello")')) : undefined;
    const position = entry.notebook ? pos(cell.text, 'print("hello")', 'print') : pos(source, entry.needle, entry.symbol);
    result.position = position;
    const request = async (label, method, params) => {
      const started = performance.now();
      try {
        if (entry.injectCss) version = await application.evaluate((_electron, id) => globalThis.audit.changes.filter(c => c.id === id).at(-1)?.version ?? 1, id);
        const response = await page.evaluate(async ({ id, version, method, params }) => {
          return window.marktex.language.request(id, version, crypto.randomUUID(), method, params);
        }, { id, version, method, params: cell ? { ...params, cell: cell.id } : params });
        result.requests[label] = { method, ms: Math.round(performance.now() - started), response };
        return response;
      } catch (error) { result.requests[label] = { method, ms: Math.round(performance.now() - started), error: String(error) }; }
    };
    const cap = opened.response.capabilities;
    if (cap.documentSymbolProvider) await request('symbols', 'textDocument/documentSymbol', {});
    if (cap.hoverProvider) await request('hover', 'textDocument/hover', { position });
    if (cap.definitionProvider) await request('definition', 'textDocument/definition', { position });
    if (cap.referencesProvider) await request('references', 'textDocument/references', { position, context: { includeDeclaration: true } });
    if (cap.completionProvider) {
      const completions = await request('completion', 'textDocument/completion', { position, context: { triggerKind: 1 } });
      const items = Array.isArray(completions) ? completions : completions?.items;
      result.completionCount = items?.length ?? 0;
      if (items?.length && cap.completionProvider.resolveProvider) {
        const item = items.find(item => item.label === entry.symbol) ?? items[0];
        await request('completionResolve', 'completionItem/resolve', item);
      }
      if (result.requests.completion?.response) result.requests.completion.response = { isIncomplete: completions?.isIncomplete, count: items?.length, sample: items?.slice(0, 8) };
    }
    if (cap.semanticTokensProvider?.full) {
      const tokens = await request('semanticTokens', 'textDocument/semanticTokens/full', {});
      if (tokens) result.requests.semanticTokens.response = { resultId: tokens.resultId, integers: tokens.data?.length, sample: tokens.data?.slice(0, 20) };
    }
    if (cap.inlayHintProvider) await request('inlayHints', 'textDocument/inlayHint', { range: { start: { line: 0, character: 0 }, end: { line: source.split('\n').length - 1, character: 0 } } });
    if (cap.foldingRangeProvider) await request('folding', 'textDocument/foldingRange', {});
    if (cap.documentFormattingProvider) {
      const edits = await request('formatting', 'textDocument/formatting', { options: { tabSize: 2, insertSpaces: true } });
      if (edits) result.requests.formatting.response = { editCount: edits.length, first: edits.slice(0, 2) };
    }
    if (entry.rename && cap.renameProvider) await request('rename', 'textDocument/rename', { position, newName: `${entry.symbol}_audit` });
    if (cap.workspaceSymbolProvider && !entry.notebook) await request('workspaceSymbols', 'workspace/symbol', { query: entry.symbol || 'resolve' });
    if (cap.callHierarchyProvider && !entry.notebook) {
      const items = await request('callHierarchy', 'textDocument/prepareCallHierarchy', { position });
      if (items?.length) await request('incomingCalls', 'callHierarchy/incomingCalls', { item: items[0] });
    }
    if (cap.diagnosticProvider) await request('pullDiagnostics', 'textDocument/diagnostic', { identifier: cap.diagnosticProvider.identifier });
    if (entry.ui) {
      const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
      if (entry.uiPrefix) {
        await editor.press('Control+End'); await editor.press('Enter');
        await editor.pressSequentially(entry.uiPrefix);
      } else {
        await editor.press('Control+g');
        const goto = page.locator('.quick-input-box input');
        await goto.fill(`:${position.line + 1}:${position.character + 1}`);
        await goto.press('Enter');
      }
      await editor.press('Control+Space');
      await expect(page.locator('.suggest-widget.visible')).toBeVisible({ timeout: 10000 });
      result.uiCompletion = (await page.locator('.suggest-widget.visible').innerText()).slice(0, 3000);
      if (entry.name.endsWith('completion-ui')) await expect(page.locator('.suggest-widget.visible')).toContainText(entry.symbol);
      await page.screenshot({ path: path.join(here, `${entry.name}.png`) });
      await editor.press('Escape');
    }
    if (entry.uiRename) {
      const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
      await editor.press('Control+g');
      const goto = page.locator('.quick-input-box input');
      await goto.fill(`:${position.line + 1}:${position.character + 1}`); await goto.press('Enter');
      await editor.press('F2');
      const rename = page.locator('.rename-input');
      await expect(rename).toBeVisible(); await rename.fill(`${entry.symbol}_audit`); await rename.press('Enter');
      await expect(rename).toBeHidden({ timeout: 20000 });
      await expect(page.locator('.editor-surface .view-lines')).toContainText(`${entry.symbol}_audit`);
      result.renameTabs = await page.getByRole('tab').allTextContents();
      result.renameOpenedPaths = await application.evaluate(() => globalThis.audit.opens.map(o => o.document.path));
      await page.screenshot({ path: path.join(here, `${entry.name}.png`) });
    }
    const catalog = await page.evaluate(() => window.marktex.language.catalog());
    result.sessions = catalog.entries.filter(e => e.sessions.length && (entry.notebook || e.id !== 'notebook-python'));
    result.events = await page.evaluate(() => globalThis.auditEvents);
    result.ipc = await application.evaluate(() => globalThis.audit);
  } catch (error) {
    result.error = String(error);
    if (application) {
      result.ipc = await application.evaluate(() => globalThis.audit).catch(() => null);
      const page = await application.firstWindow().catch(() => null);
      if (page) {
        result.events = await page.evaluate(() => globalThis.auditEvents).catch(() => []);
        await page.screenshot({ path: path.join(here, `${entry.name}-failure.png`) }).catch(() => {});
      }
    }
  }
  finally {
    if (application) {
      await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
      await application.close().catch(() => {});
    }
    result.sourceUnchanged = source === await readFile(file, 'utf8');
    await rm(config, { recursive: true, force: true });
    await writeFile(path.join(here, selected.length ? `evidence-${selected.join('_')}.json` : 'evidence.json'), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ name: entry.name, state: result.error ?? result.connection?.error ?? result.connection?.response?.unavailable ?? 'connected', requests: Object.keys(result.requests).length, errors: Object.entries(result.requests).filter(([,r]) => r.error).map(([name,r]) => [name,r.error]), unchanged: result.sourceUnchanged }));
  }
}
