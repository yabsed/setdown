import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { runCommand } from '../../support/editor/commands';
const require = createRequire(import.meta.url);

async function openFile(application: Awaited<ReturnType<typeof electron.launch>>, file: string) {
  const page = await application.firstWindow();
  const snapshot = await page.evaluate(file => window.marktex.readDocumentLocation(file), file);
  await application.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('document:opened', snapshot), snapshot);
  await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
}

test('without servers, language modes and real local errors survive; project guesses and schema loading failures are not code errors', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-policy-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown');
  await mkdir(settings, { recursive: true });
  const profiles = JSON.parse(await readFile(path.resolve('src/main/language/catalog/profiles.json'), 'utf8')).profiles as { id: string }[];
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: Object.fromEntries(profiles.map(p => [p.id, { enabled: false }])), preferred: {}, custom: [] }));
  const jsonc = path.join(root, 'tsconfig.json'), jsonl = path.join(root, 'data.jsonl');
  await writeFile(jsonc, '{ // comment\n "compilerOptions": { "strict": true, },\n}');
  await writeFile(jsonl, '{"a":1}\n{"b":2}\n');
  const cpp = path.join(root, 'hello.cpp'), tsx = path.join(root, 'component.tsx'), json = path.join(root, 'data.json'), html = path.join(root, 'index.html');
  await writeFile(cpp, '#include "unavailable.hpp"\nint main() {}\n');
  await writeFile(tsx, 'import { value } from "./not-in-this-worker";\nconst view = <div />;\n');
  await writeFile(json, '{ "$schema": "https://setdown.invalid/schema.json", "value": }');
  await writeFile(html, '<di');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', cpp], env: { ...env, XDG_CONFIG_HOME: config } });
  const errors: string[] = [];
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    page.on('pageerror', error => errors.push(error.message));
    // Nothing is wrong, so the status is the language's name and nothing else.
    await expect(page.getByRole('button', { name: 'Language status: C++', exact: true })).toBeVisible();
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await openFile(application, tsx);
    const status = page.getByRole('button', { name: /Language status:/ });
    await status.click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Only local checks are active.');
    await panel.getByRole('button', { name: 'More…', exact: true }).click(); await expect(panel).toContainText('Syntax only');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close language status' }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('const broken = ;');
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await openFile(application, json);
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await status.click(); await expect(panel).toContainText('Unable to load schema');
    await panel.getByRole('button', { name: 'More…', exact: true }).click(); await panel.getByRole('button', { name: 'Problems', exact: true }).click();
    const problems = page.getByRole('dialog', { name: 'Problems · Open Files' });
    await expect(problems).toContainText('Value expected');
    await expect(problems).not.toContainText('Unable to load schema');
    await problems.getByRole('button', { name: 'Close language results' }).click();
    await openFile(application, jsonc);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await openFile(application, jsonl);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await editor.press('Control+End'); await editor.pressSequentially('{"c":}');
    await expect(page.locator('.squiggly-error')).toHaveCount(1);
    await openFile(application, html);
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click();
    const details = panel;
    await details.getByRole('button', { name: /^HTML/ }).click();
    await details.getByText('Supported features and service context', { exact: true }).click();
    await expect(details).toContainText('Checks: Not provided');
    await expect(details).toContainText('Completion');
    await details.getByRole('button', { name: 'Close language status', exact: true }).click();
    await status.click(); await panel.getByRole('button', { name: /^Language/ }).click();
    await panel.getByRole('combobox', { name: 'Language mode' }).selectOption('plaintext');
    await expect(status).toHaveAccessibleName('Language status: Plain Text');
    await expect(status).toBeFocused();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('without-analysis-server.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('project analysis, a supplementary formatter and local validation share one document without overwriting diagnostics', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-providers-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown'), file = path.join(root, 'main.providers');
  const server = path.join(root, 'server.cjs'), log = path.join(root, 'rpc.jsonl');
  await mkdir(settings, { recursive: true }); await writeFile(file, '{ "value": }\n');
  await writeFile(server, `
    const fs = require('node:fs');
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const name=process.argv[2], c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({name,method,params})+'\\n');
    c.onRequest('initialize',()=>({capabilities:{textDocumentSync:{openClose:true,change:1,willSave:true,willSaveWaitUntil:true,save:true},hoverProvider:true,documentFormattingProvider:true,workspaceSymbolProvider:name==='companion',callHierarchyProvider:name==='analysis'}}));
    let uri;
    const publish=p=>{const d=p.textDocument;uri=d.uri;log('document',d);c.sendNotification('textDocument/publishDiagnostics',{uri:d.uri,version:d.version,diagnostics:[{range:{start:{line:0,character:2},end:{line:0,character:9}},severity:2,message:name+' diagnostic',source:name}]})};
    c.onNotification('textDocument/didOpen',publish); c.onNotification('textDocument/didChange',publish);
    c.onRequest('textDocument/hover',()=>({contents:name+' hover'}));
    c.onRequest('textDocument/formatting',p=>{log('format',p);return [{range:{start:{line:0,character:0},end:{line:0,character:12}},newText:'{"value": 1}'}]});
    c.onRequest('workspace/symbol',p=>{log('symbols',p);return [{name:name+' symbol',kind:13,location:{uri,range:{start:{line:0,character:0},end:{line:0,character:1}}}}]});
    c.onRequest('textDocument/prepareCallHierarchy',p=>{log('calls',p);return []});
    c.onNotification('textDocument/willSave',p=>log('willSave',p));
    c.onRequest('textDocument/willSaveWaitUntil',p=>{log('beforeSave',p);return []});
    c.onNotification('textDocument/didSave',p=>log('saved',p));
    c.onRequest('shutdown',()=>null); c.onNotification('exit',()=>process.exit(0)); c.listen();
  `);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1,
    servers: { analysis: { enabled: true }, companion: { enabled: true, formatting: true } }, preferred: { providers: 'analysis' },
    custom: ['analysis', 'companion'].map(id => ({ id, name: id, role: id === 'analysis' ? 'primary' : 'supplementary',
      launch: { kind: 'native', command: process.execPath, args: [server, id] }, languages: [{ languageId: 'providers', monacoId: 'json', extensions: ['.providers'] }], rootMarkers: [], settings: {} })) }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect.poll(async () => new Set((await messages()).filter(m => m.method === 'document').map(m => m.name)).size).toBe(2);
    const status = page.getByRole('button', { name: /Language status:/ }); await status.click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Working');
    await panel.getByRole('button', { name: 'More…', exact: true }).click();
    const details = panel;
    await expect(details).toContainText('analysis'); await expect(details).toContainText('companion');
    await details.getByRole('button', { name: 'Close language status', exact: true }).click();
    await status.click();
    await panel.getByRole('button', { name: 'More…', exact: true }).click(); await panel.getByRole('button', { name: 'Problems', exact: true }).click();
    const problems = page.getByRole('dialog', { name: 'Problems · Open Files' });
    await expect(problems).toContainText('analysis diagnostic'); await expect(problems).toContainText('companion diagnostic');
    await expect(problems).toContainText('Value expected');
    await problems.getByRole('button', { name: 'Close language results' }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await runCommand(page, editor, 'Format Document');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'format').map(m => m.name)).toEqual(['companion']);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click(); await panel.getByRole('button', { name: 'Problems', exact: true }).click();
    await expect(problems).toContainText('analysis diagnostic'); await expect(problems).toContainText('companion diagnostic');
    await expect(problems).not.toContainText('Value expected');
    await page.screenshot({ path: testInfo.outputPath('multiple-providers.png') });
    await problems.getByRole('button', { name: 'Close language results' }).click();
    await runCommand(page, editor, 'Go to Workspace Symbol');
    const symbols = page.getByRole('dialog', { name: 'Workspace Symbols' });
    await expect(symbols).toContainText('companion symbol');
    expect([...new Set((await messages()).filter(m => m.method === 'symbols').map(m => m.name))]).toEqual(['companion']);
    await symbols.getByRole('button', { name: 'Close language results' }).click();
    await runCommand(page, editor, 'Show Incoming Calls');
    const calls = page.getByRole('dialog', { name: 'Incoming Calls' });
    await expect(calls).toBeVisible();
    // The command list also asks what applies at the cursor each time it opens, so the question is
    // put more than once. Every time it goes to the analysis tool and never to the supplementary one.
    await expect.poll(async () => [...new Set((await messages()).filter(m => m.method === 'calls').map(m => m.name))]).toEqual(['analysis']);
    await calls.getByRole('button', { name: 'Close language results' }).click();
    await editor.press('Control+s');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'saved').map(m => m.name).sort()).toEqual(['analysis', 'companion']);
    for (const method of ['willSave', 'beforeSave'])
      expect((await messages()).filter(m => m.method === method).map(m => m.name)).toEqual(['analysis', 'companion']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ value: 1 });
  } finally {
    await writeFile(testInfo.outputPath('rpc.jsonl'), await readFile(log, 'utf8').catch(() => ''));
    await disposeApplication(application); await rm(root, { recursive: true, force: true });
  }
});


test('the bundled project service resolves installed and sibling imports while preserving real missing-import and type errors', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-project-analysis-'));
  const file = path.join(root, 'example.test.ts'), config = path.join(root, 'config');
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true } }));
  await symlink(path.resolve('../../node_modules'), path.join(root, 'node_modules'), 'dir');
  await writeFile(path.join(root, 'helper.ts'), 'export const sum = (a: number, b: number) => a + b;');
  await writeFile(file, 'import { expect, test } from "vitest";\nimport { sum } from "./helper";\ntest("sum", () => expect(sum(1, 2)).toBe(3));\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const status = page.getByRole('button', { name: /Language status:/ }); await status.click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Working', { timeout: 25_000 });
    await panel.getByRole('button', { name: 'More…', exact: true }).click();
    const details = panel;
    await expect(details).toContainText('Results received for this open file', { timeout: 25_000 });
    await details.getByRole('button', { name: /^TypeScript and JavaScript/ }).click();
    await details.getByText('Supported features and service context', { exact: true }).click();
    await expect(details).toContainText('Server diagnostics');
    await details.getByRole('button', { name: 'Close language status', exact: true }).click();
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click();
    await expect(panel).toContainText('TypeScript and JavaScript');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('project-language-support.png') });
    await panel.getByRole('button', { name: 'Close language status' }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('const wrong: number = "text";\nimport "./actually-missing";');
    // A side-effect import is intentionally unchecked by some TS configurations;
    // use a named import to require resolution without changing project settings.
    await editor.press('Control+End'); await editor.pressSequentially('\nimport { missing } from "./missing-module";');
    await expect(page.locator('.squiggly-error')).toHaveCount(2);
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click(); await panel.getByRole('button', { name: 'Problems', exact: true }).click();
    const problems = page.getByRole('dialog', { name: 'Problems · Open Files' });
    await expect(problems).toContainText("Type 'string' is not assignable to type 'number'");
    await expect(problems).toContainText('./missing-module');
    await expect(problems).not.toContainText("Cannot find module 'vitest'");
    await expect(problems).not.toContainText("Cannot find module './helper'");
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test("beside the project service the editor's own worker adds no second answer, and answers again when analysis is off", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-one-answer-'));
  const file = path.join(root, 'example.ts'), config = path.join(root, 'config');
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true } }));
  await writeFile(path.join(root, 'helper.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
  await writeFile(file, 'import { sum } from "./helper";\nexport const three = sum(1, 2);\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const status = page.getByRole('button', { name: /Language status:/ }); await status.click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Working', { timeout: 25_000 });
    await panel.getByRole('button', { name: 'More…', exact: true }).click();
    await expect(panel).toContainText('Results received for this open file', { timeout: 25_000 });
    // The row of the editor's own worker no longer claims what the project service answers.
    await panel.getByRole('button', { name: /^TypeScript\s+Built in/ }).click();
    await panel.getByText('Supported features and service context', { exact: true }).click();
    await expect(panel).toContainText('Formatting');
    await expect(panel).not.toContainText('Hover');
    await expect(panel).not.toContainText('Completion');
    await panel.getByRole('button', { name: 'Close language status', exact: true }).click();

    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    const selected = page.locator('.document-tab[aria-selected="true"]');
    const toImportedName = async () => { await editor.press('Control+Home'); for (let i = 0; i < 10; i++) await editor.press('ArrowRight'); };
    // The pointer goes onto the imported name itself, found in the drawn line.
    const hoverImportedName = async () => {
      const point = await page.evaluate(() => {
        const text = (node: Node) => (node.textContent ?? '').replace(/\u00a0/g, ' ');
        const line = [...document.querySelectorAll('.editor-host .view-line')].find(item => text(item).startsWith('import { sum }'));
        if (!line) throw Error('The import line is not on screen.');
        let offset = text(line).indexOf('sum');
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = text(node).length;
          if (offset < length) { const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, Math.min(length, offset + 3)); const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }
          offset -= length;
        }
        throw Error('The imported name is not on screen.');
      });
      await page.mouse.move(point.x - 1, point.y); await page.mouse.move(point.x, point.y);
      const hover = page.locator('.monaco-hover:visible').first(); await expect(hover).toBeVisible();
      return hover;
    };
    // One hover: the project service's. The worker cannot follow the import and would add "import sum" below it.
    const hover = await hoverImportedName();
    await expect(hover).toContainText('(a: number, b: number) => number');
    expect((await hover.innerText()).match(/import sum/g) ?? []).toHaveLength(1);
    await page.mouse.move(40, 400); await editor.press('Escape');
    // One definition: the file the name comes from. Two answers opened a list on the import line instead.
    await toImportedName(); await editor.press('F12');
    await expect(selected).toContainText('helper.ts');
    await expect(page.locator('.peekview-widget')).toHaveCount(0);

    // With project analysis off for the project, the worker is the only one who answers: it does again.
    await page.getByRole('tab', { name: /example\.ts/ }).click();
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click();
    await panel.getByRole('button', { name: /^TypeScript and JavaScript/ }).click();
    await panel.getByRole('button', { name: 'Choose analysis tool…', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Analysis provider', exact: true }).selectOption('off');
    await panel.getByRole('button', { name: 'Close language status', exact: true }).click();
    await status.click(); await panel.getByRole('button', { name: 'More…', exact: true }).click();
    await panel.getByRole('button', { name: /^TypeScript\s+Built in/ }).click();
    await panel.getByText('Supported features and service context', { exact: true }).click();
    await expect(panel).toContainText('Hover');
    await panel.getByRole('button', { name: 'Close language status', exact: true }).click();
    const alone = await hoverImportedName();
    await expect(alone).toContainText('import sum');
    await expect(alone).not.toContainText('(a: number, b: number) => number');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
