# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/project-environment.spec.ts >> current-file Python environment repairs real imports, preserves unsaved text and Undo, and remains project scoped after reopening
- Location: test/e2e/language/project-environment.spec.ts:21:1

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: locator('.view-lines')
Expected substring: not "unsaved_value"
Received string: "from setdown_environment_fixture import valueresult = valueunsaved_value ="
Timeout: 5000ms

Call log:
  - Expect "not toContainText" locator('.view-lines') with timeout 5000ms
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
  37  |     await page.getByRole('button', { name: /Language status:/ }).click();
  38  |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  39  |     const environment = panel.getByRole('combobox', { name: 'Python environment' });
  40  |     const choice = await environment.locator('option').filter({ hasText: '.venv · Project' }).getAttribute('value');
  41  |     expect(choice).toBeTruthy(); await environment.selectOption(choice!);
  42  |     await expect(page.locator('.squiggly-warning')).toHaveCount(0, { timeout: 20_000 });
  43  |     await expect(panel).toContainText('Results received for this open file');
  44  |     await expect(panel).toContainText(python);
  45  |     await page.screenshot({ path: testInfo.outputPath('python-project-environment.png') });
  46  |     await panel.getByRole('button', { name: 'Close language status' }).click();
  47  |     await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
  48  |     expect(await readFile(file, 'utf8')).toBe(source);
> 49  |     await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('unsaved_value');
      |                                                                                    ^ Error: expect(locator).not.toContainText(expected) failed
  50  |     const saved = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
  51  |     expect(saved.projects[project].python).toBe(python); expect(errors).toEqual([]);
  52  |     await disposeApplication(application); application = await launch(file, config); page = await application.firstWindow();
  53  |     await page.getByRole('button', { name: /Language status:/ }).click();
  54  |     const reopened = page.getByRole('dialog', { name: 'Current file language support' });
  55  |     await expect(reopened).toContainText(python); await expect(reopened).toContainText('Results received for this open file', { timeout: 20_000 });
  56  |     await expect(page.locator('.squiggly-warning')).toHaveCount(0);
  57  |     const otherFile = path.join(root, 'other.py'); await writeFile(otherFile, 'value = 1\n');
  58  |     // IPC cannot change environments for a document not owned by this window.
  59  |     expect(await page.evaluate(async file => { try { await window.marktex.language.environment(file, 'python'); return 'allowed'; } catch { return 'rejected'; } }, otherFile)).toBe('rejected');
  60  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  61  | });
  62  | 
  63  | test('C++ build selection changes the real clangd flags and repairs unsaved source without replacing the editor', async ({}, testInfo) => {
  64  |   test.setTimeout(90_000);
  65  |   const { root, project, config } = await fixture('setdown-project-cpp-');
  66  |   const file = path.join(project, 'main.cpp'), includes = path.join(root, 'headers'); await mkdir(includes);
  67  |   await writeFile(path.join(includes, 'project.hpp'), 'inline int project_value() { return PROJECT_VALUE; }\n');
  68  |   const source = '#include "project.hpp"\nint main() { return project_value(); }\n'; await writeFile(file, source);
  69  |   for (const name of ['build', 'builddir']) {
  70  |     const dir = path.join(project, name); await mkdir(dir);
  71  |     await writeFile(path.join(dir, 'compile_commands.json'), JSON.stringify([{ directory: project, file,
  72  |       arguments: ['clang++', '-std=c++20', ...(name === 'builddir' ? [`-I${includes}`, '-DPROJECT_VALUE=42'] : []), '-c', file] }]));
  73  |   }
  74  |   const application = await launch(file, config);
  75  |   try {
  76  |     const page = await application.firstWindow();
  77  |     await page.getByRole('button', { name: /Language status:/ }).click();
  78  |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  79  |     await expect(panel).toContainText('Several build configurations');
  80  |     const environment = panel.getByRole('combobox', { name: 'C / C++ build configuration' });
  81  |     const wrong = await environment.locator('option').filter({ hasText: /^build ·/ }).getAttribute('value');
  82  |     await environment.selectOption(wrong!);
  83  |     await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 20_000 });
  84  |     await panel.getByRole('button', { name: 'Close language status' }).click();
  85  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  86  |     await editor.press('Control+End'); await page.keyboard.insertText('// unsaved configuration test');
  87  |     await page.getByRole('button', { name: /Language status:/ }).click();
  88  |     const right = await environment.locator('option').filter({ hasText: /^builddir ·/ }).getAttribute('value');
  89  |     await environment.selectOption(right!);
  90  |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  91  |     await expect(panel).toContainText('Results received for this open file');
  92  |     await expect(page.locator('.view-lines')).toContainText('unsaved configuration test');
  93  |     await page.screenshot({ path: testInfo.outputPath('cpp-build-environment.png') });
  94  |     await panel.getByRole('button', { name: 'Close language status' }).click();
  95  |     await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('unsaved configuration test');
  96  |     expect(await readFile(file, 'utf8')).toBe(source);
  97  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  98  | });
  99  | 
  100 | test('TypeScript SDK selection and basic editing apply to this project; service restart retains current source', async ({}, testInfo) => {
  101 |   const { root, project, config } = await fixture('setdown-project-ts-');
  102 |   const file = path.join(project, 'main.ts');
  103 |   await mkdir(path.join(project, 'node_modules'), { recursive: true });
  104 |   await symlink(path.dirname(require.resolve('typescript/package.json')), path.join(project, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir');
  105 |   await writeFile(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  106 |   await writeFile(file, 'const value: number = "wrong";\n');
  107 |   const application = await launch(file, config);
  108 |   try {
  109 |     const page = await application.firstWindow();
  110 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  111 |     await page.getByRole('button', { name: /Language status:/ }).click();
  112 |     const panel = page.getByRole('dialog', { name: 'Current file language support' }), sdk = panel.getByRole('combobox', { name: 'TypeScript SDK' });
  113 |     const projectSdk = await sdk.locator('option').filter({ hasText: 'Project TypeScript' }).getAttribute('value');
  114 |     await sdk.selectOption(projectSdk!);
  115 |     await expect(panel).toContainText(path.join(project, 'node_modules/typescript/lib/tsserver.js'));
  116 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  117 |     await panel.getByRole('button', { name: 'Restart project services' }).click();
  118 |     await expect(panel).toContainText('Results received for this open file', { timeout: 20_000 });
  119 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('off');
  120 |     await expect(page.locator('.squiggly-error')).toHaveCount(0);
  121 |     await expect(page.getByRole('button', { name: /Language status:/ })).toHaveAccessibleName(/Local checks/);
  122 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('typescript-language-server');
  123 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  124 |     await page.screenshot({ path: testInfo.outputPath('typescript-sdk.png') });
  125 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  126 | });
  127 | 
  128 | test('Configure project generates and selects a real CMake database only on the explicit action', async ({}, testInfo) => {
  129 |   test.setTimeout(90_000);
  130 |   const { root, project, config } = await fixture('setdown-project-cmake-');
  131 |   const file = path.join(project, 'main.cpp');
  132 |   await writeFile(file, 'int main() { return CONFIGURED_VALUE; }\n');
  133 |   await writeFile(path.join(project, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(setdown_fixture LANGUAGES CXX)\nadd_executable(setdown_fixture main.cpp)\ntarget_compile_definitions(setdown_fixture PRIVATE CONFIGURED_VALUE=42)\n');
  134 |   const application = await launch(file, config);
  135 |   try {
  136 |     const page = await application.firstWindow();
  137 |     await page.getByRole('button', { name: /Language status:/ }).click();
  138 |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  139 |     await expect(panel).toContainText('Choose a build folder or configure this project');
  140 |     const before = await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8').catch(() => ''); expect(before).toBe('');
  141 |     await panel.getByText('Configure CMake analysis', { exact: true }).click();
  142 |     await panel.getByRole('button', { name: 'Configure project', exact: true }).click();
  143 |     await expect(panel).toContainText('Configuration output', { timeout: 30_000 });
  144 |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  145 |     await expect(panel).toContainText('Results received for this open file');
  146 |     const preferences = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
  147 |     const database = JSON.parse(await readFile(preferences.projects[project].compilation, 'utf8'));
  148 |     expect(JSON.stringify(database)).toContain('CONFIGURED_VALUE=42');
  149 |     expect(preferences.projects[project].compilation.startsWith(config)).toBe(true);
```