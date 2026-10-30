# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/project-environment.spec.ts >> current-file Python environment repairs real imports, preserves unsaved text and Undo, and remains project scoped after reopening
- Location: test/e2e/language/project-environment.spec.ts:21:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.view-lines')
Timeout: 5000ms
- Expected  - 3
+ Received  + 1

- from setdown_environment_fixture import value
- result = value
- unsaved_value =
+ from setdown_environment_fixture import valueresult = valueunsaved_value =

Call log:
  - Expect "toHaveText" locator('.view-lines') with timeout 5000ms
  - waiting for locator('.view-lines')
    14 × locator resolved to <div data-mprt="8" aria-hidden="true" role="presentation" class="view-lines monaco-mouse-cursor-text">…</div>
       - unexpected value "from setdown_environment_fixture import valueresult = valueunsaved_value ="

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { execFile } from 'node:child_process';
  3   | import { promisify } from 'node:util';
  4   | import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
  5   | import { createRequire } from 'node:module';
  6   | import os from 'node:os';
  7   | import path from 'node:path';
  8   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  9   | const require = createRequire(import.meta.url), execute = promisify(execFile);
  10  | async function fixture(prefix: string) {
  11  |   const root = await mkdtemp(path.join(os.tmpdir(), prefix)), project = path.join(root, 'project'), config = path.join(root, 'config');
  12  |   await mkdir(path.join(project, '.git'), { recursive: true });
  13  |   return { root, project, config };
  14  | }
  15  | async function launch(file: string, config: string) {
  16  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  17  |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  18  |   await focusApplication(application); return application;
  19  | }
  20  | 
  21  | test('current-file Python environment repairs real imports, preserves unsaved text and Undo, and remains project scoped after reopening', async ({}, testInfo) => {
  22  |   test.setTimeout(90_000);
  23  |   const { root, project, config } = await fixture('setdown-project-python-');
  24  |   const venv = path.join(project, '.venv'), file = path.join(project, 'main.py');
  25  |   await execute(process.env.SETDOWN_PYTHON_PATH || 'python3', ['-m', 'venv', '--without-pip', venv]);
  26  |   const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  27  |   const site = (await execute(python, ['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'])).stdout.trim();
  28  |   await writeFile(path.join(site, 'setdown_environment_fixture.py'), 'value: int = 42\n');
  29  |   await writeFile(path.join(project, 'pyproject.toml'), '[project]\nname = "environment-fixture"\nversion = "0.0.0"\n');
  30  |   const source = 'from setdown_environment_fixture import value\nresult = value\n'; await writeFile(file, source);
  31  |   let application = await launch(file, config);
  32  |   try {
  33  |     let page = await application.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  34  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  35  |     await expect(page.locator('.squiggly-warning')).toHaveCount(1, { timeout: 20_000 });
  36  |     await editor.press('Control+End'); await page.keyboard.insertText('unsaved_value = 73');
  37  |     // Compare the real editor's Undo boundary across reconnection; language input
  38  |     // may split a paste into more than one operation. Redo must survive as well.
  39  |     await editor.press('Control+z'); const undoText = await page.locator('.view-lines').innerText();
  40  |     expect(undoText).not.toContain('73'); await editor.press('Control+Shift+z');
  41  |     await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
  42  |     await page.getByRole('button', { name: /Language status:/ }).click();
  43  |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  44  |     const environment = panel.getByRole('combobox', { name: 'Python environment' });
  45  |     const choice = await environment.locator('option').filter({ hasText: '.venv · Project' }).getAttribute('value');
  46  |     expect(choice).toBeTruthy(); await environment.selectOption(choice!);
  47  |     await expect(page.locator('.squiggly-warning')).toHaveCount(0, { timeout: 20_000 });
  48  |     await expect(panel).toContainText('Results received for this open file');
  49  |     await expect(panel).toContainText(python);
  50  |     await page.screenshot({ path: testInfo.outputPath('python-project-environment.png') });
  51  |     await panel.getByRole('button', { name: 'Close language status' }).click();
  52  |     await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
  53  |     expect(await readFile(file, 'utf8')).toBe(source);
> 54  |     await editor.press('Control+z'); await expect(page.locator('.view-lines')).toHaveText(undoText);
      |                                                                                ^ Error: expect(locator).toHaveText(expected) failed
  55  |     await editor.press('Control+Shift+z'); await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
  56  |     const saved = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
  57  |     expect(saved.projects[project].python).toBe(python); expect(errors).toEqual([]);
  58  |     await disposeApplication(application); application = await launch(file, config); page = await application.firstWindow();
  59  |     await page.getByRole('button', { name: /Language status:/ }).click();
  60  |     const reopened = page.getByRole('dialog', { name: 'Current file language support' });
  61  |     await expect(reopened).toContainText(python); await expect(reopened).toContainText('Results received for this open file', { timeout: 20_000 });
  62  |     await expect(page.locator('.squiggly-warning')).toHaveCount(0);
  63  |     const otherFile = path.join(root, 'other.py'); await writeFile(otherFile, 'value = 1\n');
  64  |     // IPC cannot change environments for a document not owned by this window.
  65  |     expect(await page.evaluate(async file => { try { await window.marktex.language.environment(file, 'python'); return 'allowed'; } catch { return 'rejected'; } }, otherFile)).toBe('rejected');
  66  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  67  | });
  68  | 
  69  | test('C++ build selection changes the real clangd flags and repairs unsaved source without replacing the editor', async ({}, testInfo) => {
  70  |   test.setTimeout(90_000);
  71  |   const { root, project, config } = await fixture('setdown-project-cpp-');
  72  |   const file = path.join(project, 'main.cpp'), includes = path.join(root, 'headers'); await mkdir(includes);
  73  |   await writeFile(path.join(includes, 'project.hpp'), 'inline int project_value() { return PROJECT_VALUE; }\n');
  74  |   const source = '#include "project.hpp"\nint main() { return project_value(); }\n'; await writeFile(file, source);
  75  |   for (const name of ['build', 'builddir']) {
  76  |     const dir = path.join(project, name); await mkdir(dir);
  77  |     await writeFile(path.join(dir, 'compile_commands.json'), JSON.stringify([{ directory: project, file,
  78  |       arguments: ['clang++', '-std=c++20', ...(name === 'builddir' ? [`-I${includes}`, '-DPROJECT_VALUE=42'] : []), '-c', file] }]));
  79  |   }
  80  |   const application = await launch(file, config);
  81  |   try {
  82  |     const page = await application.firstWindow();
  83  |     await page.getByRole('button', { name: /Language status:/ }).click();
  84  |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  85  |     await expect(panel).toContainText('Several build configurations');
  86  |     const environment = panel.getByRole('combobox', { name: 'C / C++ build configuration' });
  87  |     const wrong = await environment.locator('option').filter({ hasText: /^build ·/ }).getAttribute('value');
  88  |     await environment.selectOption(wrong!);
  89  |     await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 20_000 });
  90  |     await panel.getByRole('button', { name: 'Close language status' }).click();
  91  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  92  |     await editor.press('Control+End'); await page.keyboard.insertText('// unsaved configuration test');
  93  |     await page.getByRole('button', { name: /Language status:/ }).click();
  94  |     const right = await environment.locator('option').filter({ hasText: /^builddir ·/ }).getAttribute('value');
  95  |     await environment.selectOption(right!);
  96  |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  97  |     await expect(panel).toContainText('Results received for this open file');
  98  |     await expect(page.locator('.view-lines')).toContainText('unsaved configuration test');
  99  |     await page.screenshot({ path: testInfo.outputPath('cpp-build-environment.png') });
  100 |     await panel.getByRole('button', { name: 'Close language status' }).click();
  101 |     await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('unsaved configuration test');
  102 |     expect(await readFile(file, 'utf8')).toBe(source);
  103 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  104 | });
  105 | 
  106 | test('TypeScript SDK selection and basic editing apply to this project; service restart retains current source', async ({}, testInfo) => {
  107 |   const { root, project, config } = await fixture('setdown-project-ts-');
  108 |   const file = path.join(project, 'main.ts');
  109 |   await mkdir(path.join(project, 'node_modules'), { recursive: true });
  110 |   await symlink(path.dirname(require.resolve('typescript/package.json')), path.join(project, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir');
  111 |   await writeFile(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  112 |   await writeFile(file, 'const value: number = "wrong";\n');
  113 |   const application = await launch(file, config);
  114 |   try {
  115 |     const page = await application.firstWindow();
  116 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  117 |     await page.getByRole('button', { name: /Language status:/ }).click();
  118 |     const panel = page.getByRole('dialog', { name: 'Current file language support' }), sdk = panel.getByRole('combobox', { name: 'TypeScript SDK' });
  119 |     const projectSdk = await sdk.locator('option').filter({ hasText: 'Project TypeScript' }).getAttribute('value');
  120 |     await sdk.selectOption(projectSdk!);
  121 |     await expect(panel).toContainText(path.join(project, 'node_modules/typescript/lib/tsserver.js'));
  122 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  123 |     await panel.getByRole('button', { name: 'Restart project services' }).click();
  124 |     await expect(panel).toContainText('Results received for this open file', { timeout: 20_000 });
  125 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('off');
  126 |     await expect(page.locator('.squiggly-error')).toHaveCount(0);
  127 |     await expect(page.getByRole('button', { name: /Language status:/ })).toHaveAccessibleName(/Local checks/);
  128 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('typescript-language-server');
  129 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  130 |     await page.screenshot({ path: testInfo.outputPath('typescript-sdk.png') });
  131 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  132 | });
  133 | 
  134 | test('Configure project generates and selects a real CMake database only on the explicit action', async ({}, testInfo) => {
  135 |   test.setTimeout(90_000);
  136 |   const { root, project, config } = await fixture('setdown-project-cmake-');
  137 |   const file = path.join(project, 'main.cpp');
  138 |   await writeFile(file, 'int main() { return CONFIGURED_VALUE; }\n');
  139 |   await writeFile(path.join(project, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(setdown_fixture LANGUAGES CXX)\nadd_executable(setdown_fixture main.cpp)\ntarget_compile_definitions(setdown_fixture PRIVATE CONFIGURED_VALUE=42)\n');
  140 |   const application = await launch(file, config);
  141 |   try {
  142 |     const page = await application.firstWindow();
  143 |     await page.getByRole('button', { name: /Language status:/ }).click();
  144 |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  145 |     await expect(panel).toContainText('Choose a build folder or configure this project');
  146 |     const before = await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8').catch(() => ''); expect(before).toBe('');
  147 |     await panel.getByText('Configure CMake analysis', { exact: true }).click();
  148 |     await panel.getByRole('button', { name: 'Configure project', exact: true }).click();
  149 |     await expect(panel).toContainText('Configuration output', { timeout: 30_000 });
  150 |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  151 |     await expect(panel).toContainText('Results received for this open file');
  152 |     const preferences = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
  153 |     const database = JSON.parse(await readFile(preferences.projects[project].compilation, 'utf8'));
  154 |     expect(JSON.stringify(database)).toContain('CONFIGURED_VALUE=42');
```