import { expect, test, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../test/support/electron/electron-app';

// A one-off look at what the app shows around a code file. Not a test of record; removed after the run.
// AUDIT_PROJECT, AUDIT_FILE, AUDIT_TOOL (name=path), AUDIT_PREFIX (F1 prefix), AUDIT_OUT, AUDIT_WORD (a word to act on),
// AUDIT_COMMANDS (F1 titles separated by |).
test('audit: what is shown around one code file', async () => {
  const env0 = process.env, out = env0.AUDIT_OUT!, tag = env0.AUDIT_TAG!;
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-audit-'));
  const project = path.join(root, 'project'), bin = path.join(root, 'bin'), file = path.join(project, env0.AUDIT_FILE!);
  await cp(env0.AUDIT_PROJECT!, project, { recursive: true }); await mkdir(bin); await mkdir(out, { recursive: true });
  const [toolName, toolPath] = env0.AUDIT_TOOL!.split('=');
  await symlink(toolPath, path.join(bin, toolName));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = env0;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config'), SETDOWN_LSP_INHERIT_ENV: '1', PATH: `${bin}${path.delimiter}${env.PATH ?? ''}` } });
  const notes: string[] = [];
  const note = (line: string) => { notes.push(line); console.log(line); };
  const shot = (page: Page, name: string) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(editor).toBeVisible();
    const chip = page.getByRole('button', { name: /^Language status:/ });
    await expect(page.locator('.editor-host').first()).toHaveAttribute('data-language-server', 'ready', { timeout: 200_000 });
    await page.waitForTimeout(8000);
    note(`chip at rest: ${await chip.getAttribute('aria-label')}`);
    await shot(page, '1-rest');
    // The status panel and what is behind More…
    await chip.click(); const panel = page.getByRole('dialog').first(); await expect(panel).toBeVisible();
    note(`panel summary: ${(await panel.innerText()).replace(/\s+/g, ' ')}`); await shot(page, '2-panel');
    await panel.getByRole('button', { name: 'More…', exact: true }).click(); await page.waitForTimeout(500);
    note(`panel details: ${(await panel.innerText()).replace(/\s+/g, ' ').slice(0, 1500)}`); await shot(page, '3-details');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // The command list.
    await editor.focus(); await editor.press('F1');
    const input = page.locator('.quick-input-box input'); await input.fill('>'); await page.waitForTimeout(600);
    const size = async () => page.locator('.quick-input-list .monaco-list-row').first().getAttribute('aria-setsize');
    note(`F1 all commands: ${await size()}`); await shot(page, '4-f1-all');
    await input.fill(`>${env0.AUDIT_PREFIX}`); await page.waitForTimeout(600);
    note(`F1 "${env0.AUDIT_PREFIX}": ${await size()}`); await shot(page, '5-f1-tool');
    await page.keyboard.press('Escape');
    // The editor's menu on a word.
    const box = await page.evaluate(word => {
      const walker = document.createTreeWalker(document.querySelector('.view-lines')!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf(word); if (at < 0) continue;
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + word.length);
        const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return null;
    }, env0.AUDIT_WORD!);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' }); await page.waitForTimeout(700);
      const menu = page.locator('.context-view .monaco-menu, [role="menu"]').first();
      note(`context menu: ${(await menu.innerText().catch(() => '(none found)')).replace(/\s*\n\s*/g, ' | ')}`); await shot(page, '6-menu');
      await page.keyboard.press('Escape');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(300);
    } else note(`word ${env0.AUDIT_WORD} not found on screen`);
    // Each named command, and the form its result takes.
    let n = 7;
    for (const title of (env0.AUDIT_COMMANDS ?? '').split('|').filter(Boolean)) {
      await editor.focus(); await editor.press('F1'); await input.fill(`>${title}`); await page.waitForTimeout(500);
      const first = (await page.locator('.quick-input-list .monaco-list-row').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      await input.press('Enter'); await page.waitForTimeout(3500);
      const dialogs = await page.getByRole('dialog').allInnerTexts().catch(() => [] as string[]);
      const alerts = await page.getByRole('alert').allInnerTexts().catch(() => [] as string[]);
      const tabs = await page.getByRole('tab').allInnerTexts().catch(() => [] as string[]);
      note(`command "${title}" (row: ${first.slice(0, 80)}) -> dialogs=${JSON.stringify(dialogs.map(d => d.replace(/\s+/g, ' ').slice(0, 160)))} alerts=${JSON.stringify(alerts.map(a => a.replace(/\s+/g, ' ').slice(0, 160)))} tabs=${JSON.stringify(tabs.map(t => t.replace(/\s+/g, ' ')))}`);
      await shot(page, `${n++}-${title.replace(/[^A-Za-z]+/g, '-').toLowerCase()}`);
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
    // The Language Support side view.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click(); await page.waitForTimeout(1500);
    const sidebar = page.getByRole('region', { name: 'Language Support', exact: true });
    note(`language support view: ${(await sidebar.innerText().catch(() => '(not found)')).replace(/\s*\n\s*/g, ' | ').slice(0, 1800)}`);
    await shot(page, '99-language-support-view');
  } finally {
    await writeFile(path.join(out, `${tag}-notes.txt`), notes.join('\n') + '\n');
    await disposeApplication(application); await rm(root, { recursive: true, force: true });
  }
});
