import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const wasmRoot = path.resolve('../../vendor/hop/apps/studio-host/vendor/rhwp-core');
async function engine() {
  const module = await import(pathToFileURL(path.join(wasmRoot, 'rhwp.js')).href);
  module.initSync({ module: await readFile(path.join(wasmRoot, 'rhwp_bg.wasm')) });
  return module;
}

test('Explorer creates a blank HWP in the selected folder and opens an editable, saveable document', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-new-hwp-'));
  const folder = path.join(root, 'documents');
  await mkdir(folder);
  const existing = path.join(folder, 'existing.hwp');
  await writeFile(existing, 'KEEP_EXISTING');
  const text = path.join(root, 'start.txt');
  await writeFile(text, 'Start');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', text], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app);
    const page = await app.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const create = page.getByRole('button', { name: 'New HWP File', exact: true });
    const input = page.getByRole('textbox', { name: 'New HWP file name', exact: true });
    await create.click();
    await expect(input).toHaveValue('Untitled.hwp');
    await expect(input).toBeFocused();
    expect(await input.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([0, 8]);
    await input.press('Escape');
    await expect(input).toBeHidden();
    expect(await readdir(root)).not.toContain('Untitled.hwp');

    await page.getByRole('treeitem', { name: 'documents', exact: true }).click();
    await create.click();
    await input.fill('existing');
    await input.press('Enter');
    await expect(page.locator('.project-error')).toContainText('already exists');
    await expect(input).toBeVisible();
    expect(await readFile(existing, 'utf8')).toBe('KEEP_EXISTING');
    await input.fill('새 문서');
    await input.press('Enter');
    const file = path.join(folder, '새 문서.hwp');
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'hwp');
    await expect.poll(() => page.evaluate(async () => (await window.marktex.getDocument())?.path)).toBe(file);
    await expect(page.getByRole('treeitem', { name: '새 문서.hwp', exact: true })).toBeVisible();
    await expect(page.locator('.project-error')).toBeHidden();
    expect(await readdir(root)).not.toContain('새 문서.hwp');
    const core = await engine();
    const blank = new core.HwpDocument(new Uint8Array(await readFile(file)));
    try {
      expect(JSON.parse(blank.getTextFileText())).toBe('');
      expect(JSON.parse(blank.getDocumentInfo())).toMatchObject({ pageCount: 1, sectionCount: 1 });
    } finally { blank.free(); }
    const child = async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('setdown-hwp:'))?.id);
    await expect.poll(child).toBeTruthy();
    const id = (await child())!;
    await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.documentElement.dataset.hwpReady'), id), { timeout: 45_000 }).toBe('true');
    await app.evaluate(({ webContents }, id) => { const contents = webContents.fromId(id)!; contents.focus(); contents.insertText('새 HWP 문서 편집'); }, id);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    await app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id)!;
      contents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['control'] });
    }, id);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const saved = new core.HwpDocument(new Uint8Array(await readFile(file)));
    try { expect(saved.getTextFileText()).toContain('새 HWP 문서 편집'); } finally { saved.free(); }
    await page.screenshot({ path: test.info().outputPath('new-hwp-explorer.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

for (const format of ['hwp', 'hwpx'] as const) test(`${format}: local Canvas editor, input, save, reopen, retained undo and isolation`, async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-hwp-'));
  const file = path.join(root, `sample.${format}`);
  const core = await engine();
  const original = core.HwpDocument.createEmpty(); original.createBlankDocument();
  original.insertText(0, 0, 0, '한글 문서 테스트');
  const table = JSON.parse(original.createTable(0, 0, 0, 2, 2));
  original.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '표 안의 글자');
  await writeFile(file, format === 'hwp' ? original.exportHwp() : original.exportHwpx()); original.free();
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    page.on('console', msg => { if (msg.type() === 'error') console.log('shell:', msg.text()); });
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'hwp');
    const child = async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('setdown-hwp:'))?.id);
    await expect.poll(async () => await child() ? 'created' : await page.locator('.hwp-surface').allTextContents()).toEqual('created'); const id = (await child())!;
    const execute = (script: string) => app.evaluate(({ webContents }, { id, script }) => webContents.fromId(id)!.executeJavaScript(script), { id, script });
    await expect.poll(async () => ({ ready: await execute('document.documentElement.dataset.hwpReady'), error: await page.locator('.hwp-surface').innerText() }), { timeout: 45_000 }).toEqual({ ready: 'true', error: '' });
    expect(await execute('typeof window.marktex')).toBe('undefined');
    expect(await execute('typeof require')).toBe('undefined');
    expect(await execute('document.querySelectorAll("canvas").length')).toBeGreaterThan(2);
    expect(await execute('fetch("https://example.com").then(()=>true,()=>false)')).toBe(false);
    const tabId = await page.locator('[data-hwp-tab]').getAttribute('data-hwp-tab');
    await page.getByRole('button', { name: 'Zoom hwp in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reset hwp zoom' })).toHaveText('110%');
    await expect.poll(() => execute('document.getElementById("sb-zoom-val").textContent')).toBe('110%');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1);
    await page.getByRole('button', { name: 'Reset hwp zoom' }).click();
    await expect.poll(() => execute('document.getElementById("sb-zoom-val").textContent')).toBe('100%');
    await execute('window.imeEvents={start:0,end:0};document.addEventListener("compositionstart",()=>window.imeEvents.start++);document.addEventListener("compositionend",()=>window.imeEvents.end++);true');
    await app.evaluate(async ({ webContents }, id) => { const contents = webContents.fromId(id)!; contents.focus(); contents.debugger.attach('1.3');
      for (const text of ['ㅎ','하','한']) await contents.debugger.sendCommand('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }, id);
    expect(await execute('window.imeEvents')).toEqual({ start: 1, end: 0 });
    expect(await page.evaluate(async id => { try { await window.marktex.hwp.save(id!, false); return 'saved'; } catch (error) { return String(error); } }, tabId)).toContain('조합');
    await app.evaluate(async ({ webContents }, id) => { const contents = webContents.fromId(id)!; await contents.debugger.sendCommand('Input.insertText', { text: '한' }); contents.debugger.detach(); }, id);
    expect(await execute('window.imeEvents')).toEqual({ start: 1, end: 1 });
    await app.evaluate(({ webContents }, id) => { webContents.fromId(id)!.focus(); webContents.fromId(id)!.insertText('SETDOWN '); }, id);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    await app.evaluate(({ webContents }, id) => { const contents = webContents.fromId(id)!;
      contents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['control'] }); }, id);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const reopened = new core.HwpDocument(new Uint8Array(await readFile(file)));
    expect(reopened.getTextFileText()).toContain('SETDOWN'); expect(reopened.getTextFileText()).toContain('한글 문서 테스트');
    expect(reopened.getTextFileText()).toContain('표 안의 글자');
    expect(JSON.parse(reopened.getTableDimensions(0, table.paraIdx, table.controlIdx))).toMatchObject({ rowCount: 2, colCount: 2 }); reopened.free();
    // Opening a real second tab, then returning, keeps the native runtime identity.
    await page.evaluate(id => { window.marktex.hwp.command(id!, 'select-all'); window.marktex.hwp.command(id!, 'copy'); }, tabId);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('SETDOWN');
    const text = path.join(root, 'other.txt'); await writeFile(text, 'Other');
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), text);
    await expect(page.getByRole('tab').filter({ hasText: 'other.txt' })).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await page.getByRole('tab').filter({ hasText: `sample.${format}` }).click();
    await expect.poll(() => page.evaluate(async () => (await window.marktex.getDocument())?.path)).toBe(file);
    expect(await child()).toBe(id);
    await page.evaluate(id => window.marktex.hwp.command(id!, 'undo'), tabId);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    // Inject a reported engine loss to exercise the host's overwrite policy.
    // This does not claim that the fixture itself has unsupported HWP features.
    const beforeLoss = await readFile(file);
    await app.evaluate(({ ipcMain }) => { ipcMain.prependOnceListener('hwp-runtime:exported', (_event, result) => {
      result.artifact.contentLoss.count = 1;
      result.artifact.contentLoss.losses = [{ reason: 'Test-reported unsupported control' }];
    }); });
    expect(await page.evaluate(async id => { try { await window.marktex.hwp.save(id!, false); return 'saved'; } catch (error) { return String(error); } }, tabId)).toContain('손실');
    expect(await readFile(file)).toEqual(beforeLoss);
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    const capture = await app.evaluate(async ({ webContents }, id) => (await webContents.fromId(id)!.capturePage()).toPNG().toString('base64'), id);
    await writeFile(test.info().outputPath(`editor-${format}.png`), Buffer.from(capture, 'base64'));
    // A disk conflict never overwrites the external file or clears the unsaved revision.
    const disk = await readFile(file); const external = Buffer.concat([disk, Buffer.from('external-change')]);
    await writeFile(file, external);
    await expect(page.getByRole('button', { name: 'Keep My Changes' })).toBeVisible();
    const banner = (await page.locator('.focused-content .notice').boundingBox())!;
    await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.id === id);
      return view?.getBounds().y ?? 0;
    }, id)).toBeGreaterThanOrEqual(Math.floor(banner.y + banner.height));
    await page.getByRole('button', { name: 'Keep My Changes' }).click();
    await expect(page.locator('.focused-content .notice')).toBeHidden();
    expect(await page.evaluate(async id => { try { await window.marktex.hwp.save(id!, false); return 'saved'; } catch (error) { return String(error); } }, tabId)).toContain('외부');
    expect(await readFile(file)).toEqual(external);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
    expect(await page.evaluate(id => window.marktex.hwp.save(id!, true), tabId)).toEqual({ canceled: true });
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    const copy = path.join(root, `copy.${format}`);
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, copy);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible())!.webContents.send('app:command', 'save-as'));
    await expect(page.getByRole('tab').filter({ hasText: `copy.${format}` })).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const copied = new core.HwpDocument(new Uint8Array(await readFile(copy))); expect(copied.getTextFileText()).toContain('한글 문서 테스트'); copied.free();
    expect(await readFile(file)).toEqual(external);
    // Transfer the live view, including its saved undo stack, into another window.
    const transferred = app.waitForEvent('window');
    await page.getByRole('tab').filter({ hasText: `copy.${format}` }).evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
    });
    const destination = await transferred;
    await expect(destination.getByRole('tab').filter({ hasText: `copy.${format}` })).toBeVisible();
    await expect(page.getByRole('tab').filter({ hasText: `copy.${format}` })).toHaveCount(0);
    expect(await child()).toBe(id);
    expect(await page.evaluate(async id => { try { await window.marktex.hwp.save(id!, false); return 'allowed'; } catch (error) { return String(error); } }, tabId)).toContain('소유자');
    await destination.evaluate(id => window.marktex.hwp.command(id!, 'redo'), tabId);
    await expect(destination.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible() && w.webContents.getTitle().includes('copy.'))!.close());
    await expect(destination.getByRole('dialog', { name: 'Save Changes' })).toBeVisible();
    await destination.getByRole('dialog', { name: 'Save Changes' }).locator('.close-cancel').click();
    expect(await child()).toBe(id);
    // Address navigation replaces the binary session even when the tab id is reused.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getTitle().includes('copy.'))!.webContents.send('app:command', 'save'));
    await expect(destination.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const savedCopy = await readFile(copy);
    const replacement = path.join(root, `replacement.${format}`); await writeFile(replacement, disk);
    await destination.getByRole('textbox', { name: 'Address or file path' }).fill(replacement);
    await destination.getByRole('textbox', { name: 'Address or file path' }).press('Enter');
    await expect(destination.getByRole('tab').filter({ hasText: `replacement.${format}` })).toBeVisible();
    expect(await destination.locator('[data-hwp-tab]').getAttribute('data-hwp-tab')).toBe(tabId);
    await expect.poll(async () => { const current = await child(); return typeof current === 'number' && current !== id; }).toBe(true);
    const replacementId = (await child())!;
    await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.documentElement.dataset.hwpReady'), replacementId)).toBe('true');
    await app.evaluate(({ webContents }, id) => { webContents.fromId(id)!.focus(); webContents.fromId(id)!.insertText('REPLACED '); }, replacementId);
    await expect(destination.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getTitle().includes('replacement.'))!.webContents.send('app:command', 'save'));
    await expect(destination.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
    const replaced = new core.HwpDocument(new Uint8Array(await readFile(replacement)));
    expect(replaced.getTextFileText()).toContain('REPLACED'); replaced.free();
    expect(await readFile(copy)).toEqual(savedCopy);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
