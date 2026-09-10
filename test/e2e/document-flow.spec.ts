import { _electron as electron, expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('opens in Viewer, enters Monaco on double click, and returns with Escape', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marktex-e2e-'));
  const markdownPath = path.join(directory, '한 편의 문서.md');
  await fs.writeFile(
    markdownPath,
    '# 처음 보이는 제목\n\n더블 클릭해서 고칠 문단입니다.\n\n- 첫 항목\n- 둘째 항목\n\n<img src="missing.png" onerror="document.body.dataset.pwned = \'yes\'">\n',
    'utf8',
  );

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    args: [
      '.',
      markdownPath,
      `--user-data-dir=${path.join(directory, 'profile')}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
    env: environment,
  });

  try {
    const page = await application.firstWindow();
    page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => console.error(`[renderer:error] ${error.message}`));
    await test.step('the document opens in Viewer', async () => {
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
    });
    const preview = page.frameLocator('.preview-frame');
    const visiblePreview = preview.locator('.markdown-preview[data-for="preview"]');
    const paragraph = visiblePreview.getByText('더블 클릭해서 고칠 문단입니다.');
    await test.step('Crossnote displays the paragraph', async () => {
      await expect(paragraph).toBeVisible({ timeout: 20_000 });
      await expect(preview.locator('body')).not.toHaveAttribute('data-pwned', 'yes');
      await expect(preview.locator('[onerror]')).toHaveCount(0);
    });

    await test.step('double click enters Monaco', async () => {
      await paragraph.dblclick({ force: true });
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
      await expect(page.locator('.monaco-editor')).toBeVisible();
      await page.keyboard.type('Edited: ');
    });

    await test.step('Escape returns to Viewer', async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
      await expect(
        visiblePreview.getByText('Edited: 더블 클릭해서 고칠 문단입니다.'),
      ).toBeVisible();
    });

    await test.step('save writes the edited model to disk', async () => {
      await application.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('save')?.click();
      });
      await expect.poll(() => fs.readFile(markdownPath, 'utf8')).toContain(
        'Edited: 더블 클릭해서 고칠 문단입니다.',
      );
    });
  } finally {
    const childProcess = application.process();
    const exited = childProcess.exitCode === null
      ? new Promise<void>((resolve) => childProcess.once('exit', () => resolve()))
      : Promise.resolve();
    await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (childProcess.exitCode === null) childProcess.kill();
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
