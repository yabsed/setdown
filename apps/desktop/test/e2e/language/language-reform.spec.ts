import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
const require = createRequire(import.meta.url);

test('real IPC preserves cancellation, independent diagnostic registrations and a 4,097-item completion list', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-lsp-reform-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown'), file = path.join(root, 'main.reform');
  const server = path.join(root, 'server.cjs'), log = path.join(root, 'rpc.jsonl');
  await mkdir(settings, { recursive: true }); await writeFile(file, 'first plain\n');
  await writeFile(server, `
    const fs=require('node:fs');
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter,ResponseError}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method,params})+'\\n');
    let semantic=0, registered=false;
    c.onRequest('initialize',p=>({capabilities:{textDocumentSync:1,hoverProvider:true,completionProvider:{resolveProvider:true},
      semanticTokensProvider:{legend:{tokenTypes:['function'],tokenModifiers:[]},full:true}}}));
    c.onNotification('textDocument/didOpen',async()=>{if(registered)return;registered=true;
      await c.sendRequest('client/registerCapability',{registrations:['types','lint'].map(identifier=>({id:identifier,method:'textDocument/diagnostic',registerOptions:{identifier,interFileDependencies:false,workspaceDiagnostics:false,documentSelector:[{language:'reform'}]}}))});
    });
    c.onRequest('textDocument/diagnostic',p=>{log('diagnostic',p);return {kind:'full',resultId:p.identifier+'-1',items:[{range:{start:{line:0,character:p.identifier==='types'?0:6},end:{line:0,character:p.identifier==='types'?5:11}},message:p.identifier,severity:1}]}});
    c.onRequest('textDocument/semanticTokens/full',p=>{log('semantic',p);if(++semantic===1)throw new ResponseError(-32802,'retrigger');return {data:[0,0,5,0,0]}});
    c.onRequest('textDocument/completion',p=>{log('completion',p);return Array.from({length:4097},(_,i)=>({label:'first'+String(i).padStart(5,'0'),data:{index:i}}))});
    c.onRequest('completionItem/resolve',p=>{log('resolve',p);return {...p,detail:'Resolved '+p.data.index}});
    c.onRequest('textDocument/hover',async()=>{await c.sendRequest('client/unregisterCapability',{unregisterations:[{id:'types',method:'textDocument/diagnostic'}]});return {contents:'Hover'}});
    c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  `);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { reform: { enabled: true } }, preferred: {}, custom: [{
    id: 'reform', name: 'Reform Fixture', launch: { kind: 'native', command: process.execPath, args: [server] },
    languages: [{ languageId: 'reform', monacoId: 'plaintext', extensions: ['.reform'] }], rootMarkers: [], settings: {},
  }] }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect.poll(async () => (await messages()).filter(m => m.method === 'semantic').length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.squiggly-error')).toHaveCount(2);
    expect(new Set((await messages()).filter(m => m.method === 'diagnostic').map(m => m.params.identifier))).toEqual(new Set(['types', 'lint']));
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+Home'); for (let i = 0; i < 5; i++) await editor.press('ArrowRight');
    await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('first00000');
    await expect.poll(async () => (await messages()).find(m => m.method === 'resolve')?.params.data.index).toBe(0);
    await editor.press('Escape');
    await editor.press('Control+k'); await editor.press('Control+i');
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('independent-diagnostics.png') });
  } finally {
    await writeFile(testInfo.outputPath('rpc.jsonl'), await readFile(log, 'utf8').catch(() => ''));
    await disposeApplication(application); await rm(root, { recursive: true, force: true });
  }
});

test('built-in JSON, CSS and HTML workers work with external servers disabled', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-lsp-workers-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown');
  await mkdir(settings, { recursive: true });
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: {
    'json-lsp': { enabled: false }, 'css-lsp': { enabled: false }, 'html-lsp': { enabled: false },
  }, preferred: {}, custom: [] }));
  const files = { json: path.join(root, 'package.json'), css: path.join(root, 'style.css'), html: path.join(root, 'index.html') };
  await writeFile(files.json, '{ "name": }'); await writeFile(files.css, 'a { col }'); await writeFile(files.html, '<di');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', files.json], env: { ...env, XDG_CONFIG_HOME: config } });
  const errors: string[] = [];
  try {
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await focusApplication(application);
    await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
    for (const [file, expected] of [[files.css, 'color'], [files.html, 'div']]) {
      const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), file);
      await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
      await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replace('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
      const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
      await editor.press('Control+End');
      if (file === files.css) { await editor.press('ArrowLeft'); await editor.press('ArrowLeft'); }
      await editor.press('Control+Space');
      await expect(page.locator('.suggest-widget.visible')).toContainText(expected);
      await editor.press('Escape');
    }
    expect(errors.filter(error => /worker|doValidation|Unexpected usage|Could not create/i.test(error))).toEqual([]);
    await writeFile(testInfo.outputPath('console.json'), JSON.stringify(errors, null, 2));
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
