# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/editor-tools.spec.ts >> editor commands preserve Unicode targets, repeat intent, copy shape, Undo and IME ownership
- Location: test/e2e/workspace/editor-tools.spec.ts:45:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('.editor-surface').getByRole('textbox', { name: 'Editor content' })
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }) with timeout 5000ms
  - waiting for locator('.editor-surface').getByRole('textbox', { name: 'Editor content' })
    13 × locator resolved to <div tabindex="0" role="textbox" autocorrect="off" autocomplete="off" spellcheck="false" autocapitalize="off" aria-required="false" aria-multiline="true" aria-autocomplete="both" class="native-edit-context" aria-label="Editor content" aria-roledescription="editor"></div>
       - unexpected value "hidden"

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "notes.txt ×" [selected]:
          - text: notes.txt
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-tools-e2e-vqbhZI/notes.txt
    - 'button "Language status: Plain Text, Basic editing"': Plain Text · Basic editing
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Markdown source editor":
    - code:
      - textbox "Editor content"
- alert
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  3   | import os from 'node:os';
  4   | import path from 'node:path';
  5   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  6   | import type { MarkTexApi } from '../../../src/protocol/desktop-api';
  7   | async function command(page: Page, title: string) {
  8   |   await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-editor-commands'));
  9   |   const dialog = page.getByRole('dialog', { name: 'Commands', exact: true }); await expect(dialog).toBeVisible();
  10  |   await dialog.getByRole('searchbox').fill(title); await dialog.getByRole('option').filter({ hasText: title }).first().click();
  11  | }
  12  | const apiText = (page: Page) => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getDocument().then(document => document?.text));
  13  | test('smart-search cancel restores the caret; case policy and result snapshots remain independent', async () => {
  14  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-search-tools-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-search-tools-config-'));
  15  |   const file = path.join(root, 'notes.txt'), text = 'origin\n' + 'line\n'.repeat(100) + 'Needle\nneedle\nNeedle\n';
  16  |   await writeFile(file, text);
  17  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  18  |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  19  |   try {
  20  |     const page = await app.firstWindow(); await focusApplication(app);
  21  |     const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await input.press('Control+Home');
  22  |     await command(page, 'Find literal text with smart case');
  23  |     let search = page.getByRole('dialog', { name: 'Smart search', exact: true }); await search.getByRole('textbox').fill('Needle');
  24  |     await search.getByRole('textbox').press('Escape'); await input.pressSequentially('@');
  25  |     await expect.poll(() => apiText(page)).toBe('@' + text); await input.press('Control+z');
  26  |     for (const query of ['Needle', 'needle']) {
  27  |       await command(page, 'Find literal text with smart case'); search = page.getByRole('dialog', { name: 'Smart search', exact: true });
  28  |       await search.getByRole('textbox').fill(query); await search.getByRole('button', { name: 'Apply', exact: true }).click();
  29  |       await command(page, 'Show current result list');
  30  |       const results = page.getByRole('dialog', { name: `Find: ${query}`, exact: true });
  31  |       await expect(results.getByRole('option')).toHaveCount(query === 'Needle' ? 2 : 3);
  32  |       await results.getByRole('searchbox').press('Escape');
  33  |     }
  34  |     await command(page, 'Previous result list');
  35  |     const original = page.getByRole('dialog', { name: 'Find: Needle', exact: true }); await expect(original.getByRole('option')).toHaveCount(2);
  36  |     await original.getByRole('searchbox').press('Escape');
  37  |     await command(page, 'Hide smart-search highlights'); await expect(page.locator('.setdown-search-highlight')).toHaveCount(0);
  38  |     await command(page, 'Next smart-search match');
  39  |     await input.pressSequentially('replaced'); await expect.poll(() => apiText(page)).toContain('replaced');
  40  |     await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe(text);
  41  |     expect(await readFile(file, 'utf8')).toBe(text);
  42  |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  43  | });
  44  | 
  45  | test('editor commands preserve Unicode targets, repeat intent, copy shape, Undo and IME ownership', async () => {
  46  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tools-e2e-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-tools-config-'));
  47  |   const file = path.join(root, 'notes.txt'); await writeFile(file, '"한글 😄"\n009\n020\n');
  48  |   await writeFile(path.join(root, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 3\n');
  49  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  50  |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  51  |   try {
  52  |     const page = await app.firstWindow(); await focusApplication(app);
  53  |     const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
> 54  |     const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await expect(input).toBeVisible();
      |                                                                                                                         ^ Error: expect(locator).toBeVisible() failed
  55  |     await input.press('Control+Home'); await input.press('ArrowRight');
  56  |     await command(page, 'Select inside quoted string'); await input.press('Delete');
  57  |     await expect.poll(() => apiText(page)).toBe('\"\"\n009\n020\n');
  58  |     await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('\"한글 😄\"\n009\n020\n');
  59  |     await command(page, 'Replace a structured target');
  60  |     await page.getByRole('dialog', { name: 'Replace target', exact: true }).getByRole('option', { name: 'quote', exact: true }).click();
  61  |     await page.getByRole('dialog', { name: 'Replacement', exact: true }).getByRole('textbox').fill('교체 😀');
  62  |     await page.getByRole('dialog', { name: 'Replacement', exact: true }).getByRole('button', { name: 'Apply', exact: true }).click();
  63  |     await expect.poll(() => apiText(page)).toBe('"교체 😀"\n009\n020\n');
  64  |     await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n009\n020\n');
  65  |     await input.press('Control+Home'); await input.press('ArrowDown'); await input.press('Home');
  66  |     await command(page, 'Increment integer'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
  67  |     await input.press('ArrowDown'); await input.press('Home'); await command(page, 'Repeat last semantic edit');
  68  |     await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n021\n');
  69  |     await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
  70  |     await input.press('Control+Home'); await input.press('Home'); await input.press('Shift+End'); await input.press('Control+c');
  71  |     await input.press('Delete'); await command(page, 'Paste last explicit copy'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
  72  |     await command(page, 'Show effective settings for this file');
  73  |     const settings = page.getByRole('dialog', { name: 'Effective editor settings' }); await expect(settings).toContainText('Tab width: 3'); await expect(settings).toContainText('.editorconfig');
  74  |     await settings.getByRole('searchbox').press('Escape'); await expect(settings).not.toBeVisible();
  75  |     // A composition event must reach the editor; the application shortcut cannot steal it.
  76  |     await input.focus();
  77  |     await page.evaluate(() => { document.activeElement?.dispatchEvent(new CompositionEvent('compositionstart', { data: 'ㅎ', bubbles: true })); document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, isComposing: true, bubbles: true })); });
  78  |     await expect(page.getByRole('dialog', { name: 'Commands', exact: true })).not.toBeVisible();
  79  |     await page.evaluate(() => document.activeElement?.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true })));
  80  |     await input.press('Control+End'); await input.pressSequentially('end');
  81  |     await input.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toBe('"한글 😄"\n010\n020\nend');
  82  |     expect(failures).toEqual([]);
  83  |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  84  | });
  85  | 
  86  | test('explicit session restore recovers changed-disk text separately and restores independent groups', async () => {
  87  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-session-e2e-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-session-config-'));
  88  |   const file = path.join(root, 'notes.txt'); await writeFile(file, 'saved\n');
  89  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  90  |   let app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  91  |   try {
  92  |     let page = await app.firstWindow(); await focusApplication(app);
  93  |     const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await input.press('Control+End'); await input.pressSequentially('dirty snapshot');
  94  |     await command(page, 'Split editor right'); await expect(page.locator('.editor-group')).toHaveCount(2);
  95  |     await command(page, 'Save workspace snapshot'); const save = page.getByRole('dialog', { name: 'Workspace snapshot', exact: true });
  96  |     await save.getByRole('textbox').fill('Two views'); await save.getByRole('button', { name: 'Apply', exact: true }).click();
  97  |     await expect.poll(() => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.some(entry => entry.name === 'Two views')))).toBe(true);
  98  |     // Simulate process loss without a clean close/discard prompt.
  99  |     await expect.poll(() => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.some(entry => entry.recovery))), { timeout: 12000 }).toBe(true);
  100 |     const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve())); app.process().kill('SIGKILL'); await exited;
  101 |     await writeFile(file, 'external version\n');
  102 |     app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: config } }); page = await app.firstWindow(); await focusApplication(app);
  103 |     await expect(page.locator('.document-tab')).toHaveCount(0);
  104 |     await command(page, 'Restore a workspace or recovery snapshot');
  105 |     await page.getByRole('dialog', { name: 'Workspace snapshots', exact: true }).getByRole('option').filter({ hasText: 'Two views' }).click();
  106 |     await page.getByRole('dialog', { name: 'Restore snapshot into additional groups?' }).getByRole('option', { name: /^Restore/ }).click();
  107 |     const details = page.getByRole('dialog', { name: 'Snapshot restore details' }); await expect(details).toContainText('disk version changed'); await details.getByRole('searchbox').press('Escape');
  108 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  109 |     await expect.poll(() => apiText(page)).toBe('saved\ndirty snapshot'); expect(await readFile(file, 'utf8')).toBe('external version\n');
  110 |     await expect(page.locator('.document-tab .tab-dirty')).toHaveCount(2);
  111 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  112 | });
  113 | 
```