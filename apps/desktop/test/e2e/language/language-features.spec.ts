import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
const require = createRequire(import.meta.url);
async function command(page: Page, label: string) {
  await page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }).press('F1');
  const input = page.locator('.quick-input-box input');
  await input.fill(`>${label}`);
  await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first().click();
}

test('negotiated semantic colors, formatting Undo, quick-fix command edits, workspace navigation and versionless diagnostics use real Monaco', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-features-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown');
  const file = path.join(root, 'main.featuretest'), other = path.join(root, 'other.featuretest'), server = path.join(root, 'server.cjs'), log = path.join(root, 'rpc.jsonl');
  await mkdir(settings, { recursive: true });
  await writeFile(file, 'painted plain\nbad\n'); await writeFile(other, 'before\n');
  await writeFile(server, `
    const fs=require('node:fs'), {pathToFileURL}=require('node:url');
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method,params})+'\\n');
    const main=pathToFileURL(${JSON.stringify(file)}).href, other=pathToFileURL(${JSON.stringify(other)}).href;
    const range=(line,start,end)=>({start:{line,character:start},end:{line,character:end}});
    const documents=new Map();
    c.onRequest('initialize',p=>{log('initialize',p);return {capabilities:{textDocumentSync:{openClose:true,change:1,save:true,willSave:true,willSaveWaitUntil:true},
      semanticTokensProvider:{legend:{tokenTypes:['function'],tokenModifiers:[]},full:{delta:true}},
      documentFormattingProvider:true,codeActionProvider:{resolveProvider:true},workspaceSymbolProvider:{resolveProvider:true},
      callHierarchyProvider:true,inlayHintProvider:true,
      workspace:{fileOperations:{
        willRename:{filters:[{pattern:{glob:'**/*.featuretest'}}]},
        didRename:{filters:[{pattern:{glob:'**/*.featuretest'}}]}
      }}
    }};});
    const diagnose=d=>c.sendNotification('textDocument/publishDiagnostics',{uri:d.uri,diagnostics:d.text.includes('bad')?[{range:range(1,0,3),message:'Fixture error',severity:1,data:{fix:42}}]:[]});
    c.onNotification('textDocument/didOpen',p=>{log('open',p);documents.set(p.textDocument.uri,p.textDocument);diagnose(p.textDocument)});
    c.onNotification('textDocument/didChange',p=>{const d={...documents.get(p.textDocument.uri),...p.textDocument,text:p.contentChanges[0].text};documents.set(d.uri,d);log('change',d);diagnose(d)});
    c.onNotification('textDocument/willSave',p=>log('willSave',p));
    c.onRequest('textDocument/willSaveWaitUntil',()=>[]);
    c.onRequest('textDocument/semanticTokens/full',p=>{log('semantic',p);return {resultId:'tokens',data:p.textDocument.uri===main?[0,0,7,0,0]:[]}});
    c.onRequest('textDocument/semanticTokens/full/delta',()=>({resultId:'tokens',edits:[]}));
    c.onRequest('textDocument/formatting',p=>{log('format',p);return [{range:range(0,8,13),newText:'formatted'}]});
    c.onRequest('textDocument/codeAction',p=>{log('actions',p);return [{title:'Fix fixture',kind:'quickfix',data:{fix:42}}]});
    c.onRequest('codeAction/resolve',p=>({title:p.title,edit:{changes:{[main]:[{range:range(1,0,3),newText:'good'}]}},command:{title:'Update other',command:'fixture.update',arguments:[42]}}));
    c.onRequest('workspace/executeCommand',async p=>{log('command',p);const result=await c.sendRequest('workspace/applyEdit',{edit:{changes:{[other]:[{range:range(0,0,6),newText:'after'}]}}});log('applied',result);return null});
    c.onRequest('workspace/symbol',p=>{log('symbols',p);return [{name:'otherSymbol',kind:12,location:{uri:other},data:42}]});
    c.onRequest('workspaceSymbol/resolve',p=>({...p,location:{uri:other,range:range(0,0,5)}}));
    c.onRequest('textDocument/prepareCallHierarchy',()=>[{name:'painted',kind:12,uri:main,range:range(0,0,7),selectionRange:range(0,0,7),data:42}]);
    c.onRequest('callHierarchy/incomingCalls',p=>[{from:{name:'caller',kind:12,uri:other,range:range(0,0,5),selectionRange:range(0,0,5)},fromRanges:[range(0,0,5)]}]);
    c.onRequest('textDocument/inlayHint',()=>[{position:{line:0,character:7},label:': Fixture',kind:1}]);
    c.onRequest('workspace/willRenameFiles',p=>{log('willRename',p);return {changes:{[main]:[{range:range(1,0,4),newText:'linked'}]}}});
    c.onNotification('workspace/didRenameFiles',p=>log('didRename',p));
    c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  `);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { 'feature-fixture': { enabled: true } }, preferred: {}, custom: [{
    id: 'feature-fixture', name: 'Feature Fixture', launch: { kind: 'native', command: process.execPath, args: [server] },
    languages: [{ languageId: 'featuretest', monacoId: 'plaintext', extensions: ['.featuretest'] }], rootMarkers: [], settings: {},
  }] }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root); await page.reload();
    await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect(page.locator('.squiggly-error')).toHaveCount(1); // The fixture deliberately omits diagnostic.version.
    await expect.poll(async () => (await messages()).some(m => m.method === 'semantic')).toBe(true);
    const firstLine = page.locator('.monaco-editor .view-line').first();
    await expect.poll(() => firstLine.evaluate(line => [...line.querySelectorAll('span')].filter(span => span.textContent?.trim()).map(span => getComputedStyle(span).color).filter((color,index,all) => all.indexOf(color) === index).length)).toBeGreaterThan(1);
    const functionColor = () => firstLine.evaluate(line => {
      const token = [...line.querySelectorAll('span')].find(span => span.textContent === 'painted');
      return token ? getComputedStyle(token).color : null;
    });
    const originalFunctionColor = await functionColor();
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-vscode-dark-2026')!.click());
    await expect.poll(functionColor).toBe('rgb(210, 168, 255)');
    await page.screenshot({ path: testInfo.outputPath('semantic-vscode-dark-2026.png') });
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-github-light')!.click());
    await expect.poll(functionColor).toBe(originalFunctionColor);
    await page.screenshot({ path: testInfo.outputPath('semantic-colors.png') });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await command(page, 'Format Document');
    await expect(firstLine).toContainText('formatted');
    await editor.press('Control+z'); await expect(firstLine).toContainText('plain');
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await editor.press('Control+Home'); await editor.press('ArrowDown');
    await editor.press('Control+.');
    await page.mouse.move(1, 1); // Monaco's opening-click shield retires on real pointer movement.
    await page.getByText('Fix fixture', { exact: true }).click();
    await expect.poll(async () => (await messages()).find(m => m.method === 'applied')?.params.applied).toBe(true);
    expect((await messages()).find(m => m.method === 'command')?.params).toEqual({ command: 'fixture.update', arguments: [42] });
    expect((await messages()).some(m => m.method === 'actions' && m.params.context.diagnostics.some((d: { data?: { fix?: number } }) => d.data?.fix === 42))).toBe(true);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    expect(await readFile(other, 'utf8')).toBe('before\n'); // An edit opens a dirty ordinary tab, without saving it.
    await command(page, 'Go to Workspace Symbol…');
    const results = page.getByRole('dialog', { name: 'Workspace Symbols' });
    await results.getByRole('textbox', { name: 'Search workspace symbols' }).fill('other');
    await results.getByRole('button').filter({ hasText: 'otherSymbol' }).click();
    await expect(page.getByRole('tab', { name: /other\.featuretest/ })).toHaveAttribute('aria-selected', 'true');
    await editor.press('Control+s'); await expect.poll(() => readFile(other, 'utf8')).toBe('after\n');
    await editor.press('Control+z'); await editor.press('Control+s'); await expect.poll(() => readFile(other, 'utf8')).toBe('before\n');
    await expect.poll(async () => (await messages()).some(m => m.method === 'willSave')).toBe(true);
    await page.getByRole('tab', { name: /main\.featuretest/ }).click();
    await command(page, 'Show Incoming Calls');
    const hierarchy = page.getByRole('dialog', { name: 'Incoming Calls' });
    await hierarchy.getByRole('button', { name: 'Explore painted' }).click();
    await expect(hierarchy).toContainText('caller');
    await hierarchy.getByRole('button', { name: 'Close language results' }).click();
    await command(page, 'Toggle Inlay Hints');
    await expect(page.locator('.monaco-editor')).toContainText(': Fixture');
    await page.screenshot({ path: testInfo.outputPath('inlay-hints.png') });
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const entry = page.getByRole('treeitem', { name: 'other.featuretest', exact: true });
    await entry.focus(); await entry.press('F2');
    const rename = page.getByRole('textbox', { name: 'Rename entry' });
    await rename.fill('renamed.featuretest'); await rename.press('Enter');
    await expect.poll(async () => (await messages()).some(m => m.method === 'didRename')).toBe(true);
    expect(await readFile(path.join(root, 'renamed.featuretest'), 'utf8')).toBe('before\n');
    await expect(page.getByRole('tab', { name: /main\.featuretest/ })).toHaveAttribute('aria-selected', 'true');
    await editor.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toBe('painted plain\nlinked\n');
    await editor.press('Control+z'); await editor.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toBe('painted plain\ngood\n');
  } finally {
    await writeFile(testInfo.outputPath('language-server-messages.jsonl'), await readFile(log, 'utf8').catch(() => ''));
    await disposeApplication(application); await rm(root, { recursive: true, force: true });
  }
});
