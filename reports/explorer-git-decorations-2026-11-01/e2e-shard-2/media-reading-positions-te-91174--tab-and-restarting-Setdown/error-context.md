# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media/reading-positions.spec.ts >> text cursor and scroll survive closing the tab and restarting Setdown
- Location: test/e2e/media/reading-positions.spec.ts:71:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByRole('textbox', { name: 'Editor content' })
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" getByRole('textbox', { name: 'Editor content' }) with timeout 5000ms
  - waiting for getByRole('textbox', { name: 'Editor content' })
    14 × locator resolved to <div tabindex="0" role="textbox" autocorrect="off" autocomplete="off" spellcheck="false" autocapitalize="off" aria-required="false" aria-multiline="true" aria-autocomplete="both" class="native-edit-context" aria-label="Editor content" aria-roledescription="editor"></div>
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
        - tab "reading.txt ×" [selected]:
          - text: reading.txt
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - button "Reload file": ↻
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-text-position-wdk5zf/reading.txt
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
  1   | import { electron } from '../../support/electron/electron-app';
  2   | import { expect, test, type Page } from '@playwright/test';
  3   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  4   | import os from 'node:os';
  5   | import path from 'node:path';
  6   | import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
  7   | import { pdfFixture } from '../../support/media/pdf-fixture';
  8   | import { previews } from '../../support/preview/preview-view';
  9   | 
  10  | const launch = async (file: string, config: string) => {
  11  |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  12  |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  13  |   await focusApplication(app);
  14  |   return app;
  15  | };
  16  | async function snapshotOnFailure(page: Page) {
  17  |   await page.screenshot({ path: test.info().outputPath('reading.png') }).catch(() => {});
  18  |   await test.info().attach('dom', { body: await page.locator('body').innerText().catch(() => ''), contentType: 'text/plain' });
  19  | }
  20  | 
  21  | test('PDF reader restores document zoom and page coordinates across restart, and supports search and outline', async () => {
  22  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-'));
  23  |   const file = path.join(root, 'reading.pdf');
  24  |   const config = path.join(root, 'config');
  25  |   await writeFile(file, pdfFixture());
  26  |   let app = await launch(file, config);
  27  |   let page = await app.firstWindow();
  28  |   try {
  29  |     const pdf = () => page.getByRole('region', { name: 'PDF reader', exact: true });
  30  |     await expect(pdf()).toHaveAttribute('data-pdf-pages', '12');
  31  |     await expect(pdf().locator('canvas').first()).toBeVisible();
  32  |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'pdf');
  33  |     expect(await previews(app).count()).toBe(0);
  34  |     await page.getByRole('button', { name: 'PDF outline', exact: true }).click();
  35  |     await page.getByRole('button', { name: 'Chapter Five', exact: true }).click();
  36  |     await expect(pdf()).toHaveAttribute('data-pdf-page', '5');
  37  |     await page.getByRole('button', { name: 'PDF outline', exact: true }).click();
  38  |     await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('1.5');
  39  |     await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('7');
  40  |     await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
  41  |     await expect(pdf()).toHaveAttribute('data-pdf-page', '7');
  42  |     const scroll = () => page.getByRole('document', { name: 'PDF pages' });
  43  |     await scroll().evaluate((node) => { node.scrollTop += 220; });
  44  |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'pdf', page: 7, zoom: 1.5 });
  45  |     const position = await page.evaluate(async () => (await window.marktex.reloadDocument())!.readingPosition);
  46  |     await page.getByRole('button', { name: 'Rotate PDF' }).click();
  47  |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ rotation: 90 });
  48  |     // Return to original rotation to make coordinate comparison straightforward.
  49  |     for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Rotate PDF' }).click();
  50  |     await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('7');
  51  |     await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
  52  |     await scroll().evaluate((node) => { node.scrollTop += 170; });
  53  |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ page: 7, rotation: 0 });
  54  |     expect(position?.kind).toBe('pdf');
  55  |     const history = await app.evaluate(({ app }) => app.getPath('userData') + '/reading-positions.json');
  56  |     await app.close(); // User-like quit, including renderer's final history flush.
  57  |     const saved = JSON.parse(await readFile(history, 'utf8')).records.find((record: { path: string }) => record.path === file).position;
  58  |     app = await launch(file, config); page = await app.firstWindow();
  59  |     await expect(pdf()).toHaveAttribute('data-pdf-page', '7');
  60  |     await expect(page.getByRole('combobox', { name: 'PDF zoom' })).toHaveValue('1.5');
  61  |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject(saved!);
  62  |     await page.getByRole('searchbox', { name: 'Find in PDF' }).fill('searchable');
  63  |     await expect(page.locator('.pdf-matches')).toContainText('/ 300');
  64  |     await page.keyboard.press('Control+S');
  65  |     expect(await readFile(file)).toEqual(pdfFixture());
  66  |     await snapshotOnFailure(page);
  67  |   } catch (error) { await snapshotOnFailure(page); throw error; }
  68  |   finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  69  | });
  70  | 
  71  | test('text cursor and scroll survive closing the tab and restarting Setdown', async () => {
  72  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-text-position-'));
  73  |   const file = path.join(root, 'reading.txt');
  74  |   const config = path.join(root, 'config');
  75  |   await writeFile(file, Array.from({ length: 400 }, (_, index) => `Line ${index + 1}: reading position`).join('\n'));
  76  |   let app = await launch(file, config);
  77  |   let page = await app.firstWindow();
  78  |   try {
  79  |     const editor = () => page.getByRole('textbox', { name: 'Editor content' });
> 80  |     await expect(editor()).toBeVisible();
      |                            ^ Error: expect(locator).toBeVisible() failed
  81  |     await editor().press('Control+End');
  82  |     for (let i = 0; i < 30; i++) await editor().press('ArrowUp');
  83  |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'text', surface: 'editor', anchor: { sourceLine: 370 } });
  84  |     await page.getByTitle('Close tab', { exact: true }).click();
  85  |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'empty');
  86  |     await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), file);
  87  |     // Reopen through the existing document-open notification path.
  88  |     await expect(editor()).toBeVisible();
  89  |     await expect(page.locator('.view-lines')).toContainText(/Line\s+370:/);
  90  |     await app.close();
  91  |     app = await launch(file, config); page = await app.firstWindow();
  92  |     await expect(editor()).toBeVisible();
  93  |     await expect(page.locator('.view-lines')).toContainText(/Line\s+370:/);
  94  |   } catch (error) { await snapshotOnFailure(page); throw error; }
  95  |   finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  96  | });
  97  | 
  98  | test('the first text tab paints its saved viewport without flashing the document end', async () => {
  99  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-text-first-frame-'));
  100 |   const file = path.join(root, 'reading.txt');
  101 |   await writeFile(file, Array.from({ length: 400 }, (_, index) => `Line ${index + 1}: reading position`).join('\n'));
  102 |   const app = await launch(file, path.join(root, 'config'));
  103 |   let page = await app.firstWindow();
  104 |   type FrameTrace = { frames: number[]; frame: number };
  105 |   try {
  106 |     let input = page.getByRole('textbox', { name: 'Editor content' });
  107 |     await input.press('Control+End');
  108 |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition))
  109 |       .toMatchObject({ kind: 'text', anchor: { sourceLine: 400 } });
  110 |     for (let index = 0; index < 5; index++) await input.press('PageUp');
  111 |     await expect.poll(() => page.evaluate(async () => {
  112 |       const saved = (await window.marktex.reloadDocument())?.readingPosition;
  113 |       return saved?.kind === 'text' ? saved.anchor.sourceLine : 400;
  114 |     })).toBeLessThan(300);
  115 |     const firstLine = await page.locator('.monaco-editor').evaluate(editor => {
  116 |       const box = editor.getBoundingClientRect();
  117 |       return Math.min(...[...editor.querySelectorAll('.line-numbers')].filter(node => {
  118 |         const line = node.getBoundingClientRect();
  119 |         return line.bottom > box.top && line.top < box.bottom;
  120 |       }).map(node => Number(node.textContent)).filter(line => Number.isFinite(line) && line > 0));
  121 |     });
  122 |     expect(firstLine).toBeGreaterThan(100);
  123 |     expect(firstLine).toBeLessThan(300);
  124 | 
  125 |     for (const cold of [false, true]) {
  126 |       await page.getByTitle('Close tab', { exact: true }).click();
  127 |       await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'empty');
  128 |       if (cold) {
  129 |         const newWindow = app.waitForEvent('window');
  130 |         await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
  131 |         page = await newWindow;
  132 |         input = page.getByRole('textbox', { name: 'Editor content' });
  133 |         await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'empty');
  134 |       }
  135 |       await page.evaluate(() => {
  136 |         const trace: FrameTrace = { frames: [], frame: 0 };
  137 |         (window as typeof window & { positionTrace: FrameTrace }).positionTrace = trace;
  138 |         const sample = () => {
  139 |           const editor = document.querySelector<HTMLElement>('.shell[data-surface="editor"] .monaco-editor');
  140 |           if (editor?.checkVisibility({ visibilityProperty: true })) {
  141 |             const box = editor.getBoundingClientRect();
  142 |             const lines = [...editor.querySelectorAll('.line-numbers')].filter(node => {
  143 |               const line = node.getBoundingClientRect();
  144 |               return line.bottom > box.top && line.top < box.bottom;
  145 |             }).map(node => Number(node.textContent)).filter(line => Number.isFinite(line) && line > 0);
  146 |             if (lines.length) trace.frames.push(Math.min(...lines));
  147 |           }
  148 |           trace.frame = requestAnimationFrame(sample);
  149 |         };
  150 |         sample();
  151 |       });
  152 |       await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
  153 |       await expect(input).toBeVisible();
  154 |       await page.waitForFunction(() => (window as typeof window & { positionTrace: FrameTrace }).positionTrace.frames.length >= 30);
  155 |       const frames = await page.evaluate(() => {
  156 |         const trace = (window as typeof window & { positionTrace: FrameTrace }).positionTrace;
  157 |         cancelAnimationFrame(trace.frame);
  158 |         return trace.frames;
  159 |       });
  160 |       const framePath = test.info().outputPath(cold ? 'cold-first-tab-frames.json' : 'warm-first-tab-frames.json');
  161 |       await writeFile(framePath, JSON.stringify(frames));
  162 |       await test.info().attach('first-tab-frames', { path: framePath, contentType: 'application/json' });
  163 |       expect([...new Set(frames)]).toEqual([firstLine]);
  164 |     }
  165 |   } catch (error) { await snapshotOnFailure(page); throw error; }
  166 |   finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  167 | });
  168 | 
  169 | test('a PDF beyond the initial byte range keeps its position across Markdown tab switches', async () => {
  170 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-tabs-'));
  171 |   const file = path.join(root, 'large.pdf');
  172 |   const markdown = path.join(root, 'notes.md');
  173 |   const bytes = pdfFixture(100);
  174 |   expect(bytes.length).toBeGreaterThan(65536);
  175 |   await writeFile(file, bytes); await writeFile(markdown, '# Notes\n\nMarkdown remains readable.');
  176 |   const app = await launch(file, path.join(root, 'config'));
  177 |   const page = await app.firstWindow();
  178 |   try {
  179 |     const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
  180 |     await expect(pdf).toHaveAttribute('data-pdf-pages', '100');
```