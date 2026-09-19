import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type ImeLog = { starts: number; ends: number; blur: number };
type NativeLog = { blur: number; loads: number; shellId: number };

// CDP drives Chromium's composition path, NOT insertText of a finished Korean
// sentence or a synthetic DOM CompositionEvent. Also run the manual OS-IME
// checks: CDP does not emulate IBus/Fcitx/Windows candidate UIs.
test('Korean composition survives working-tree preview navigation without a single blur', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-ime-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-ime-config-'));
  const documentPath = path.join(root, 'ime.md');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    const filler = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1}.`);
    const base = ['# Base', '', ...filler, '', ''].join('\n');
    const draft = base.replace('# Base', '# Working tree');
    await writeFile(documentPath, base);
    await exec('git', ['add', 'ime.md'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    await writeFile(documentPath, draft);
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    application = await electron.launch({ args: ['.', documentPath], env: {
      ...environment, XDG_CONFIG_HOME: configRoot,
    } });
    const window = await application.firstWindow();
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folderPath);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control', exact: true }).click();
    const changed = window.locator('.scm-group').filter({ has: window.getByText('CHANGES', { exact: true }) });
    await changed.locator('.git-change-open').click();
    const modified = window.getByRole('textbox', { name: 'Current document', exact: true });
    await expect(modified).toBeEditable();
    await modified.press('Control+End');
    await modified.pressSequentially('IME-SENTINEL ');
    const cdp = await window.context().newCDPSession(window);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await application.evaluate(({ BrowserWindow, webContents, app }) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      if (!owner) throw new Error('No visible window');
      owner.focus(); owner.webContents.focus();
      const state: NativeLog = { blur: 0, loads: 0, shellId: owner.webContents.id };
      (globalThis as typeof globalThis & { __imeNative: NativeLog }).__imeNative = state;
      owner.webContents.on('blur', () => { state.blur += 1; });
      const observe = (contents: Electron.WebContents) => {
        if (contents.id !== state.shellId) contents.on('did-finish-load', () => { state.loads += 1; });
      };
      webContents.getAllWebContents().forEach(observe);
      app.on('web-contents-created', (_event, contents) => observe(contents));
    });
    await expect.poll(() => application!.evaluate(({ webContents }) => {
      const log = (globalThis as typeof globalThis & { __imeNative: NativeLog }).__imeNative;
      return webContents.getFocusedWebContents()?.id === log.shellId;
    })).toBe(true);
    await modified.focus();
    await window.evaluate(() => {
      const log: ImeLog = { starts: 0, ends: 0, blur: 0 };
      (window as typeof window & { __imeLog: ImeLog }).__imeLog = log;
      const active = document.activeElement as HTMLElement & { editContext?: EventTarget };
      const target = active.editContext ?? active;
      target.addEventListener('compositionstart', () => { log.starts += 1; });
      target.addEventListener('compositionend', () => { log.ends += 1; });
      window.addEventListener('blur', () => { log.blur += 1; });
      active.addEventListener('blur', () => { log.blur += 1; });
    });
    const preedit = (text: string) => cdp.send('Input.imeSetComposition', {
      text, selectionStart: text.length, selectionEnd: text.length,
    });
    let written = '';
    for (const sequence of [['ㅎ', '하', '한'], ['ㄱ', '그', '글']]) {
      const before = await window.evaluate(() => ({ ...(window as typeof window & { __imeLog: ImeLog }).__imeLog }));
      await preedit(sequence[0]);
      await preedit(sequence[1]);
      await expect.poll(() => window.evaluate(() =>
        (window as typeof window & { __imeLog: ImeLog }).__imeLog.starts)).toBe(before.starts + 1);
      // Wait for the background path while a syllable is STILL composing.
      // Inspect actual rendered content, not an arbitrary sleep or a count
      // incremented by an unrelated spare warmup.
      const partial = `IME-SENTINEL ${written}${sequence[1]}`;
      await expect.poll(() => application!.evaluate(async ({ webContents }, expected) => {
        const pages = webContents.getAllWebContents().filter((contents) =>
          !contents.isDestroyed() && contents.getURL().startsWith('marktex-preview://document/'));
        return (await Promise.all(pages.map((contents) => contents.executeJavaScript(
          `document.body.innerText.includes(${JSON.stringify(expected)})`,
        ).catch(() => false)))).some(Boolean);
      }, partial), { timeout: 20_000 }).toBe(true);
      const during = await window.evaluate(() => (window as typeof window & { __imeLog: ImeLog }).__imeLog);
      expect(during.ends).toBe(before.ends);
      expect(during.blur).toBe(0);
      expect(await application.evaluate(() =>
        (globalThis as typeof globalThis & { __imeNative: NativeLog }).__imeNative.blur)).toBe(0);
      await preedit(sequence[2]);
      await cdp.send('Input.insertText', { text: sequence[2] });
      written += sequence[2];
    }
    await modified.press('Control+S');
    await expect.poll(() => readFile(documentPath, 'utf8')).toBe(draft + 'IME-SENTINEL 한글');
    await window.locator('.document-tab:not(.git-diff-tab)').click();
    await window.locator('.git-diff-tab').click();
    await expect(window.locator('.modified-in-monaco-diff-editor .view-lines')).toContainText('IME-SENTINEL 한글');
    await modified.focus();
    await preedit('ㄱ');
    await modified.press('Escape');
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await window.waitForTimeout(30); // compositionend settlement, not a delayed focus assertion
    await modified.press('Escape');
    await expect(window.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await cdp.detach();
  } finally {
    if (application) await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
