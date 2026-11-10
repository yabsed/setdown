import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const require = createRequire(import.meta.url), exec = promisify(execFile);
const component = `<script lang="ts">
import type { Color } from './types';
let painted = $state(2);
const title = "Hello Svelte";
// A syntax comment
</script>
{#if painted > 0}
<button class="counter" onclick={() => painted++}>{title}</button>
{/if}
{#each [1, 2] as item}
<span>{item}</span>
{/each}
<style>
button { color: red; margin: 2px; }
</style>
`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-syntax-'));
  const config = path.join(root, 'config'), settings = path.join(config, 'Setdown'), file = path.join(root, 'Counter.svelte');
  await mkdir(settings, { recursive: true }); await writeFile(file, component);
  const profiles = [...JSON.parse(await readFile(path.resolve('src/main/language/catalog/profiles.json'), 'utf8')).profiles,
    ...JSON.parse(await readFile(path.resolve('src/main/language/catalog/zed-profiles.json'), 'utf8')).profiles] as { id: string }[];
  const servers = Object.fromEntries(profiles.map(profile => [profile.id, { enabled: false }]));
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers, preferred: {}, custom: [] }));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  return { root, settings, file, servers, launch: (initial = file) => electron.launch({ args: ['.', initial], env: { ...env, XDG_CONFIG_HOME: config } }) };
}
async function open(page: Page, file: string) {
  await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
}
async function theme(page: Page, name: string) {
  await page.evaluate(name => window.marktex.executeApplicationMenuItem(`preview-theme-${name}`), name);
  await expect(page.locator('html')).toHaveAttribute('data-theme', name);
}
function color(view: Locator, line: string, word: string) {
  return view.evaluate((root, { line, word }) => {
    const normalize = (text: string) => text.replace(/\u00a0/g, ' ');
    const row = [...root.querySelectorAll('.view-line')].find(row => normalize(row.textContent ?? '').includes(line));
    if (!row) return null;
    const offset = normalize(row.textContent ?? '').indexOf(word); let start = 0;
    for (const span of row.querySelectorAll(':scope > span > span')) {
      const end = start + (span.textContent?.length ?? 0);
      if (start <= offset && offset < end) return getComputedStyle(span).color;
      start = end;
    }
    return null;
  }, { line, word });
}

test('an open project inherits .zed YAML settings into infra files and hot reload preserves the unsaved editor and Undo', async () => {
  const f = await fixture(), file = path.join(f.root, 'infra/backend/template.yaml');
  const config = path.join(f.root, '.zed/settings.json'), server = path.join(f.root, 'yaml-fixture.cjs'), log = path.join(f.root, 'yaml.jsonl');
  await mkdir(path.dirname(file), { recursive: true }); await mkdir(path.dirname(config));
  await writeFile(file, 'name: !Sub "hello"\n');
  const configure = (tags: string[]) => writeFile(config, JSON.stringify({ lsp: { 'yaml-language-server': { settings: { yaml: { customTags: tags } } } } }));
  await configure(['!Sub scalar', '!Sub sequence']);
  await writeFile(server, `
    const fs=require('node:fs');
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,method,params})+'\\n');
    c.onRequest('initialize',p=>{log('initialize',p);return {capabilities:{textDocumentSync:{openClose:true,change:1}}};});
    c.onNotification('initialized',async()=>log('settings',await c.sendRequest('workspace/configuration',{items:[{section:'yaml'}]})));
    c.onNotification('textDocument/didOpen',p=>log('open',p));c.onNotification('textDocument/didChange',p=>log('change',p));
    c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  `);
  await writeFile(path.join(f.settings, 'language-servers.json'), JSON.stringify({ version: 1, preferred: { yaml: 'yaml-language-server' },
    servers: { ...f.servers, 'yaml-language-server': { enabled: true } }, custom: [{ id: 'yaml-language-server', name: 'YAML settings fixture',
      launch: { kind: 'native', command: process.execPath, args: [server] }, languages: [{ languageId: 'yaml', monacoId: 'yaml', extensions: ['.yaml'] }],
      rootMarkers: [], settings: {} }] }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const app = await f.launch();
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    }, f.root);
    await page.evaluate(() => window.marktex.chooseProjectFolder());
    expect(await page.evaluate(() => window.marktex.getProjectFolder())).toMatchObject({ path: f.root });
    await open(page, file);
    await expect.poll(async () => (await messages()).find(m => m.method === 'settings')?.params).toEqual([{ customTags: ['!Sub scalar', '!Sub sequence'] }]);
    expect((await messages()).find(m => m.method === 'initialize').params.rootUri).toBe(pathToFileURL(f.root).href);
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    // A single word avoids Monaco's word-based typing Undo stops.
    await input.press('Control+End'); await page.keyboard.insertText('unsavedrevision');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'change').at(-1)?.params.contentChanges[0].text).toContain('unsavedrevision');
    await configure(['!Sub scalar', '!Sub sequence', '!Ref scalar']);
    await expect.poll(async () => (await messages()).filter(m => m.method === 'settings').at(-1)?.params).toEqual([{ customTags: ['!Sub scalar', '!Sub sequence', '!Ref scalar'] }]);
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').at(-1)?.params.textDocument.text).toContain('unsavedrevision');
    await expect(input).toBeFocused(); await input.press('Control+z'); await input.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8')).toBe('name: !Sub "hello"\n');
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});

test('build languages and YAML dialects retain grammar, comments and Make recipe tabs with every server disabled',async({},info)=>{
  const f=await fixture();
  const samples=[
    ['Makefile','# syntax marker\nall:\n'],['CMakeLists.txt','# syntax marker\nproject(example)\n'],
    ['Justfile','# syntax marker\nhello:\n    echo "hello"\n'],['main.f90','! syntax marker\nprogram example\nend program\n'],
    ['plain.yaml','# syntax marker\nname: example\n'],['compose.yaml','# syntax marker\nservices: {}\n'],
    ['.github/workflows/build.yml','# syntax marker\nname: Build\non: push\njobs: {}\n'],
    ['.gitlab-ci.yml','# syntax marker\nstages: [test]\n'],
  ];
  for(const [name,text] of samples){const file=path.join(f.root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);}
  const app=await f.launch(path.join(f.root,'Makefile'));
  try{
    const page=await app.firstWindow();await focusApplication(app);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const view=page.locator('.editor-surface .view-lines');
    for(const [name] of samples){await open(page,path.join(f.root,name));await expect.poll(()=>color(view,'syntax marker','marker'),{message:`${name} comment grammar`}).toBe('rgb(110, 119, 129)');}
    await open(page,path.join(f.root,'Makefile'));
    const input=page.locator('.editor-surface').getByRole('textbox',{name:'Editor content'});
    await input.press('Control+End');await input.press('Tab');await input.pressSequentially('@echo ready');await input.press('Control+s');
    await expect.poll(()=>readFile(path.join(f.root,'Makefile'),'utf8')).toBe('# syntax marker\nall:\n\t@echo ready');
    await input.press('Control+z');await expect(input).toBeFocused();
    expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('make-and-language-packages.png')});
  }finally{await disposeApplication(app);await rm(f.root,{recursive:true,force:true});}
});

test('a language absent from the application gets real WASM syntax from its runtime package with no server or network', async ({}, info) => {
  const f = await fixture(), id = 'setdown-future-fixture', file = path.join(f.root, 'new.future-fixture');
  const directory = path.join(f.settings, 'language-packages'), extension = path.join(directory, 'extensions', id);
  await mkdir(path.join(extension, 'grammars'), { recursive: true });
  await mkdir(path.join(extension, 'languages/future'), { recursive: true });
  await copyFile(path.resolve('test/fixtures/language-package/make.wasm'), path.join(extension, 'grammars/make.wasm'));
  await writeFile(path.join(extension, 'extension.toml'), `id="${id}"\nname="Future fixture"\nversion="1.0.0"\nschema_version=1\n[grammars.make]\nrepository="https://example.invalid/grammar"\nrev="fixture"\n`);
  await writeFile(path.join(extension, 'languages/future/config.toml'), 'name="Future Fixture"\ngrammar="make"\npath_suffixes=["future-fixture"]\n');
  await writeFile(path.join(extension, 'languages/future/highlights.scm'), '(comment) @comment\n');
  await writeFile(path.join(extension, '.setdown-package'), JSON.stringify({ version: '1.0.0', sha256: '1'.repeat(64) }));
  await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ version: 1, checked: Date.now(), packages: [{ id, version: '1.0.0', sha256: '1'.repeat(64),
    url: 'https://example.invalid/package', profiles: [], bindings: [], languages: [{ id, sourceId: id, name: id, label: 'Future Fixture',
      extensions: ['.future-fixture'], filenames: [], filenamePatterns: [], shebangs: [], lineComment: '#',
      treeSitter: { extension: id, config: 'languages/future/config.toml' } }] }] }));
  await writeFile(file, '# héllo 😀 syntax marker\nall:\n');
  const app = await f.launch(file);
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const view = page.locator('.editor-surface .view-lines');
    await expect.poll(() => color(view, 'syntax marker', 'marker'), { timeout: 15000 }).toBe('rgb(110, 119, 129)');
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await input.press('Control+End'); await input.pressSequentially('# newest marker');
    await expect.poll(() => color(view, 'newest marker', 'marker')).toBe('rgb(110, 119, 129)');
    await input.press('Control+z'); await expect(input).toBeFocused();
    await page.screenshot({ path: info.outputPath('runtime-wasm-language.png') });
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});

test('Svelte has lazy local grammar colors without servers; Python, theme changes and Undo keep working', async ({}, info) => {
  const f = await fixture(), markdown = path.join(f.root, 'notes.md'), python = path.join(f.root, 'colors.py');
  await writeFile(markdown, '# Notes\n\nA normal reader.\n'); await writeFile(python, 'def hello():\n    return "hello"\n');
  const app = await f.launch(markdown);
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // Chromium omits file:// module requests from Resource Timing. Debugger
    // scriptParsed replays already-loaded scripts as well as future imports.
    const scripts = new Set<string>(), cdp = await page.context().newCDPSession(page);
    cdp.on('Debugger.scriptParsed', event => scripts.add(event.url)); await cdp.send('Debugger.enable');
    const loaded = () => [...scripts].filter(name => /\/(textmate-runtime|svelte|wasm-inlined)-/.test(name));
    await expect(page.getByRole('button', { name: 'Switch to Editor' })).toBeVisible();
    expect(await loaded()).toEqual([]);
    await open(page, python);
    const view = page.locator('.editor-surface .view-lines'), input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect.poll(() => color(view, 'def hello', 'def')).toBe('rgb(207, 34, 46)');
    const pythonColor = await color(view, 'return', '"hello"'); expect(await loaded()).toEqual([]);
    await open(page, f.file);
    await expect.poll(() => color(view, 'import type', 'import')).toBe('rgb(207, 34, 46)');
    await expect.poll(() => color(view, 'import type', './types')).toBe('rgb(10, 48, 105)');
    await expect.poll(() => color(view, 'A syntax comment', 'comment')).toBe('rgb(110, 119, 129)');
    await expect.poll(() => color(view, 'let painted', '2')).toBe('rgb(5, 80, 174)');
    await expect.poll(() => color(view, '#if', 'if')).toBe('rgb(207, 34, 46)');
    await expect.poll(() => color(view, '#each', 'each')).toBe('rgb(207, 34, 46)');
    await expect.poll(() => color(view, '<button', 'button')).toBe('rgb(130, 80, 223)');
    await expect.poll(() => color(view, '<button', 'class')).toBe('rgb(17, 99, 41)');
    await expect.poll(() => color(view, 'margin:', '2')).toBe('rgb(5, 80, 174)');
    expect((await loaded()).some(name => name.includes('/textmate-runtime-'))).toBe(true);
    expect((await loaded()).some(name => name.includes('/svelte-'))).toBe(true);
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('svelte-light-no-server.png') });
    await input.press('Control+End'); await page.keyboard.insertText('keepUndo');
    const identity = await page.locator('.editor-surface .monaco-editor').elementHandle();
    for (const id of ['github-dark', 'vscode-dark-2026', 'github-dark-high-contrast', 'night-owl', 'dracula',
      'github-light-high-contrast', 'github-light']) {
      await theme(page, id);
      await expect.poll(() => color(view, 'import type', 'import')).not.toBe(await color(view, 'Hello Svelte', 'Hello Svelte'));
      expect(await identity!.evaluate(node => node === document.querySelector('.editor-surface .monaco-editor'))).toBe(true);
      await expect(view).toContainText('keepUndo');
      await page.screenshot({ path: info.outputPath(`svelte-${id}.png`) });
    }
    await input.press('Control+z'); await expect(view).not.toContainText('keepUndo');
    await input.press('Control+y'); await expect(view).toContainText('keepUndo');
    await input.press('Control+s'); await expect.poll(() => readFile(f.file, 'utf8')).toContain('keepUndo');
    await open(page, python); await expect.poll(() => color(view, 'def hello', 'def')).toBe('rgb(207, 34, 46)');
    await expect.poll(() => color(view, 'return', '"hello"')).toBe(pythonColor);
    expect(errors).toEqual([]);
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});

test('Svelte lexical colors coexist with negotiated LSP semantic tokens across themes', async ({}, info) => {
  const f = await fixture(), server = path.join(f.root, 'semantic.cjs');
  await writeFile(server, `
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    c.onRequest('initialize',()=>({capabilities:{textDocumentSync:{openClose:true,change:1},semanticTokensProvider:{legend:{tokenTypes:['function'],tokenModifiers:[]},full:true}}}));
    c.onRequest('textDocument/semanticTokens/full',()=>({data:[2,4,7,0,0]}));
    c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  `);
  await writeFile(path.join(f.settings, 'language-servers.json'), JSON.stringify({ version: 1,
    servers: { ...f.servers, 'syntax-fixture': { enabled: true } }, preferred: { svelte: 'syntax-fixture' },
    custom: [{ id: 'syntax-fixture', name: 'Syntax fixture', launch: { kind: 'native', command: process.execPath, args: [server] },
      languages: [{ languageId: 'svelte', monacoId: 'svelte', extensions: ['.svelte'] }], rootMarkers: [], settings: {} }] }));
  const app = await f.launch();
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const view = page.locator('.editor-surface .view-lines');
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
    await expect.poll(() => color(view, 'import type', 'import')).toBe('rgb(207, 34, 46)');
    await theme(page, 'vscode-dark-2026');
    await expect.poll(() => color(view, 'let painted', 'painted')).toBe('rgb(210, 168, 255)');
    await expect.poll(() => color(view, 'Hello Svelte', 'Hello Svelte')).toBe('rgb(165, 214, 255)');
    await expect.poll(() => color(view, 'A syntax comment', 'comment')).toBe('rgb(139, 148, 158)');
    await page.screenshot({ path: info.outputPath('svelte-lexical-and-semantic.png') });
    await theme(page, 'github-light');
    await expect.poll(() => color(view, 'import type', 'import')).toBe('rgb(207, 34, 46)');
    await expect.poll(() => color(view, 'let painted', 'painted')).not.toBe('rgb(36, 41, 47)');
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});

test('Svelte grammar reaches both Git comparison models and shared split editors', async ({}, info) => {
  const f = await fixture();
  await exec('git', ['init'], { cwd: f.root }); await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: f.root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: f.root });
  await exec('git', ['add', 'Counter.svelte'], { cwd: f.root }); await exec('git', ['commit', '-m', 'base'], { cwd: f.root });
  await writeFile(f.file, component.replace('Hello Svelte', 'Hello comparison'));
  const app = await f.launch();
  try {
    const page = await app.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), f.root); await page.reload(); await focusApplication(app);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click(); await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for Counter.svelte', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Changes to the Side', exact: true }).click();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    for (const side of ['original', 'modified']) {
      const view = page.locator(`.${side}-in-monaco-diff-editor .view-lines:not([monaco-view-zone])`);
      await expect.poll(() => color(view, 'import type', 'import')).toBe('rgb(207, 34, 46)');
    }
    await theme(page, 'vscode-dark-2026');
    const ordinary = page.locator('.editor-group:not(.focused) .group-editor-host .view-lines');
    await expect.poll(() => color(ordinary, 'Hello comparison', 'Hello comparison')).toBe('rgb(165, 214, 255)');
    const input = page.locator('.modified-in-monaco-diff-editor').getByRole('textbox');
    await input.press('Control+End'); await page.keyboard.insertText('sharedSyntax');
    await expect(ordinary).toContainText('sharedSyntax');
    await input.press('Control+z'); await expect(ordinary).not.toContainText('sharedSyntax');
    await input.press('Control+y'); await expect(ordinary).toContainText('sharedSyntax');
    await page.screenshot({ path: info.outputPath('svelte-split-comparison.png') });
  } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
});
