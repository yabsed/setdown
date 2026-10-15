import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from './electron-app';
const require = createRequire(import.meta.url);

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
    const management = page.getByRole('dialog', { name: 'Language Support' });
    await expect(management).toBeVisible();
    await expect(management.locator('footer')).toContainText('331 servers');
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
