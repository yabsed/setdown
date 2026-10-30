import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

async function chooseTheme(page: Page, id: string) {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('[data-menu-item-id="menu-theme"]').hover();
  await page.locator(`[data-menu-item-id="preview-theme-${id}"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
}

test('VS Code Dark 2026 matches workbench and syntax colors, retains edits and persists as an additional choice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-vscode-theme-'));
  const file = path.join(root, 'palette.ts');
  await writeFile(file, '// A theme comment\nexport class PaletteExample {\n  readonly label: string = "Dark 2026";\n  count = 42;\n  greet(name: string): string {\n    return name + this.label;\n  }\n}\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const launch = () => electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  let app = await launch();
  try {
    await focusApplication(app); let page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'github-light');
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await input.focus(); await input.press('Control+End'); await page.keyboard.insertText('//themeEdit');
    await page.evaluate(() => { (window as any).__themeEditor = document.querySelector('.editor-surface .monaco-editor'); });
    await chooseTheme(page, 'vscode-dark-2026');
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', 'rgb(18, 19, 20)');
    await expect(page.locator('.product-titlebar')).toHaveCSS('background-color', 'rgb(25, 26, 27)');
    await expect(page.locator('.project-sidebar')).toHaveCSS('background-color', 'rgb(25, 26, 27)');
    await expect(page.locator('.activity-bar')).toHaveCSS('background-color', 'rgb(25, 26, 27)');
    await expect(page.locator('.document-tab[aria-selected="true"]')).toHaveCSS('background-color', 'rgb(18, 19, 20)');
    await expect(page.locator('.location-bar')).toHaveCSS('background-color', 'rgb(18, 19, 20)');
    const colorOf = (text: string) => page.locator('.view-lines').first().evaluate((root, text) => {
      const span = [...root.querySelectorAll('.view-line > span > span')].find(span => span.textContent?.replace(/\u00a0/g, ' ').includes(text));
      return span ? { color: getComputedStyle(span).color, fontStyle: getComputedStyle(span).fontStyle } : null;
    }, text);
    await expect.poll(() => colorOf('A theme comment')).toEqual({ color: 'rgb(139, 148, 158)', fontStyle: 'normal' });
    await expect.poll(() => colorOf('PaletteExample')).toMatchObject({ color: 'rgb(78, 201, 176)' });
    // This fixture uses lexical TypeScript tokens. Negotiated LSP function
    // colors are exercised separately in language-features.spec.ts.
    await expect.poll(() => colorOf('42')).toMatchObject({ color: 'rgb(181, 206, 168)' });
    await expect.poll(() => colorOf('"Dark 2026"')).toMatchObject({ color: 'rgb(165, 214, 255)' });
    await expect(page.locator('.view-lines').first()).toContainText('themeEdit');
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.locator('[data-menu-item-id="menu-theme"]').hover();
    await expect(page.locator('[data-menu-item-id^="preview-theme-"]')).toHaveCount(9);
    await expect(page.locator('[data-menu-item-id="preview-theme-vscode-dark-2026"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.application-menu-popup')).toHaveCSS('background-color', 'rgb(32, 33, 34)');
    await page.keyboard.press('Escape');
    await chooseTheme(page, 'github-dark');
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', 'rgb(36, 41, 46)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background'))).toBe('');
    expect(await page.evaluate(() => (window as any).__themeEditor === document.querySelector('.editor-surface .monaco-editor'))).toBe(true);
    await input.focus(); await input.press('Control+z'); await expect(page.locator('.view-lines').first()).not.toContainText('themeEdit');
    await input.press('Control+y'); await expect(page.locator('.view-lines').first()).toContainText('themeEdit');
    await input.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toContain('//themeEdit');
    await chooseTheme(page, 'vscode-dark-2026');
    await input.focus(); await input.press('Control+Home'); await input.press('ArrowDown');
    await page.screenshot({ path: test.info().outputPath('vscode-dark-2026-editor.png') });
    await disposeApplication(app); app = await launch(); await focusApplication(app); page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'vscode-dark-2026');
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', 'rgb(18, 19, 20)');
    await expect(page.locator('.view-lines').first()).toContainText('themeEdit');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('VS Code Dark 2026 colors native Markdown and hidden previews without replacing the document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-vscode-preview-'));
  const file = path.join(root, 'theme.md');
  await writeFile(file, '# Dark 2026\n\n[Reference](https://example.com)\n\n> A quotation\n\n```python\n# A theme comment\nprint("hello")\n```\n\n$$a^2+b^2=c^2$$\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow(), reading = previews(app);
    await expect.poll(reading.hasVisible).toBe(true);
    const identity = await reading.evaluate('window.__themeIdentity = crypto.randomUUID()');
    const colors = () => reading.evaluate(`(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return { background: style('.markdown-preview').backgroundColor, text: style('.markdown-preview').color,
        link: style('.markdown-preview a').color, code: style('.markdown-preview pre').backgroundColor,
        comment: style('.token.comment').color, dark: document.body.dataset.previewTheme,
        math: document.querySelectorAll('.katex').length };
    })()`);
    await chooseTheme(page, 'vscode-dark-2026');
    await expect.poll(colors).toEqual({ background: 'rgb(18, 19, 20)', text: 'rgb(187, 190, 191)', link: 'rgb(72, 160, 199)',
      code: 'rgb(36, 37, 38)', comment: 'rgb(139, 148, 158)', dark: 'dark', math: 1 });
    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
        candidate.getVisible() && 'webContents' in candidate &&
        (candidate.webContents as Electron.WebContents).getURL().startsWith('marktex-preview://document/')) as Electron.WebContentsView;
      return (await view.webContents.capturePage()).toPNG();
    });
    await writeFile(test.info().outputPath('vscode-dark-2026-reader.png'), Buffer.from(capture));
    await chooseTheme(page, 'github-dark');
    await expect.poll(() => reading.evaluate("({body:getComputedStyle(document.body).backgroundColor, content:getComputedStyle(document.querySelector('.markdown-preview')).backgroundColor})"))
      .toEqual({ body: 'rgb(36, 41, 46)', content: 'rgba(0, 0, 0, 0)' });
    expect(await reading.evaluate("!!document.getElementById('setdown-vscode-preview-theme')")).toBe(false);
    await page.locator('.mode-toggle').click();
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await input.focus();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-vscode-dark-2026')!.click());
    await expect.poll(() => reading.evaluate('document.body.dataset.setdownPreviewTheme')).toBe('vscode-dark-2026');
    await expect(input).toBeFocused();
    expect(await reading.hasVisible()).toBe(false);
    await input.press('Escape'); await expect.poll(reading.hasVisible).toBe(true);
    expect(await reading.evaluate('window.__themeIdentity')).toBe(identity);
    await expect.poll(colors).toMatchObject({ background: 'rgb(18, 19, 20)', dark: 'dark', math: 1 });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
