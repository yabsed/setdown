# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/language-registry.spec.ts >> the language sidebar searches all discoverable servers, shows language logos and keeps manual connections repairable
- Location: test/e2e/language/language-registry.spec.ts:13:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByRole('region', { name: 'Language Support', exact: true }).locator('.state')
Expected: "Ready"
Received: "Detected"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" getByRole('region', { name: 'Language Support', exact: true }).locator('.state') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Language Support', exact: true }).locator('.state')
    14 × locator resolved to <span data-tone="neutral" class="state status svelte-otnelb">Detected</span>
       - unexpected value "Detected"

```

```yaml
- text: Detected
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
  3   | import { createRequire } from 'node:module';
  4   | import os from 'node:os';
  5   | import path from 'node:path';
  6   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  7   | const require = createRequire(import.meta.url);
  8   | const catalogSize = new Set([
  9   |   ...require('../../../src/main/language/catalog/mason.json').packages,
  10  |   ...require('../../../src/main/language/catalog/profiles.json').profiles,
  11  | ].map((entry: { id: string }) => entry.id)).size;
  12  | 
  13  | test('the language sidebar searches all discoverable servers, shows language logos and keeps manual connections repairable', async ({}, testInfo) => {
  14  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-sidebar-'));
  15  |   const file = path.join(root, 'notes.txt'), executable = path.join(root, 'manual-server');
  16  |   await writeFile(file, 'Keep editing while managing language support.\n');
  17  |   await writeFile(executable, '#!/bin/sh\nexit 0\n'); await chmod(executable, 0o755);
  18  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  19  |   const application = await electron.launch({ args: ['.', file], env: { ...env, HOME: root,
  20  |     XDG_CONFIG_HOME: path.join(root, 'config'), PATH: '', CONDA_PREFIX: '', VIRTUAL_ENV: '',
  21  |     CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'), GOBIN: '',
  22  |     PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  23  |   try {
  24  |     const page = await application.firstWindow(); await focusApplication(application);
  25  |     await page.getByRole('button', { name: 'Edit', exact: true }).click();
  26  |     await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
  27  |     const panel = page.getByRole('region', { name: 'Language Support', exact: true });
  28  |     const detected = panel.locator('[data-group="detected"]');
  29  |     const available = panel.locator('[data-group="available"]');
  30  |     await expect(detected.locator('.server')).toHaveCount(2);
  31  |     await expect(detected.locator('[data-server-id="pyright"]')).toContainText('Pyright');
  32  |     await expect(detected.locator('[data-server-id="notebook-python"]')).toContainText('Notebook Python');
  33  |     await expect(detected.getByRole('img', { name: 'Python logo' })).toHaveCount(2);
  34  |     await detected.locator('[data-server-id="notebook-python"]').click();
  35  |     await expect(panel).toContainText('Analysis and execution share that environment.');
  36  |     await expect(panel.getByRole('button', { name: 'Restart servers in this window' })).toBeVisible();
  37  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  38  |     await expect(available.locator('summary')).toContainText('Available servers');
  39  |     expect(await available.locator('.server').count()).toBeGreaterThan(300);
  40  |     await expect(available).not.toHaveAttribute('open');
  41  |     await panel.getByRole('searchbox').fill('svelte');
  42  |     await expect(available.locator('.server')).toHaveCount(1);
  43  |     await expect(available.locator('.server')).toBeVisible();
  44  |     await expect(available.locator('.server')).toContainText('Not detected');
  45  |     await expect(available.getByRole('img', { name: 'Svelte logo' })).toBeVisible();
  46  |     await available.locator('.server').click();
  47  |     await expect(panel.locator('.state')).toHaveText('Not detected');
  48  |     await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
  49  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  50  |     await panel.getByRole('searchbox').fill('apex-language-server');
  51  |     await expect(panel.locator('.server')).toHaveCount(0); // No discovery metadata: manual-only.
  52  |     await expect(panel).toContainText('No matching servers.');
  53  |     await panel.getByRole('button', { name: 'Add language server', exact: true }).click();
  54  |     await expect(panel.getByLabel('Existing server profile').locator('option[value="apex-language-server"]')).toHaveCount(1);
  55  |     await panel.getByLabel('Connection ID', { exact: true }).fill('manual-fixture');
  56  |     await panel.getByLabel('Name', { exact: true }).fill('Manual Fixture');
  57  |     await panel.getByLabel('LSP language ID').fill('manualfixture');
  58  |     await panel.getByLabel('File extensions').fill('.manualfixture');
  59  |     await application.evaluate(({ dialog }, executable) => {
  60  |       dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [executable] })) as typeof dialog.showOpenDialog;
  61  |     }, executable);
  62  |     await panel.getByRole('button', { name: 'Choose executable and connect…' }).click();
> 63  |     await expect(panel.locator('.state')).toHaveText('Ready');
      |                                           ^ Error: expect(locator).toHaveText(expected) failed
  64  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  65  |     await panel.getByRole('searchbox').fill('');
  66  |     await expect(panel.locator('.server-group').filter({ hasText: 'Manual connections' })).toContainText('Manual Fixture');
  67  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  68  |     await editor.press('Control+End'); await editor.pressSequentially('No modal focus trap.');
  69  |     await editor.press('Control+s');
  70  |     await expect.poll(() => readFile(file, 'utf8')).toContain('No modal focus trap.');
  71  |     await rm(executable);
  72  |     await panel.getByRole('button', { name: 'Rescan installed servers' }).click();
  73  |     const missing = panel.locator('.server-group').filter({ hasText: 'Needs attention' });
  74  |     await expect(missing).toContainText('Manual Fixture'); await expect(missing).toContainText('Not detected');
  75  |     await page.screenshot({ path: testInfo.outputPath('language-sidebar.png') });
  76  |     await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click());
  77  |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  78  |     await page.screenshot({ path: testInfo.outputPath('language-sidebar-dark.png') });
  79  |     await missing.getByRole('button').click();
  80  |     await panel.screenshot({ path: testInfo.outputPath('language-server-details.png') });
  81  |     await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
  82  |     await panel.getByRole('button', { name: 'Remove connection' }).click();
  83  |     await expect(panel.locator('[data-server-id="manual-fixture"]')).toHaveCount(0);
  84  |     await page.getByRole('button', { name: 'Language Support', exact: true }).click();
  85  |     await expect(panel).toHaveCount(0);
  86  |     await page.getByRole('button', { name: 'Language Support', exact: true }).click();
  87  |     await expect(panel.getByRole('searchbox')).toBeFocused();
  88  |     await panel.getByRole('searchbox').fill('query');
  89  |     await panel.getByRole('searchbox').press('Escape');
  90  |     await expect(panel.getByRole('searchbox')).toHaveValue('');
  91  |     await panel.getByRole('searchbox').press('Escape');
  92  |     await expect(panel).toHaveCount(0);
  93  |     await expect(page.getByRole('button', { name: 'Language Support', exact: true })).toBeFocused();
  94  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  95  | });
  96  | 
  97  | test('installing a server while editing and rescanning connects the current model without replacing healthy sessions', async () => {
  98  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auto-language-'));
  99  |   const file = path.join(root, 'hello.f90'), log = path.join(root, 'server.jsonl');
  100 |   const executable = path.join(root, '.local/bin/fortls');
  101 |   await writeFile(file, 'program example\nend program example\n');
  102 |   const messages = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  103 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  104 |   const application = await electron.launch({ args: ['.', file], env: { ...env,
  105 |     HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), PATH: '/usr/bin:/bin',
  106 |     CONDA_PREFIX: '', VIRTUAL_ENV: '', CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'),
  107 |     GOBIN: '', PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  108 |   try {
  109 |     const page = await application.firstWindow(); await focusApplication(application);
  110 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'unavailable');
  111 |     await expect(page.locator('.editor-host [role="status"]')).toHaveCount(0);
  112 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  113 |     await editor.press('Control+End'); await editor.pressSequentially('! edited before connection');
  114 |     await mkdir(path.dirname(executable), { recursive: true });
  115 |     await writeFile(executable, `#!${process.execPath}\n
  116 |       const fs = require('node:fs');
  117 |       const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
  118 |       const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method, params, pid:process.pid})+'\\n');
  119 |       const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
  120 |       c.onRequest('initialize', params => {log('initialize',params); return {capabilities:{textDocumentSync:{openClose:true,change:1},hoverProvider:true}}});
  121 |       c.onNotification('textDocument/didOpen', params => log('open',params));
  122 |       c.onNotification('textDocument/didChange', params => log('change',params));
  123 |       c.onRequest('textDocument/hover', () => ({contents:{kind:'plaintext',value:'automatic Fortran server'}}));
  124 |       c.onRequest('shutdown', () => {log('shutdown',null); return null});
  125 |       c.onNotification('exit', () => process.exit(0)); c.listen();
  126 |     `); await chmod(executable, 0o755);
  127 |     await page.getByRole('button', { name: 'Edit', exact: true }).click();
  128 |     await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
  129 |     const management = page.getByRole('region', { name: 'Language Support', exact: true });
  130 |     await management.getByRole('searchbox').fill('fortls');
  131 |     await expect(management.locator('[data-group="available"] .server')).toContainText('Not detected');
  132 |     await expect(management.getByRole('img', { name: 'Fortran logo' })).toBeVisible();
  133 |     await management.getByRole('button', { name: 'Rescan installed servers' }).click();
  134 |     await management.locator('.server-list button').click();
  135 |     await expect(management.locator('.state')).toHaveText('Running');
  136 |     await expect(management.locator('.details code').first()).toHaveText(executable);
  137 |     await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
  138 |     expect((await messages()).find(m => m.method === 'open').params.textDocument.text).toContain('! edited before connection');
  139 |     const originalPid = (await messages())[0].pid;
  140 |     await management.getByRole('button', { name: 'Rescan installed servers' }).click();
  141 |     await expect(management.getByRole('button', { name: 'Rescan installed servers' })).toBeEnabled();
  142 |     await management.getByRole('button', { name: 'Back to language servers' }).click();
  143 |     await management.getByRole('searchbox').fill('pyright'); await management.locator('[data-server-id="pyright"]').click();
  144 |     await management.getByRole('button', { name: 'Disable', exact: true }).click();
  145 |     await expect(management.locator('.state')).toHaveText('Disabled');
  146 |     await management.getByRole('button', { name: 'Close language support' }).click();
  147 |     await editor.press('Control+End'); await editor.pressSequentially('! still connected');
  148 |     await expect.poll(async () => (await messages()).filter(m => m.method === 'change').length).toBeGreaterThan(0);
  149 |     expect(new Set((await messages()).map(m => m.pid))).toEqual(new Set([originalPid]));
  150 |     expect((await messages()).filter(m => m.method === 'initialize')).toHaveLength(1);
  151 |     expect((await messages()).filter(m => m.method === 'shutdown')).toHaveLength(0);
  152 |     await editor.press('Control+z'); await editor.press('Control+s');
  153 |     await expect.poll(() => readFile(file, 'utf8')).toContain('! edited before connection');
  154 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  155 | });
  156 | 
  157 | test('Edit menu imports a new server, negotiates Full sync, and reconnects the same unsaved model with Undo intact', async ({}, testInfo) => {
  158 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-custom-language-'));
  159 |   const file = path.join(root, 'main.custom'), log = path.join(root, 'messages.jsonl');
  160 |   const server = path.join(root, 'server.cjs'), definition = path.join(root, 'connection.json');
  161 |   await writeFile(file, 'bad\n'); await writeFile(path.join(root, 'custom.project'), '');
  162 |   await writeFile(server, `
  163 |     const fs = require('node:fs');
```