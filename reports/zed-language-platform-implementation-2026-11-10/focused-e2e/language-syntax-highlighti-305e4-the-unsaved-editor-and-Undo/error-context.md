# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/syntax-highlighting.spec.ts >> an open project inherits .zed YAML settings into infra files and hot reload preserves the unsaved editor and Undo
- Location: test/e2e/language/syntax-highlighting.spec.ts:62:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

- Expected  - 1
+ Received  + 1

  name: !Sub "hello"
-
+ # unsaved

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  2   | import { execFile } from 'node:child_process';
  3   | import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  4   | import { createRequire } from 'node:module';
  5   | import os from 'node:os';
  6   | import path from 'node:path';
  7   | import { pathToFileURL } from 'node:url';
  8   | import { promisify } from 'node:util';
  9   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  10  | 
  11  | const require = createRequire(import.meta.url), exec = promisify(execFile);
  12  | const component = `<script lang="ts">
  13  | import type { Color } from './types';
  14  | let painted = $state(2);
  15  | const title = "Hello Svelte";
  16  | // A syntax comment
  17  | </script>
  18  | {#if painted > 0}
  19  | <button class="counter" onclick={() => painted++}>{title}</button>
  20  | {/if}
  21  | {#each [1, 2] as item}
  22  | <span>{item}</span>
  23  | {/each}
  24  | <style>
  25  | button { color: red; margin: 2px; }
  26  | </style>
  27  | `;
  28  | async function fixture() {
  29  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-syntax-'));
  30  |   const config = path.join(root, 'config'), settings = path.join(config, 'Setdown'), file = path.join(root, 'Counter.svelte');
  31  |   await mkdir(settings, { recursive: true }); await writeFile(file, component);
  32  |   const profiles = [...JSON.parse(await readFile(path.resolve('src/main/language/catalog/profiles.json'), 'utf8')).profiles,
  33  |     ...JSON.parse(await readFile(path.resolve('src/main/language/catalog/zed-profiles.json'), 'utf8')).profiles] as { id: string }[];
  34  |   const servers = Object.fromEntries(profiles.map(profile => [profile.id, { enabled: false }]));
  35  |   await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers, preferred: {}, custom: [] }));
  36  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  37  |   return { root, settings, file, servers, launch: (initial = file) => electron.launch({ args: ['.', initial], env: { ...env, XDG_CONFIG_HOME: config } }) };
  38  | }
  39  | async function open(page: Page, file: string) {
  40  |   await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  41  |   await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
  42  | }
  43  | async function theme(page: Page, name: string) {
  44  |   await page.evaluate(name => window.marktex.executeApplicationMenuItem(`preview-theme-${name}`), name);
  45  |   await expect(page.locator('html')).toHaveAttribute('data-theme', name);
  46  | }
  47  | function color(view: Locator, line: string, word: string) {
  48  |   return view.evaluate((root, { line, word }) => {
  49  |     const normalize = (text: string) => text.replace(/\u00a0/g, ' ');
  50  |     const row = [...root.querySelectorAll('.view-line')].find(row => normalize(row.textContent ?? '').includes(line));
  51  |     if (!row) return null;
  52  |     const offset = normalize(row.textContent ?? '').indexOf(word); let start = 0;
  53  |     for (const span of row.querySelectorAll(':scope > span > span')) {
  54  |       const end = start + (span.textContent?.length ?? 0);
  55  |       if (start <= offset && offset < end) return getComputedStyle(span).color;
  56  |       start = end;
  57  |     }
  58  |     return null;
  59  |   }, { line, word });
  60  | }
  61  | 
  62  | test('an open project inherits .zed YAML settings into infra files and hot reload preserves the unsaved editor and Undo', async () => {
  63  |   const f = await fixture(), file = path.join(f.root, 'infra/backend/template.yaml');
  64  |   const config = path.join(f.root, '.zed/settings.json'), server = path.join(f.root, 'yaml-fixture.cjs'), log = path.join(f.root, 'yaml.jsonl');
  65  |   await mkdir(path.dirname(file), { recursive: true }); await mkdir(path.dirname(config));
  66  |   await writeFile(file, 'name: !Sub "hello"\n');
  67  |   const configure = (tags: string[]) => writeFile(config, JSON.stringify({ lsp: { 'yaml-language-server': { settings: { yaml: { customTags: tags } } } } }));
  68  |   await configure(['!Sub scalar', '!Sub sequence']);
  69  |   await writeFile(server, `
  70  |     const fs=require('node:fs');
  71  |     const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
  72  |     const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
  73  |     const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,method,params})+'\\n');
  74  |     c.onRequest('initialize',p=>{log('initialize',p);return {capabilities:{textDocumentSync:{openClose:true,change:1}}};});
  75  |     c.onNotification('initialized',async()=>log('settings',await c.sendRequest('workspace/configuration',{items:[{section:'yaml'}]})));
  76  |     c.onNotification('textDocument/didOpen',p=>log('open',p));c.onNotification('textDocument/didChange',p=>log('change',p));
  77  |     c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  78  |   `);
  79  |   await writeFile(path.join(f.settings, 'language-servers.json'), JSON.stringify({ version: 1, preferred: { yaml: 'yaml-language-server' },
  80  |     servers: { ...f.servers, 'yaml-language-server': { enabled: true } }, custom: [{ id: 'yaml-language-server', name: 'YAML settings fixture',
  81  |       launch: { kind: 'native', command: process.execPath, args: [server] }, languages: [{ languageId: 'yaml', monacoId: 'yaml', extensions: ['.yaml'] }],
  82  |       rootMarkers: [], settings: {} }] }));
  83  |   const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  84  |   const app = await f.launch();
  85  |   try {
  86  |     const page = await app.firstWindow(); await focusApplication(app);
  87  |     await app.evaluate(({ dialog }, folder) => {
  88  |       dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  89  |     }, f.root);
  90  |     await page.evaluate(() => window.marktex.chooseProjectFolder());
  91  |     expect(await page.evaluate(() => window.marktex.getProjectFolder())).toMatchObject({ path: f.root });
  92  |     await open(page, file);
  93  |     await expect.poll(async () => (await messages()).find(m => m.method === 'settings')?.params).toEqual([{ customTags: ['!Sub scalar', '!Sub sequence'] }]);
  94  |     expect((await messages()).find(m => m.method === 'initialize').params.rootUri).toBe(pathToFileURL(f.root).href);
  95  |     const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  96  |     await input.press('Control+End'); await input.pressSequentially('# unsaved revision');
  97  |     await expect.poll(async () => (await messages()).filter(m => m.method === 'change').at(-1)?.params.contentChanges[0].text).toContain('# unsaved revision');
  98  |     await configure(['!Sub scalar', '!Sub sequence', '!Ref scalar']);
  99  |     await expect.poll(async () => (await messages()).filter(m => m.method === 'settings').at(-1)?.params).toEqual([{ customTags: ['!Sub scalar', '!Sub sequence', '!Ref scalar'] }]);
  100 |     await expect.poll(async () => (await messages()).filter(m => m.method === 'open').at(-1)?.params.textDocument.text).toContain('# unsaved revision');
  101 |     await expect(input).toBeFocused(); await input.press('Control+z'); await input.press('Control+s');
> 102 |     await expect.poll(() => readFile(file, 'utf8')).toBe('name: !Sub "hello"\n');
      |                                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  103 |   } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
  104 | });
  105 | 
  106 | test('build languages and YAML dialects retain grammar, comments and Make recipe tabs with every server disabled',async({},info)=>{
  107 |   const f=await fixture();
  108 |   const samples=[
  109 |     ['Makefile','# syntax marker\nall:\n'],['CMakeLists.txt','# syntax marker\nproject(example)\n'],
  110 |     ['Justfile','# syntax marker\nhello:\n    echo "hello"\n'],['main.f90','! syntax marker\nprogram example\nend program\n'],
  111 |     ['plain.yaml','# syntax marker\nname: example\n'],['compose.yaml','# syntax marker\nservices: {}\n'],
  112 |     ['.github/workflows/build.yml','# syntax marker\nname: Build\non: push\njobs: {}\n'],
  113 |     ['.gitlab-ci.yml','# syntax marker\nstages: [test]\n'],
  114 |   ];
  115 |   for(const [name,text] of samples){const file=path.join(f.root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);}
  116 |   const app=await f.launch(path.join(f.root,'Makefile'));
  117 |   try{
  118 |     const page=await app.firstWindow();await focusApplication(app);
  119 |     const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  120 |     const view=page.locator('.editor-surface .view-lines');
  121 |     for(const [name] of samples){await open(page,path.join(f.root,name));await expect.poll(()=>color(view,'syntax marker','marker'),{message:`${name} comment grammar`}).toBe('rgb(110, 119, 129)');}
  122 |     await open(page,path.join(f.root,'Makefile'));
  123 |     const input=page.locator('.editor-surface').getByRole('textbox',{name:'Editor content'});
  124 |     await input.press('Control+End');await input.press('Tab');await input.pressSequentially('@echo ready');await input.press('Control+s');
  125 |     await expect.poll(()=>readFile(path.join(f.root,'Makefile'),'utf8')).toBe('# syntax marker\nall:\n\t@echo ready');
  126 |     await input.press('Control+z');await expect(input).toBeFocused();
  127 |     expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('make-and-language-packages.png')});
  128 |   }finally{await disposeApplication(app);await rm(f.root,{recursive:true,force:true});}
  129 | });
  130 | 
  131 | test('a language absent from the application gets real WASM syntax from its runtime package with no server or network', async ({}, info) => {
  132 |   const f = await fixture(), id = 'setdown-future-fixture', file = path.join(f.root, 'new.future-fixture');
  133 |   const directory = path.join(f.settings, 'language-packages'), extension = path.join(directory, 'extensions', id);
  134 |   await mkdir(path.join(extension, 'grammars'), { recursive: true });
  135 |   await mkdir(path.join(extension, 'languages/future'), { recursive: true });
  136 |   await copyFile(path.resolve('test/fixtures/language-package/make.wasm'), path.join(extension, 'grammars/make.wasm'));
  137 |   await writeFile(path.join(extension, 'extension.toml'), `id="${id}"\nname="Future fixture"\nversion="1.0.0"\nschema_version=1\n[grammars.make]\nrepository="https://example.invalid/grammar"\nrev="fixture"\n`);
  138 |   await writeFile(path.join(extension, 'languages/future/config.toml'), 'name="Future Fixture"\ngrammar="make"\npath_suffixes=["future-fixture"]\n');
  139 |   await writeFile(path.join(extension, 'languages/future/highlights.scm'), '(comment) @comment\n');
  140 |   await writeFile(path.join(extension, '.setdown-package'), JSON.stringify({ version: '1.0.0', sha256: '1'.repeat(64) }));
  141 |   await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ version: 1, checked: Date.now(), packages: [{ id, version: '1.0.0', sha256: '1'.repeat(64),
  142 |     url: 'https://example.invalid/package', profiles: [], bindings: [], languages: [{ id, sourceId: id, name: id, label: 'Future Fixture',
  143 |       extensions: ['.future-fixture'], filenames: [], filenamePatterns: [], shebangs: [], lineComment: '#',
  144 |       treeSitter: { extension: id, config: 'languages/future/config.toml' } }] }] }));
  145 |   await writeFile(file, '# héllo 😀 syntax marker\nall:\n');
  146 |   const app = await f.launch(file);
  147 |   try {
  148 |     const page = await app.firstWindow(); await focusApplication(app);
  149 |     const view = page.locator('.editor-surface .view-lines');
  150 |     await expect.poll(() => color(view, 'syntax marker', 'marker'), { timeout: 15000 }).toBe('rgb(110, 119, 129)');
  151 |     const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  152 |     await input.press('Control+End'); await input.pressSequentially('# newest marker');
  153 |     await expect.poll(() => color(view, 'newest marker', 'marker')).toBe('rgb(110, 119, 129)');
  154 |     await input.press('Control+z'); await expect(input).toBeFocused();
  155 |     await page.screenshot({ path: info.outputPath('runtime-wasm-language.png') });
  156 |   } finally { await disposeApplication(app); await rm(f.root, { recursive: true, force: true }); }
  157 | });
  158 | 
  159 | test('Svelte has lazy local grammar colors without servers; Python, theme changes and Undo keep working', async ({}, info) => {
  160 |   const f = await fixture(), markdown = path.join(f.root, 'notes.md'), python = path.join(f.root, 'colors.py');
  161 |   await writeFile(markdown, '# Notes\n\nA normal reader.\n'); await writeFile(python, 'def hello():\n    return "hello"\n');
  162 |   const app = await f.launch(markdown);
  163 |   try {
  164 |     const page = await app.firstWindow(); await focusApplication(app);
  165 |     const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  166 |     // Chromium omits file:// module requests from Resource Timing. Debugger
  167 |     // scriptParsed replays already-loaded scripts as well as future imports.
  168 |     const scripts = new Set<string>(), cdp = await page.context().newCDPSession(page);
  169 |     cdp.on('Debugger.scriptParsed', event => scripts.add(event.url)); await cdp.send('Debugger.enable');
  170 |     const loaded = () => [...scripts].filter(name => /\/(textmate-runtime|svelte|wasm-inlined)-/.test(name));
  171 |     await expect(page.getByRole('button', { name: 'Switch to Editor' })).toBeVisible();
  172 |     expect(await loaded()).toEqual([]);
  173 |     await open(page, python);
  174 |     const view = page.locator('.editor-surface .view-lines'), input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  175 |     await expect.poll(() => color(view, 'def hello', 'def')).toBe('rgb(207, 34, 46)');
  176 |     const pythonColor = await color(view, 'return', '"hello"'); expect(await loaded()).toEqual([]);
  177 |     await open(page, f.file);
  178 |     await expect.poll(() => color(view, 'import type', 'import')).toBe('rgb(207, 34, 46)');
  179 |     await expect.poll(() => color(view, 'import type', './types')).toBe('rgb(10, 48, 105)');
  180 |     await expect.poll(() => color(view, 'A syntax comment', 'comment')).toBe('rgb(110, 119, 129)');
  181 |     await expect.poll(() => color(view, 'let painted', '2')).toBe('rgb(5, 80, 174)');
  182 |     await expect.poll(() => color(view, '#if', 'if')).toBe('rgb(207, 34, 46)');
  183 |     await expect.poll(() => color(view, '#each', 'each')).toBe('rgb(207, 34, 46)');
  184 |     await expect.poll(() => color(view, '<button', 'button')).toBe('rgb(130, 80, 223)');
  185 |     await expect.poll(() => color(view, '<button', 'class')).toBe('rgb(17, 99, 41)');
  186 |     await expect.poll(() => color(view, 'margin:', '2')).toBe('rgb(5, 80, 174)');
  187 |     expect((await loaded()).some(name => name.includes('/textmate-runtime-'))).toBe(true);
  188 |     expect((await loaded()).some(name => name.includes('/svelte-'))).toBe(true);
  189 |     await expect(page.locator('.squiggly-error')).toHaveCount(0);
  190 |     await page.screenshot({ path: info.outputPath('svelte-light-no-server.png') });
  191 |     await input.press('Control+End'); await page.keyboard.insertText('keepUndo');
  192 |     const identity = await page.locator('.editor-surface .monaco-editor').elementHandle();
  193 |     for (const id of ['github-dark', 'vscode-dark-2026', 'github-dark-high-contrast', 'night-owl', 'dracula',
  194 |       'github-light-high-contrast', 'github-light']) {
  195 |       await theme(page, id);
  196 |       await expect.poll(() => color(view, 'import type', 'import')).not.toBe(await color(view, 'Hello Svelte', 'Hello Svelte'));
  197 |       expect(await identity!.evaluate(node => node === document.querySelector('.editor-surface .monaco-editor'))).toBe(true);
  198 |       await expect(view).toContainText('keepUndo');
  199 |       await page.screenshot({ path: info.outputPath(`svelte-${id}.png`) });
  200 |     }
  201 |     await input.press('Control+z'); await expect(view).not.toContainText('keepUndo');
  202 |     await input.press('Control+y'); await expect(view).toContainText('keepUndo');
```