import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, evaluatePage, findOverlay } from '../../support/browser/browser-fixture';
import { dragTerminal } from '../../support/terminal/terminal-drag';

test('Reader Select All stays inside the article with a terminal sibling, including native Ctrl+A and menus', async () => {
  test.skip(process.platform === 'win32', 'Terminal commands use a POSIX shell.');
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/article`);
    const tab = f.page.getByRole('tab', { name: /Long article/ }); await expect(tab).toBeVisible();
    await f.page.getByRole('button', { name: 'Enter reader mode' }).click();
    await f.page.locator('.new-terminal-tab-button').click();
    const terminalTab = f.page.getByRole('tab', { name: /^Terminal 1/ });
    await dragTerminal(f.page, terminalTab, f.page.locator('.group-body'), 'right');
    const terminal = f.page.locator('.terminal-surface'), shell = terminal.locator('.xterm-helper-textarea');
    const run = async (text: string) => { await shell.pressSequentially(text); await shell.press('Enter'); };
    await run('printf TERMINAL_SENTINEL');
    await expect(terminal.locator('.xterm-rows')).toContainText('TERMINAL_SENTINEL');
    const reader = f.page.getByRole('region', { name: 'Reader mode', exact: true });
    const selection = () => reader.evaluate(element => {
      const selected = window.getSelection(), range = selected?.rangeCount ? selected.getRangeAt(0) : undefined;
      const content = element.querySelector('.web-reader-column > div')!;
      const expected = document.createRange(); expected.selectNodeContents(content);
      return { text: range?.toString(), expected: expected.toString(), scoped: !!range && content.contains(range.commonAncestorContainer),
        terminal: !!range?.intersectsNode(document.querySelector('.terminal-surface')!),
        address: [...document.querySelectorAll('.location-bar')].some(bar => range?.intersectsNode(bar)) };
    });
    const expectArticle = async () => {
      await expect.poll(async () => { const result = await selection(); return result.scoped && result.text === result.expected && !result.terminal && !result.address; }).toBe(true);
    };
    await reader.press('Control+a'); await expectArticle();
    await reader.click();
    await f.app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['control'] });
    });
    await expectArticle();
    await f.page.evaluate(() => window.getSelection()?.removeAllRanges());
    await f.page.locator('.application-menu button', { hasText: 'Edit' }).click();
    await f.page.locator('.application-menu-popup [data-menu-item-id="menu-select-all"]').click();
    await expectArticle();
    await f.page.screenshot({ path: test.info().outputPath('reader-selection-isolated.png') });
    // An address field keeps its own native Select All while Reader is active.
    const group = f.page.locator('.editor-group').filter({ has: tab });
    const address = group.getByRole('textbox', { name: 'Address or file path' });
    await address.click();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-select-all')!.click());
    expect(await address.evaluate(el => { const input = el as HTMLInputElement; return input.selectionEnd! - input.selectionStart! === input.value.length; })).toBe(true);
    await address.press('Escape');
    // The native find input also owns Ctrl+A; it must not select the shell DOM.
    await reader.press('Control+f'); const panel = await findOverlay(f.app);
    const find = panel.getByRole('textbox', { name: 'Find in web page' }); await find.fill('Paragraph');
    await f.app.evaluate(({ webContents }) => {
      const wc = webContents.getFocusedWebContents()!;
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['control'] });
    });
    await expect.poll(() => find.evaluate(el => { const input = el as HTMLInputElement; return [input.selectionStart, input.selectionEnd]; })).toEqual([0, 9]);
    await find.press('Escape');
    // Terminal Ctrl+A remains readline's beginning-of-line command.
    await shell.click(); await shell.pressSequentially(`printf unexpected > '${path.join(f.root, 'ctrl-a.txt')}'`);
    await shell.press('Control+a'); await shell.pressSequentially('#'); await shell.press('Control+e'); await shell.press('Enter');
    await run(`printf finished > '${path.join(f.root, 'finished.txt')}'`);
    await expect.poll(() => readFile(path.join(f.root, 'finished.txt'), 'utf8').catch(() => '')).toBe('finished');
    expect(await readFile(path.join(f.root, 'ctrl-a.txt'), 'utf8').catch(() => 'absent')).toBe('absent');
    // A live page retains native selection; it is independent of the shell.
    await group.getByRole('button', { name: 'Exit reader mode', exact: true }).click();
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/article`)!; wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['control'] });
    }, f.origin);
    await expect.poll(() => evaluatePage<string>(f.app, f.origin, 'window.getSelection().toString()')).toContain('Paragraph 39');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
