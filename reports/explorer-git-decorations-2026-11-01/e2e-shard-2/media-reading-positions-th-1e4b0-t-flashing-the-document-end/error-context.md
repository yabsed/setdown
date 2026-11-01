# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: media/reading-positions.spec.ts >> the first text tab paints its saved viewport without flashing the document end
- Location: test/e2e/media/reading-positions.spec.ts:98:1

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
      - text: file:///tmp/setdown-text-first-frame-3t4sG6/reading.txt
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
  80  |     await expect(editor()).toBeVisible();
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
> 153 |       await expect(input).toBeVisible();
      |                           ^ Error: expect(locator).toBeVisible() failed
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
  181 |     await page.getByRole('spinbutton', { name: 'PDF page number' }).fill('98');
  182 |     await page.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
  183 |     await expect(pdf.locator('[data-page-number="98"] canvas')).toBeVisible();
  184 |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'pdf', page: 98 });
  185 |     const originalCanvas = await pdf.locator('[data-page-number="98"] canvas').elementHandle();
  186 |     await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
  187 |     await expect.poll(previews(app).hasVisible).toBe(true);
  188 |     await expect.poll(() => previews(app).evaluate('document.body.innerText')).toContain('Markdown remains readable.');
  189 |     await expect(pdf).toBeHidden();
  190 |     await page.getByRole('tab').filter({ hasText: 'large.pdf' }).click();
  191 |     await expect(pdf).toHaveAttribute('data-pdf-page', '98');
  192 |     await expect(pdf.locator('[data-page-number="98"] canvas')).toBeVisible();
  193 |     await expect.poll(previews(app).hasVisible).toBe(false);
  194 |     expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected
  195 |       && canvas === document.querySelector('.pdf-host')?.shadowRoot?.querySelector('[data-page-number="98"] canvas'))).toBe(true);
  196 |     await page.getByRole('tab').filter({ hasText: 'large.pdf' }).getByTitle('Close tab', { exact: true }).click();
  197 |     await expect.poll(previews(app).hasVisible).toBe(true);
  198 |     expect(await readFile(file)).toEqual(bytes);
  199 |   } catch (error) { await snapshotOnFailure(page); throw error; }
  200 |   finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  201 | });
  202 | 
  203 | test('Markdown restores its source anchor after restarting', async () => {
  204 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-markdown-position-'));
  205 |   const file = path.join(root, 'reading.md');
  206 |   const config = path.join(root, 'config');
  207 |   await writeFile(file, Array.from({ length: 90 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.\n`).join('\n'));
  208 |   let app = await launch(file, config);
  209 |   let page = await app.firstWindow();
  210 |   try {
  211 |     let reader = previews(app);
  212 |     await expect.poll(reader.hasVisible).toBe(true);
  213 |     await expect.poll(() => reader.evaluate('document.documentElement.scrollHeight')).toBeGreaterThan(5000);
  214 |     await reader.evaluate('window.scrollTo(0, 5000)');
  215 |     await expect.poll(() => page.evaluate(async () => {
  216 |       const position = (await window.marktex.reloadDocument())?.readingPosition;
  217 |       return position?.kind === 'text' ? position.anchor.sourceLine : 0;
  218 |     })).toBeGreaterThan(100);
  219 |     const saved = await page.evaluate(async () => (await window.marktex.reloadDocument())!.readingPosition);
  220 |     expect(saved?.kind === 'text' && saved.anchor.sourceLine).toBeGreaterThan(100);
  221 |     await app.close();
  222 |     app = await launch(file, config); page = await app.firstWindow(); reader = previews(app);
  223 |     await expect.poll(reader.hasVisible).toBe(true);
  224 |     await expect.poll(() => reader.evaluate('window.scrollY')).toBeGreaterThan(2000);
  225 |     await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'text', surface: 'viewer', anchor: { sourceLine: saved?.kind === 'text' ? saved.anchor.sourceLine : 0 } });
  226 |   } catch (error) { await snapshotOnFailure(page); throw error; }
  227 |   finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  228 | });
  229 | 
```