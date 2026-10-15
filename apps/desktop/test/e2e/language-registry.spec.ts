import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from './electron-app';
const require = createRequire(import.meta.url);
const catalogSize = new Set([
  ...require('../../src/main/language/catalog/mason.json').packages,
  ...require('../../src/main/language/catalog/profiles.json').profiles,
].map((entry: { id: string }) => entry.id)).size;

test('the language sidebar searches all discoverable servers, shows language logos and keeps manual connections repairable', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-sidebar-'));
  const file = path.join(root, 'notes.txt'), executable = path.join(root, 'manual-server');
  await writeFile(file, 'Keep editing while managing language support.\n');
  await writeFile(executable, '#!/bin/sh\nexit 0\n'); await chmod(executable, 0o755);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, HOME: root,
    XDG_CONFIG_HOME: path.join(root, 'config'), PATH: '', CONDA_PREFIX: '', VIRTUAL_ENV: '',
    CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'), GOBIN: '',
    PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Language Support', exact: true });
    const detected = panel.locator('[data-group="detected"]');
    const available = panel.locator('[data-group="available"]');
    await expect(detected.locator('.server')).toHaveCount(1);
    await expect(detected.locator('.server')).toContainText('Pyright');
    await expect(detected.getByRole('img', { name: 'Python logo' })).toBeVisible();
    await expect(available.locator('summary')).toContainText('Available servers');
    expect(await available.locator('.server').count()).toBeGreaterThan(300);
    await expect(available).not.toHaveAttribute('open');
    await panel.getByRole('searchbox').fill('svelte');
    await expect(available.locator('.server')).toHaveCount(1);
    await expect(available.locator('.server')).toBeVisible();
    await expect(available.locator('.server')).toContainText('Not detected');
    await expect(available.getByRole('img', { name: 'Svelte logo' })).toBeVisible();
    await available.locator('.server').click();
    await expect(panel.locator('.state')).toHaveText('Not detected');
    await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Back to language servers' }).click();
    await panel.getByRole('searchbox').fill('apex-language-server');
    await expect(panel.locator('.server')).toHaveCount(0); // No discovery metadata: manual-only.
    await expect(panel).toContainText('No matching servers.');
    await panel.getByRole('button', { name: 'Add language server', exact: true }).click();
    await expect(panel.getByLabel('Existing server profile').locator('option[value="apex-language-server"]')).toHaveCount(1);
    await panel.getByLabel('Connection ID', { exact: true }).fill('manual-fixture');
    await panel.getByLabel('Name', { exact: true }).fill('Manual Fixture');
    await panel.getByLabel('LSP language ID').fill('manualfixture');
    await panel.getByLabel('File extensions').fill('.manualfixture');
    await application.evaluate(({ dialog }, executable) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [executable] })) as typeof dialog.showOpenDialog;
    }, executable);
    await panel.getByRole('button', { name: 'Choose executable and connect…' }).click();
    await expect(panel.locator('.state')).toHaveText('Ready');
    await panel.getByRole('button', { name: 'Back to language servers' }).click();
    await panel.getByRole('searchbox').fill('');
    await expect(panel.locator('.server-group').filter({ hasText: 'Manual connections' })).toContainText('Manual Fixture');
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('No modal focus trap.');
    await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('No modal focus trap.');
    await rm(executable);
    await panel.getByRole('button', { name: 'Rescan installed servers' }).click();
    const missing = panel.locator('.server-group').filter({ hasText: 'Needs attention' });
    await expect(missing).toContainText('Manual Fixture'); await expect(missing).toContainText('Not detected');
    await page.screenshot({ path: testInfo.outputPath('language-sidebar.png') });
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await page.screenshot({ path: testInfo.outputPath('language-sidebar-dark.png') });
    await missing.getByRole('button').click();
    await panel.screenshot({ path: testInfo.outputPath('language-server-details.png') });
    await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Remove connection' }).click();
    await expect(panel.locator('[data-server-id="manual-fixture"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Language Support', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Language Support', exact: true }).click();
    await expect(panel.getByRole('searchbox')).toBeFocused();
    await panel.getByRole('searchbox').fill('query');
    await panel.getByRole('searchbox').press('Escape');
    await expect(panel.getByRole('searchbox')).toHaveValue('');
    await panel.getByRole('searchbox').press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Language Support', exact: true })).toBeFocused();
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('installing a server while editing and rescanning connects the current model without replacing healthy sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auto-language-'));
  const file = path.join(root, 'hello.f90'), log = path.join(root, 'server.jsonl');
  const executable = path.join(root, '.local/bin/fortls');
  await writeFile(file, 'program example\nend program example\n');
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env,
    HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), PATH: '/usr/bin:/bin',
    CONDA_PREFIX: '', VIRTUAL_ENV: '', CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'),
    GOBIN: '', PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'unavailable');
    await expect(page.locator('.editor-host [role="status"]')).toHaveCount(0);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('! edited before connection');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, `#!${process.execPath}\n
      const fs = require('node:fs');
      const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
      const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method, params, pid:process.pid})+'\\n');
      const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
      c.onRequest('initialize', params => {log('initialize',params); return {capabilities:{textDocumentSync:{openClose:true,change:1},hoverProvider:true}}});
      c.onNotification('textDocument/didOpen', params => log('open',params));
      c.onNotification('textDocument/didChange', params => log('change',params));
      c.onRequest('textDocument/hover', () => ({contents:{kind:'plaintext',value:'automatic Fortran server'}}));
      c.onRequest('shutdown', () => {log('shutdown',null); return null});
      c.onNotification('exit', () => process.exit(0)); c.listen();
    `); await chmod(executable, 0o755);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await management.getByRole('searchbox').fill('fortls');
    await expect(management.locator('[data-group="available"] .server')).toContainText('Not detected');
    await expect(management.getByRole('img', { name: 'Fortran logo' })).toBeVisible();
    await management.getByRole('button', { name: 'Rescan installed servers' }).click();
    await management.locator('.server-list button').click();
    await expect(management.locator('.state')).toHaveText('Running');
    await expect(management.locator('.details code').first()).toHaveText(executable);
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
    expect((await messages()).find(m => m.method === 'open').params.textDocument.text).toContain('! edited before connection');
    const originalPid = (await messages())[0].pid;
    await management.getByRole('button', { name: 'Rescan installed servers' }).click();
    await expect(management.getByRole('button', { name: 'Rescan installed servers' })).toBeEnabled();
    await management.getByRole('button', { name: 'Back to language servers' }).click();
    await management.getByRole('searchbox').fill('pyright'); await management.locator('[data-server-id="pyright"]').click();
    await management.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(management.locator('.state')).toHaveText('Disabled');
    await management.getByRole('button', { name: 'Close language support' }).click();
    await editor.press('Control+End'); await editor.pressSequentially('! still connected');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'change').length).toBeGreaterThan(0);
    expect(new Set((await messages()).map(m => m.pid))).toEqual(new Set([originalPid]));
    expect((await messages()).filter(m => m.method === 'initialize')).toHaveLength(1);
    expect((await messages()).filter(m => m.method === 'shutdown')).toHaveLength(0);
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toContain('! edited before connection');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('Edit menu imports a new server, negotiates Full sync, and reconnects the same unsaved model with Undo intact', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-custom-language-'));
  const file = path.join(root, 'main.custom'), log = path.join(root, 'messages.jsonl');
  const server = path.join(root, 'server.cjs'), definition = path.join(root, 'connection.json');
  await writeFile(file, 'bad\n'); await writeFile(path.join(root, 'custom.project'), '');
  await writeFile(server, `
    const fs = require('node:fs');
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method, params})+'\\n');
    let document;
    const diagnose = () => {
      const diagnostic = {range:{start:{line:0,character:0},end:{line:0,character:3}},severity:1,message:'Current error'};
      c.sendNotification('textDocument/publishDiagnostics', {uri:document.uri, diagnostics:[{...diagnostic,message:'Unversioned'}]});
      c.sendNotification('textDocument/publishDiagnostics', {uri:document.uri, version:document.version-1, diagnostics:[{...diagnostic,message:'Stale'}]});
      c.sendNotification('textDocument/publishDiagnostics', {uri:document.uri, version:document.version, diagnostics:document.text.startsWith('bad')?[diagnostic]:[]});
    };
    c.onRequest('initialize', p => { log('initialize', p); return {capabilities:{positionEncoding:'utf-16', textDocumentSync:{openClose:true,change:1,save:{includeText:true}},hoverProvider:true}}; });
    c.onNotification('initialized', async () => log('configuration', await c.sendRequest('workspace/configuration', {items:[{section:'custom.nested'}]})));
    c.onNotification('textDocument/didOpen', p => {log('open',p); document=p.textDocument; diagnose();});
    c.onNotification('textDocument/didChange', p => { log('change',p); document={...document,version:p.textDocument.version,text:p.contentChanges[0].text}; diagnose(); });
    c.onNotification('textDocument/didSave', p => log('save',p));
    c.onRequest('textDocument/hover', () => ({contents:{kind:'plaintext',value:document.text}}));
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  await writeFile(definition, JSON.stringify({ id: 'fixture-custom', name: 'Fixture Custom',
    launch: { kind: 'native', command: process.execPath, args: [server] },
    languages: [{ languageId: 'custom', monacoId: 'plaintext', extensions: ['.custom'] }],
    rootMarkers: ['custom.project'], settings: { custom: { nested: { enabled: true } } }, initializationOptions: { test: 'initialized' } }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('// unsaved');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await expect(management).toBeVisible();
    await expect(management.locator('[data-server-id="pyright"]')).toContainText('Included');
    expect(await management.locator('.server').count()).toBeLessThan(catalogSize);
    await expect(page.getByRole('dialog', { name: 'Language Support' })).toHaveCount(0);
    await expect(management.getByRole('searchbox')).toBeFocused();
    await expect(page.locator('.activity-bar button').nth(4)).toHaveAttribute('aria-label', 'Language Support');
    await management.screenshot({ path: testInfo.outputPath('language-support.png') });
    expect(await messages()).toHaveLength(0); // Viewing the catalog starts no process.
    await application.evaluate(({ dialog }, definition) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [definition] })) as typeof dialog.showOpenDialog;
    }, definition);
    await management.getByRole('button', { name: 'Import JSON…', exact: true }).click();
    await management.getByRole('searchbox').fill('fixture-custom');
    await management.locator('.server-list button').click();
    await expect(management.locator('.state')).toHaveText('Disabled');
    await management.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
    const initial = await messages();
    expect(initial.find(m => m.method === 'open').params.textDocument.text).toBe('bad\n// unsaved');
    expect(initial.find(m => m.method === 'initialize').params.initializationOptions).toEqual({ test: 'initialized' });
    await expect.poll(async () => (await messages()).find(m => m.method === 'configuration')?.params).toEqual([{ enabled: true }]);
    await management.getByRole('button', { name: 'Close language support' }).click();
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await editor.press('Control+Home'); await editor.press('Shift+End'); await editor.pressSequentially('fixed');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await editor.press('Control+s');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'save').at(-1)?.params.text).toBe('fixed\n// unsaved');
    for (const message of (await messages()).filter(m => m.method === 'change')) {
      expect(message.params.contentChanges).toHaveLength(1); expect(message.params.contentChanges[0]).not.toHaveProperty('range');
    }
    // Reconfigure through the real management screen, then Undo the preceding edit.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    await management.getByRole('searchbox').fill('fixture-custom'); await management.locator('.server-list button').click();
    await management.getByText('Connection settings', { exact: true }).click();
    await management.getByLabel('Server options (JSON)').fill(JSON.stringify({ args: [server], settings: { custom: { nested: { enabled: false } } }, initializationOptions: { test: 'reconfigured' } }));
    await management.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(2);
    expect((await messages()).filter(m => m.method === 'open').at(-1).params.textDocument.text).toBe('fixed\n// unsaved');
    await management.getByRole('button', { name: 'Close language support' }).click();
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toBe('bad\n// unsaved');
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('an imported npm profile starts automatically and supplies completion without a connection form', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-profile-npm-'));
  const file = path.join(root, 'main.ts'), log = path.join(root, 'messages.jsonl');
  const prefix = path.join(root, 'npm-global'), folder = path.join(prefix, 'lib/node_modules/typescript-language-server');
  await mkdir(folder, { recursive: true }); await mkdir(path.join(root, 'bin'));
  await symlink(process.execPath, path.join(root, 'bin/node'));
  await writeFile(file, 'const answer = 1;\n');
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'typescript-language-server', bin: { 'typescript-language-server': './cli.cjs' } }));
  await writeFile(path.join(folder, 'cli.cjs'), `
    const fs = require('node:fs');
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method,params,pid:process.pid,args:process.argv.slice(2)})+'\\n');
    c.onRequest('initialize', p => {log('initialize',p); return {capabilities:{textDocumentSync:{openClose:true,change:1},completionProvider:{triggerCharacters:['.']}}}});
    c.onNotification('textDocument/didOpen', p => log('open',p));
    c.onNotification('textDocument/didChange', p => log('change',p));
    c.onRequest('textDocument/completion', () => [{label:'profileCompletion',kind:6,insertText:'profileCompletion'}]);
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'),
    PATH: path.join(root, 'bin'), npm_config_prefix: prefix, NPM_CONFIG_PREFIX: prefix,
    CONDA_PREFIX: '', VIRTUAL_ENV: '', CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'),
    GOBIN: '', PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
    const original = (await messages())[0];
    expect(original.args).toEqual(['--stdio']); expect(original.params.initializationOptions.hostInfo).toBe('setdown');
    expect((await messages()).find(m => m.method === 'open').params.textDocument.languageId).toBe('typescript');
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toContainText('profileCompletion');
    await editor.press('Escape'); await editor.pressSequentially('unsaved');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await management.getByRole('searchbox').fill('typescript-language-server'); await management.locator('.server-list button').click();
    await expect(management.locator('.state')).toHaveText('Running');
    await expect(management.locator('.details code').first()).toHaveText(path.join(folder, 'cli.cjs'));
    await management.getByRole('button', { name: 'Rescan installed servers' }).click();
    await expect(management.getByRole('button', { name: 'Rescan installed servers' })).toBeEnabled();
    expect(new Set((await messages()).map(m => m.pid))).toEqual(new Set([original.pid]));
    await management.getByRole('button', { name: 'Close language support' }).click();
    await editor.press('Control+z'); await editor.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toBe('const answer = 1;\n');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
