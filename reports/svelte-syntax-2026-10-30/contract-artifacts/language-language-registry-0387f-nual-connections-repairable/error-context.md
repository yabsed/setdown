# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/language-registry.spec.ts >> the language sidebar searches all discoverable servers, shows language logos and keeps manual connections repairable
- Location: test/e2e/language/language-registry.spec.ts:13:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('region', { name: 'Language Support', exact: true }).locator('[data-group="detected"]').locator('.server')
Expected: 3
Received: 4
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('region', { name: 'Language Support', exact: true }).locator('[data-group="detected"]').locator('.server') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Language Support', exact: true }).locator('[data-group="detected"]').locator('.server')
    2 × locator resolved to 0 elements
      - unexpected value "0"
    11 × locator resolved to 4 elements
       - unexpected value "4"

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
> 30  |     await expect(detected.locator('.server')).toHaveCount(3);
      |                                               ^ Error: expect(locator).toHaveCount(expected) failed
  31  |     await expect(detected.locator('[data-server-id="typescript-language-server"]')).toContainText('Included');
  32  |     await expect(detected.locator('[data-server-id="pyright"]')).toContainText('Pyright');
  33  |     await expect(detected.locator('[data-server-id="notebook-python"]')).toContainText('Notebook Python');
  34  |     await expect(detected.getByRole('img', { name: 'Python logo' })).toHaveCount(2);
  35  |     await detected.locator('[data-server-id="notebook-python"]').click();
  36  |     await expect(panel).toContainText('Analysis and execution share that environment.');
  37  |     await expect(panel.getByRole('button', { name: 'Restart servers in this window' })).toBeVisible();
  38  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  39  |     await expect(available.locator('summary')).toContainText('Available servers');
  40  |     expect(await available.locator('.server').count()).toBeGreaterThan(300);
  41  |     await expect(available).not.toHaveAttribute('open');
  42  |     await panel.getByRole('searchbox').fill('svelte');
  43  |     await expect(available.locator('.server')).toHaveCount(1);
  44  |     await expect(available.locator('.server')).toBeVisible();
  45  |     await expect(available.locator('.server')).toContainText('Not detected');
  46  |     await expect(available.getByRole('img', { name: 'Svelte logo' })).toBeVisible();
  47  |     await available.locator('.server').click();
  48  |     await expect(panel.locator('.state')).toHaveText('Not detected');
  49  |     await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
  50  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  51  |     await panel.getByRole('searchbox').fill('apex-language-server');
  52  |     await expect(panel.locator('.server')).toHaveCount(0); // No discovery metadata: manual-only.
  53  |     await expect(panel).toContainText('No matching servers.');
  54  |     await panel.getByRole('button', { name: 'Add language server', exact: true }).click();
  55  |     await expect(panel.getByLabel('Existing server profile').locator('option[value="apex-language-server"]')).toHaveCount(1);
  56  |     await panel.getByLabel('Connection ID', { exact: true }).fill('manual-fixture');
  57  |     await panel.getByLabel('Name', { exact: true }).fill('Manual Fixture');
  58  |     await panel.getByLabel('LSP language ID').fill('manualfixture');
  59  |     await panel.getByLabel('File extensions').fill('.manualfixture');
  60  |     await application.evaluate(({ dialog }, executable) => {
  61  |       dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [executable] })) as typeof dialog.showOpenDialog;
  62  |     }, executable);
  63  |     await panel.getByRole('button', { name: 'Choose executable and connect…' }).click();
  64  |     // Finding an executable is not evidence that initialization succeeded.
  65  |     await expect(panel.locator('.state')).toHaveText('Detected');
  66  |     await panel.getByRole('button', { name: 'Back to language servers' }).click();
  67  |     await panel.getByRole('searchbox').fill('');
  68  |     await expect(panel.locator('.server-group').filter({ hasText: 'Manual connections' })).toContainText('Manual Fixture');
  69  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  70  |     await editor.press('Control+End'); await editor.pressSequentially('No modal focus trap.');
  71  |     await editor.press('Control+s');
  72  |     await expect.poll(() => readFile(file, 'utf8')).toContain('No modal focus trap.');
  73  |     await rm(executable);
  74  |     await panel.getByRole('button', { name: 'Rescan installed servers' }).click();
  75  |     const missing = panel.locator('.server-group').filter({ hasText: 'Needs attention' });
  76  |     await expect(missing).toContainText('Manual Fixture'); await expect(missing).toContainText('Not detected');
  77  |     await page.screenshot({ path: testInfo.outputPath('language-sidebar.png') });
  78  |     await application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click());
  79  |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  80  |     await page.screenshot({ path: testInfo.outputPath('language-sidebar-dark.png') });
  81  |     await missing.getByRole('button').click();
  82  |     await panel.screenshot({ path: testInfo.outputPath('language-server-details.png') });
  83  |     await expect(panel.getByRole('button', { name: 'Choose executable…', exact: true })).toBeVisible();
  84  |     await panel.getByRole('button', { name: 'Remove connection' }).click();
  85  |     await expect(panel.locator('[data-server-id="manual-fixture"]')).toHaveCount(0);
  86  |     await page.getByRole('button', { name: 'Language Support', exact: true }).click();
  87  |     await expect(panel).toHaveCount(0);
  88  |     await page.getByRole('button', { name: 'Language Support', exact: true }).click();
  89  |     await expect(panel.getByRole('searchbox')).toBeFocused();
  90  |     await panel.getByRole('searchbox').fill('query');
  91  |     await panel.getByRole('searchbox').press('Escape');
  92  |     await expect(panel.getByRole('searchbox')).toHaveValue('');
  93  |     await panel.getByRole('searchbox').press('Escape');
  94  |     await expect(panel).toHaveCount(0);
  95  |     await expect(page.getByRole('button', { name: 'Language Support', exact: true })).toBeFocused();
  96  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  97  | });
  98  | 
  99  | test('installing a server while editing and rescanning connects the current model without replacing healthy sessions', async () => {
  100 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-auto-language-'));
  101 |   const file = path.join(root, 'hello.f90'), log = path.join(root, 'server.jsonl');
  102 |   const executable = path.join(root, '.local/bin/fortls');
  103 |   await writeFile(file, 'program example\nend program example\n');
  104 |   const messages = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  105 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  106 |   const application = await electron.launch({ args: ['.', file], env: { ...env,
  107 |     HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), PATH: '/usr/bin:/bin',
  108 |     CONDA_PREFIX: '', VIRTUAL_ENV: '', CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'),
  109 |     GOBIN: '', PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  110 |   try {
  111 |     const page = await application.firstWindow(); await focusApplication(application);
  112 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'unavailable');
  113 |     await expect(page.locator('.editor-host [role="status"]')).toHaveCount(0);
  114 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  115 |     await editor.press('Control+End'); await editor.pressSequentially('! edited before connection');
  116 |     await mkdir(path.dirname(executable), { recursive: true });
  117 |     await writeFile(executable, `#!${process.execPath}\n
  118 |       const fs = require('node:fs');
  119 |       const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
  120 |       const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method, params, pid:process.pid})+'\\n');
  121 |       const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
  122 |       c.onRequest('initialize', params => {log('initialize',params); return {capabilities:{textDocumentSync:{openClose:true,change:1},hoverProvider:true}}});
  123 |       c.onNotification('textDocument/didOpen', params => log('open',params));
  124 |       c.onNotification('textDocument/didChange', params => log('change',params));
  125 |       c.onRequest('textDocument/hover', () => ({contents:{kind:'plaintext',value:'automatic Fortran server'}}));
  126 |       c.onRequest('shutdown', () => {log('shutdown',null); return null});
  127 |       c.onNotification('exit', () => process.exit(0)); c.listen();
  128 |     `); await chmod(executable, 0o755);
  129 |     await page.getByRole('button', { name: 'Edit', exact: true }).click();
  130 |     await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
```