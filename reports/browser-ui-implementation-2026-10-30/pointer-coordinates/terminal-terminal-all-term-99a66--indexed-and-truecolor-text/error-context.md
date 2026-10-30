# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal/terminal.spec.ts >> all terminal themes preserve the PTY and readable ANSI, indexed and truecolor text
- Location: test/e2e/terminal/terminal.spec.ts:379:1

# Error details

```
Error: solarized-light ANSI01: rgb(220, 50, 47) on rgb(253, 246, 227)

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    4.287722301909868
```

# Test source

```ts
  313 |     await expect(page.getByRole('tab', { name: /^Terminal \d/ })).toHaveCount(2);
  314 |     const second = await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
  315 |     await run(input(page), 'export SESSION_NAME=two');
  316 |     await dragTerminal(page, page.locator(`[data-tab-id="${second}"]`), page.locator('.group-body'), 'right');
  317 |     await expect(page.locator('.terminal-content:not(.inactive)')).toHaveCount(2);
  318 |     for (const [id, name] of [[first, 'one'], [second, 'two']]) {
  319 |       await run(page.locator(`[data-terminal-tab="${id}"] .xterm-helper-textarea`), `printf "%s" "$SESSION_NAME" > ${name}.txt`);
  320 |       await expect.poll(() => readFile(path.join(root, `${name}.txt`), 'utf8').catch(() => '')).toBe(name);
  321 |       await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  322 |     }
  323 |     const tab = page.locator(`[data-tab-id="${second}"]`), box = (await tab.boundingBox())!;
  324 |     const strip = (await page.locator('.tab-strip').first().boundingBox())!;
  325 |     await page.mouse.move(box.x + 25, box.y + 20); await page.mouse.down();
  326 |     await page.mouse.move(box.x + 45, box.y + 30, { steps: 8 });
  327 |     await page.mouse.move(strip.x + 8, strip.y + 20, { steps: 12 });
  328 |     await expect(page.locator('.tab-drop-indicator')).toBeVisible();
  329 |     await page.mouse.up();
  330 |     await expect(page.locator('.editor-group')).toHaveCount(1);
  331 |     await run(input(page), 'printf "%s" "$SESSION_NAME" > merged.txt');
  332 |     await expect.poll(() => readFile(path.join(root, 'merged.txt'), 'utf8').catch(() => '')).toBe('two');
  333 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  334 | });
  335 | 
  336 | 
  337 | test('a live Vim alternate screen retains visible text and insert mode across window transfer', async () => {
  338 |   test.skip(process.platform === 'win32', 'This scenario uses the POSIX Vim fixture.');
  339 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-vim-'));
  340 |   const file = path.join(root, 'tui.txt');
  341 |   await writeFile(file, 'first-screen-marker\nsecond-screen-marker\n');
  342 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  343 |   const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  344 |   try {
  345 |     const page = await app.firstWindow();
  346 |     await expect(page.locator('.empty-new')).toBeVisible();
  347 |     await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  348 |     await page.locator('.empty-new').click();
  349 |     await page.locator('.new-terminal-tab-button').click();
  350 |     const tab = page.getByRole('tab', { name: /^Terminal \d/ });
  351 |     await expect(tab).toBeVisible();
  352 |     await run(input(page), 'printf "%s" "$$" > shell.txt; vim -Nu NONE -n tui.txt');
  353 |     await expect(page.locator('.xterm-rows')).toContainText('first-screen-marker');
  354 |     await input(page).press('i'); await input(page).pressSequentially('before');
  355 |     await expect(page.locator('.xterm-rows')).toContainText('beforefirst-screen-marker');
  356 |     const text = await page.locator('.xterm-rows').innerText();
  357 |     const dimensions = await page.locator('.terminal-instance').boundingBox();
  358 |     await tab.evaluate(element => {
  359 |       const dataTransfer = new DataTransfer();
  360 |       element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
  361 |       element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
  362 |       element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: 640, screenY: 420 }));
  363 |     });
  364 |     await expect(tab).toHaveCount(0);
  365 |     const destination = app.windows().find(candidate => candidate !== page && !candidate.isClosed())!;
  366 |     await expect.poll(() => destination.locator('.xterm-rows').innerText()).toBe(text);
  367 |     const restored = (await destination.locator('.terminal-instance').boundingBox())!;
  368 |     expect(restored.width).toBe(dimensions!.width); expect(restored.height).toBe(dimensions!.height);
  369 |     await input(destination).pressSequentially('after');
  370 |     await input(destination).press('Escape');
  371 |     await input(destination).pressSequentially(':wq'); await input(destination).press('Enter');
  372 |     await expect.poll(() => readFile(file, 'utf8')).toBe('beforeafterfirst-screen-marker\nsecond-screen-marker\n');
  373 |     const pid = await readFile(path.join(root, 'shell.txt'), 'utf8');
  374 |     await run(input(destination), 'printf "%s" "$$" > after.txt');
  375 |     await expect.poll(() => readFile(path.join(root, 'after.txt'), 'utf8').catch(() => '')).toBe(pid);
  376 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  377 | });
  378 | 
  379 | test('all terminal themes preserve the PTY and readable ANSI, indexed and truecolor text', async () => {
  380 |   test.skip(process.platform === 'win32', 'The PTY fixture uses a POSIX shell.');
  381 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-themes-'));
  382 |   const file = path.join(root, 'themes.md'); await writeFile(file, '# Terminal themes\n');
  383 |   const samples = Array.from({ length: 16 }, (_, i) => `\x1b[${i < 8 ? 30 + i : 90 + i - 8}mANSI${String(i).padStart(2, '0')}\x1b[0m\r\n`).join('')
  384 |     + '\x1b[38;5;231mINDEXED\x1b[0m\r\n\x1b[38;2;255;249;239mTRUECOLOR\x1b[0m\r\n'
  385 |     + '\x1b[38;2;255;255;255;48;2;250;250;250mEXPLICIT\x1b[0m\r\n\x1b[7mINVERSE\x1b[0m\r\n';
  386 |   await writeFile(path.join(root, 'colors.txt'), samples);
  387 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  388 |   const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  389 |   try {
  390 |     await focusApplication(app); const page = await app.firstWindow();
  391 |     await page.locator('.new-terminal-tab-button').click();
  392 |     await run(input(page), 'printf "%s" "$$" > pid-before; cat colors.txt');
  393 |     await expect(page.locator('.xterm-rows')).toContainText('INVERSE');
  394 |     await input(page).pressSequentially('not-submitted');
  395 |     await page.evaluate(() => { (window as any).__keptTerminal = document.querySelector('.xterm'); });
  396 |     for (const id of THEME_IDS) {
  397 |       await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
  398 |       const palette = themeProfile(id).palette;
  399 |       const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  400 |       await expect.poll(() => page.locator('.terminal-surface').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(rgb(palette.editorBackground));
  401 |       const readings = await page.locator('.xterm-rows').evaluate(rows => {
  402 |         const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  403 |         const luminance = (value: number[]) => value.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  404 |           .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  405 |         return Array.from(rows.querySelectorAll('span')).filter(span => /^(ANSI\d\d|INDEXED|TRUECOLOR|EXPLICIT|INVERSE)$/.test(span.textContent?.trim() ?? '')).map(span => {
  406 |           const style = getComputedStyle(span); let node: Element | null = span, background = style.backgroundColor;
  407 |           while (node && background === 'rgba(0, 0, 0, 0)') { node = node.parentElement; if (node) background = getComputedStyle(node).backgroundColor; }
  408 |           const fg = luminance(rgb(style.color)), bg = luminance(rgb(background));
  409 |           return { label: span.textContent!.trim(), foreground: style.color, background, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
  410 |         });
  411 |       });
  412 |       expect(readings, id).toHaveLength(20);
> 413 |       for (const sample of readings) expect(sample.contrast, `${id} ${sample.label}: ${sample.foreground} on ${sample.background}`).toBeGreaterThanOrEqual(4.5);
      |                                                                                                                                     ^ Error: solarized-light ANSI01: rgb(220, 50, 47) on rgb(253, 246, 227)
  414 |       expect(await page.evaluate(() => (window as any).__keptTerminal === document.querySelector('.xterm'))).toBe(true);
  415 |       await expect(page.locator('.xterm-rows')).toContainText('not-submitted');
  416 |       await page.screenshot({ path: test.info().outputPath(`terminal-${id}.png`) });
  417 |     }
  418 |     await input(page).press('Control+C');
  419 |     await run(input(page), 'printf "%s" "$$" > pid-after');
  420 |     await expect.poll(() => readFile(path.join(root, 'pid-after'), 'utf8').catch(() => '')).toBe(await readFile(path.join(root, 'pid-before'), 'utf8'));
  421 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  422 | });
  423 | 
```