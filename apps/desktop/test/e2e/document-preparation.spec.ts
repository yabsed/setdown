import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

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
