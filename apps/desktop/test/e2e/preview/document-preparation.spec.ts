import { electron } from '../../support/electron/electron-app';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { doubleClickPreview } from '../../support/preview/preview-cycle-input';

test('immediate edited Esc retains the destination of an animated editor scroll', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-esc-scroll-destination-'));
  const file = path.join(root, 'sample.md');
  const source = await readFile(path.resolve('test/fixtures/sample.md'), 'utf8');
  await writeFile(file, source);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.locator('.mode-toggle').click();
    const editor = page.getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    await editor.press('Control+End');
    await page.keyboard.insertText('\n\nESC_SCROLL_DESTINATION');
    // No animation wait: Esc must retain the requested destination even while
    // Monaco is still painting intermediate positions on its way there.
    await editor.press('Escape');
    await expect(page.locator('.viewer-surface')).toBeVisible();
    const anchor = Number(await page.locator('.shell').getAttribute('data-anchor-line'));
    expect(anchor).toBe(source.split(/\r\n|\r|\n/).length + 2);
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
        'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView | undefined;
      return view?.webContents.executeJavaScript(`(() => {
        const marker = [...document.querySelectorAll('.markdown-preview p')]
          .find(node => node.textContent.includes('ESC_SCROLL_DESTINATION'));
        const rect = marker?.getBoundingClientRect();
        return !!rect && rect.top >= 0 && rect.bottom <= innerHeight;
      })()`);
    })).toBe(true);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('hidden ordinary math document is prepared without focus changes and keeps its typography', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-document-preparation-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const file = path.join(root, 'sample.md');
    await writeFile(file, await readFile(path.resolve('test/fixtures/sample.md')));
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') } });
    const page = await app.firstWindow();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.locator('.mode-toggle').click();
    const editor = page.getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    await editor.focus();
    await page.evaluate(() => {
      (window as any).preparationBlurs = 0;
      window.addEventListener('blur', () => (window as any).preparationBlurs++);
    });
    const prepared = () => app!.evaluate(async ({ BrowserWindow }) => {
      const views = BrowserWindow.getAllWindows()[0].contentView.children;
      for (const view of views) {
        if (!('webContents' in view)) continue;
        const contents = view.webContents as Electron.WebContents;
        const state = await contents.executeJavaScript(`({ math:document.querySelectorAll('.katex').length,
          pending:document.body.dataset.setdownPendingBlockCount, width:innerWidth, height:innerHeight })`).catch(() => null);
        if (state?.math > 700 && state.pending === '0') return { ...state, id:contents.id, visible:view.getVisible(), bounds:view.getBounds() };
      }
      return null;
    });
    await expect.poll(prepared, { timeout: 30_000 }).not.toBeNull();
    const hidden = (await prepared())!;
    expect(hidden.visible).toBe(false);
    expect(hidden.pending).toBe('0');
    expect(hidden.width).toBe(hidden.bounds.width);
    expect(hidden.height).toBe(hidden.bounds.height);
    expect(hidden.width).toBeGreaterThan(600);
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => (window as any).preparationBlurs)).toBe(0);
    await editor.press('Escape');
    await expect(page.locator('.viewer-surface')).toBeVisible();

    for (const [width, zoom] of [[1100, 1], [680, 1], [1100, 1.25]]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
      const result = await app.evaluate(async ({ webContents }, { id, zoom }) => {
        const contents = webContents.fromId(id)!;
        contents.setZoomFactor(zoom);
        const compared = await contents.executeJavaScript(`(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await document.fonts.ready;
          const source = document.querySelector('link[href*="/styles/preview.css"]');
          const uiUrl = source.href.replace('/styles/preview.css', '/webview/preview.css');
          if (document.querySelector('link[href="' + uiUrl + '"]')) throw Error('UI CSS remains installed');
          const nodes = [...document.querySelector('.markdown-preview').querySelectorAll('h1,h2,h3,p,li,pre,table,.katex,.katex-mathml')];
          const textFonts = [...document.querySelector('.markdown-preview').querySelectorAll('h1,h2,h3,p,li,pre,code,table')]
            .map(node => getComputedStyle(node).fontFamily);
          const snapshot = () => nodes.map(node => {
            const r = node.getBoundingClientRect(), s = getComputedStyle(node);
            return { rect:[r.x+scrollX,r.y+scrollY,r.width,r.height].map(n=>Math.round(n*100)/100),
              style:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.color,s.display,s.visibility] };
          });
          window.__documentGeometry = () => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,nodes:snapshot()});
          const optimized = snapshot();
          const link=document.createElement('link'); link.rel='stylesheet'; link.href=uiUrl;
          await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;source.before(link);});
          await document.fonts.ready;
          const original=snapshot();link.remove();await document.fonts.ready;
          return {count:nodes.length, textFonts, differences:original.flatMap((old,i)=>JSON.stringify(old)===JSON.stringify(optimized[i])?[]:[{old,optimized:optimized[i]}]).slice(0,10)};
        })()`);
        const pinned = await contents.executeJavaScript('window.__documentGeometry()');
        contents.disableDeviceEmulation();
        const natural = await contents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(window.__documentGeometry()))))`);
        return { ...compared, pinned, natural };
      }, { id: hidden.id, zoom });
      expect(result.count).toBeGreaterThan(1500);
      expect(result.textFonts.length).toBeGreaterThan(0);
      for (const font of result.textFonts) expect(font.split(',')[0].replaceAll('"', '').trim()).toBe('D2Coding');
      expect(result.differences).toEqual([]);
      expect(result.pinned).toEqual(result.natural);
    }
    // An open outline must retain its reader width while source covers it.
    await page.locator('.toc-toggle').click();
    await expect(page.locator('.toc-panel')).toBeVisible();
    const readerWidth=(await page.locator('.preview-frames').boundingBox())!.width;
    await page.locator('.mode-toggle').click();
    await expect(editor).toBeEditable();
    await expect(page.locator('.toc-panel')).toBeHidden();
    await expect.poll(async () => (await prepared())?.bounds.width).toBe(Math.round(readerWidth));
    await editor.press('Escape');
    await expect(page.locator('.toc-panel')).toBeVisible();
  } finally {
    if (app) await disposeApplication(app);
    await rm(root, { recursive:true, force:true });
  }
});

test('ordinary position caches refresh after a disclosure changes layout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-atlas-disclosure-'));
  const file = path.join(root, 'disclosure.md');
  const text = `# Before\n\n${'Intro paragraph. '.repeat(200)}\n\n<details>\n<summary>Expand</summary>\n\n${'Expanded paragraph. '.repeat(600)}\n\n</details>\n\n## Target\n\n${'Trailing paragraph. '.repeat(900)}\n`;
  await writeFile(file, text);
  const line = text.slice(0, text.indexOf('## Target')).split('\n').length;
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.document-tab')).toHaveCount(1);
    const id = (await page.locator('.document-tab').getAttribute('data-tab-id'))!;
    const read = (script: string) => app.evaluate(async ({ BrowserWindow }, script) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()) as Electron.WebContentsView;
      return view ? view.webContents.executeJavaScript(script) : null;
    }, script);
    await expect.poll(() => read('!!document.querySelector("details")')).toBe(true);
    const position = async () => {
      await page.evaluate(({ id, line }) => window.marktex.sendPreviewCommand(id,
        { command: 'marktex:position-preview', sourceLine: line, topRatio: .3, settle: false }), { id, line });
      await expect.poll(() => read('Math.abs(document.querySelector("h2").getBoundingClientRect().top - innerHeight * .3)')).toBeLessThan(2);
    };
    await position();
    // Reuse existing geometry, then alter native details layout without changing
    // the Markdown revision or viewport. The next source position must remeasure.
    await read('document.querySelector("details").open = true; true');
    await position();
    await read('document.querySelector("details").open = false; true');
    await position();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('an owned background reader can prepare without changing the foreground document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-background-reader-'));
  const first = path.join(root, 'first.md'), second = path.join(root, 'second.md');
  await writeFile(first, '# First reader\n'); await writeFile(second, '# Second reader\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('tab', { name: /first.md/ })).toBeVisible();
    const id = (await page.getByRole('tab', { name: /first.md/ }).getAttribute('data-tab-id'))!;
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
    await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
    const result = await page.evaluate(async ({ id, first }) => {
      const theme = await window.marktex.getTheme();
      const result = await window.marktex.preparePreview(id, '# First reader\n', 0, first, theme.id);
      return { result, document: await window.marktex.getDocument() };
    }, { id, first });
    expect(result.result.url).toMatch(/^marktex-preview:\/\/document\//);
    expect(result.document?.path).toBe(second);
    expect(result.document?.text).toBe('# Second reader\n');
    await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');

  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('auto save after edited Esc keeps the native reader in place without an external-change notice', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-esc-position-'));
  const file = path.join(root, 'sample.md');
  await writeFile(file, await readFile(path.resolve('test/fixtures/sample.md')));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await focusApplication(app);
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-auto-save'));
    expect(await page.evaluate(() => window.marktex.getAutoSave())).toBe(true);
    const read = (script: string) => app.evaluate(async ({ BrowserWindow }, script) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
        'webContents' in candidate && (candidate.webContents as Electron.WebContents).getURL().startsWith('marktex-preview://document/')
        && !(candidate.webContents as Electron.WebContents).getURL().includes('/warmup-')) as Electron.WebContentsView;
      return view ? view.webContents.executeJavaScript(script) : null;
    }, script);
    await expect.poll(() => read('document.body.dataset.setdownHydration')).toBe('complete');
    await read('scrollTo(0, 2500)');
    const id = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0].contentView.children
      .find(candidate => 'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView).webContents.id);
    await doubleClickPreview(app, id, false);
    await app.evaluate(({ BrowserWindow, webContents }, id) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const view = owner.contentView.children.find(candidate => 'webContents' in candidate && candidate.webContents === webContents.fromId(id))!;
      const trace = { bounds: [] as Electron.Rectangle[], externalChanges: [] as unknown[] };
      (globalThis as any).escNativeTrace = trace;
      const setBounds = view.setBounds.bind(view), setVisible = view.setVisible.bind(view);
      view.setBounds = bounds => { if (view.getVisible()) trace.bounds.push(bounds); setBounds(bounds); };
      view.setVisible = visible => { if (visible) trace.bounds.push(view.getBounds()); setVisible(visible); };
      const send = owner.webContents.send.bind(owner.webContents);
      owner.webContents.send = (channel, ...args) => {
        if (channel === 'document:external-change') trace.externalChanges.push(args);
        send(channel, ...args);
      };
    }, id);
    const editor = page.getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeEditable();
    await editor.press('End');
    await page.keyboard.insertText('\n\nESC_POSITION_MARKER\n\n');
    await page.waitForTimeout(400);
    await expect.poll(() => read('document.querySelector(".markdown-preview").textContent.includes("ESC_POSITION_MARKER")')).toBe(true);
    await read(`window.escFrames = []; window.escCommands = [];
      window.escRecording = false;
      addEventListener('message', event => {
        if (event.data?.command === 'marktex:position-preview' && event.data.requestId) escCommands.push(event.data);
        if (event.data?.command === 'marktex:resume-hydration' && !escRecording) {
          escRecording = true;
          const record = () => {
            escFrames.push({ y: scrollY, latest: document.querySelector('.markdown-preview').textContent.includes('ESC_POSITION_MARKER') });
            if (escFrames.length < 180) requestAnimationFrame(record);
          };
          requestAnimationFrame(record);
        }
      });`);
    await editor.press('Escape');
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await expect.poll(() => read('escFrames.length'), { timeout: 10_000 }).toBe(180);
    const recorded = await read('({ frames: escFrames, commands: escCommands })') as {
      frames: Array<{ y: number; latest: boolean }>; commands: unknown[];
    };
    await writeFile(test.info().outputPath('esc-frames.json'), JSON.stringify(recorded, null, 2));
    expect(recorded.frames.every(frame => frame.latest)).toBe(true);
    const offsets = recorded.frames.map(frame => frame.y);
    expect(Math.min(...offsets)).toBeGreaterThan(1000);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(1);
    await expect.poll(() => readFile(file, 'utf8')).toContain('ESC_POSITION_MARKER');
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const native = await app.evaluate(() => (globalThis as any).escNativeTrace) as { bounds: Electron.Rectangle[]; externalChanges: unknown[] };
    await writeFile(test.info().outputPath('esc-native.json'), JSON.stringify(native, null, 2));
    expect(native.externalChanges).toEqual([]);
    expect(native.bounds.length).toBeGreaterThan(0);
    for (const bounds of native.bounds) expect(bounds).toEqual(native.bounds[0]);
    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
        'webContents' in candidate && candidate.getVisible()) as Electron.WebContentsView;
      return (await view.webContents.capturePage()).toPNG();
    });
    await writeFile(test.info().outputPath('esc-reader.png'), capture);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
