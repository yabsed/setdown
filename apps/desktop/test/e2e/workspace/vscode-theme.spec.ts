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
    await expect(page.locator('[data-menu-item-id^="preview-theme-"]')).toHaveCount(16);
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

const communityThemes = [
  { id: 'github-light-high-contrast', background: 'rgb(255, 255, 255)', foreground: 'rgb(14, 17, 22)',
    comment: 'rgb(102, 112, 123)', string: 'rgb(3, 37, 99)', link: 'rgb(3, 73, 180)' },
  { id: 'vscode-light-2026', background: 'rgb(255, 255, 255)', foreground: 'rgb(32, 32, 32)',
    comment: 'rgb(110, 119, 129)', string: 'rgb(10, 48, 105)', link: 'rgb(0, 105, 204)' },
  { id: 'light-owl', background: 'rgb(251, 251, 251)', foreground: 'rgb(64, 63, 83)',
    comment: 'rgb(106, 113, 129)', string: 'rgb(72, 118, 214)', link: 'rgb(40, 142, 215)' },
  { id: 'atom-one-light', background: 'rgb(250, 250, 250)', foreground: 'rgb(56, 58, 66)',
    comment: 'rgb(105, 108, 119)', string: 'rgb(80, 161, 79)', link: 'rgb(64, 120, 242)' },
  { id: 'github-dark-high-contrast', background: 'rgb(10, 12, 16)', foreground: 'rgb(240, 243, 246)',
    comment: 'rgb(189, 196, 204)', string: 'rgb(173, 220, 255)', link: 'rgb(113, 183, 255)' },
  { id: 'night-owl', background: 'rgb(1, 22, 39)', foreground: 'rgb(214, 222, 235)',
    comment: 'rgb(124, 144, 144)', string: 'rgb(236, 196, 141)', link: 'rgb(130, 170, 255)' },
  { id: 'dracula', background: 'rgb(40, 42, 54)', foreground: 'rgb(248, 248, 242)',
    comment: 'rgb(130, 147, 191)', string: 'rgb(241, 250, 140)', link: 'rgb(139, 233, 253)' },
];
for (const theme of communityThemes) test(`${theme.id} colors editor and retained native readers, preserves Undo, focus and restart`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-community-theme-'));
  const file = path.join(root, 'colors.ts'), markdown = path.join(root, 'colors.md');
  await writeFile(file, '// A theme comment\nconst greeting = "palette";\n');
  await writeFile(markdown, '# Theme colors\n\n[Reference](https://example.com)\n\n> Quotation\n\n```python\n# A theme comment\nprint("palette")\n```\n\n$$a^2+b^2=c^2$$\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const launch = () => electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  let app = await launch();
  try {
    await focusApplication(app); let page = await app.firstWindow();
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await input.focus(); await input.press('Control+End'); await page.keyboard.insertText('//keepThemeUndo');
    const identity = await page.locator('.editor-surface .monaco-editor').elementHandle();
    await chooseTheme(page, theme.id);
    const appearance = ['github-light-high-contrast', 'vscode-light-2026', 'light-owl', 'atom-one-light'].includes(theme.id) ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', theme.background);
    await expect(page.locator('.view-line span span').filter({ hasText: 'A theme comment' }).first()).toHaveCSS('color', theme.comment);
    await expect(page.locator('.view-line span span').filter({ hasText: '"palette"' }).first()).toHaveCSS('color', theme.string);
    expect(await identity!.evaluate(node => node === document.querySelector('.editor-surface .monaco-editor'))).toBe(true);
    await input.focus(); await input.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('keepThemeUndo');
    await input.press('Control+y'); await expect(page.locator('.view-lines')).toContainText('keepThemeUndo');
    await input.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toContain('keepThemeUndo');
    await page.screenshot({ path: test.info().outputPath(`${theme.id}-editor.png`) });
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
    const reading = previews(app);
    await expect.poll(reading.hasVisible).toBe(true);
    const readerIdentity = await reading.evaluate('window.__themeIdentity = crypto.randomUUID()');
    const colors = () => reading.evaluate(`(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return { background: style('.markdown-preview').backgroundColor, foreground: style('.markdown-preview').color,
        link: style('.markdown-preview a').color, comment: style('.token.comment').color,
        math: document.querySelectorAll('.katex').length };
    })()`);
    const expected = { background: theme.background, foreground: theme.foreground, link: theme.link, comment: theme.comment, math: 1 };
    await expect.poll(colors).toEqual(expected);
    expect(await reading.evaluate('document.body.dataset.previewTheme')).toBe(appearance);
    // Switching directly between imports must replace the colors of the same
    // style node; returning to a legacy theme must remove that override.
    const other = communityThemes.find(candidate => candidate.id !== theme.id)!;
    await chooseTheme(page, other.id);
    await expect.poll(colors).toMatchObject({ background: other.background, comment: other.comment });
    await chooseTheme(page, 'github-light');
    expect(await reading.evaluate("!!document.getElementById('setdown-vscode-preview-theme')")).toBe(false);
    await page.locator('.mode-toggle').click(); await input.focus();
    await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme.id);
    await expect.poll(() => reading.evaluate('document.body.dataset.setdownPreviewTheme')).toBe(theme.id);
    await expect(input).toBeFocused(); expect(await reading.hasVisible()).toBe(false);
    await input.press('Escape'); await expect.poll(reading.hasVisible).toBe(true);
    await expect.poll(colors).toEqual(expected);
    expect(await reading.evaluate('window.__themeIdentity')).toBe(readerIdentity);
    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(candidate =>
        candidate.getVisible() && 'webContents' in candidate &&
        (candidate.webContents as Electron.WebContents).getURL().startsWith('marktex-preview://document/')) as Electron.WebContentsView;
      return (await view.webContents.capturePage()).toPNG();
    });
    await writeFile(test.info().outputPath(`${theme.id}-reader.png`), Buffer.from(capture));
    await disposeApplication(app); app = await launch(); await focusApplication(app); page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', theme.background);
    await expect(page.locator('.view-lines').first()).toContainText('keepThemeUndo');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
