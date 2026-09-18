import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication } from './electron-app';

test('promotes a lean preview when client-rendered diagrams are added', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-preview-runtime-e2e-'));
  const documentPath = path.join(temporaryRoot, 'runtime-transition.md');
  await writeFile(documentPath, '# Runtime transition\n\nPlain text.\n', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: path.join(temporaryRoot, 'config') },
  });

  try {
    const window = await application.firstWindow();
    const reading = previews(application);
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect.poll(() => reading.evaluate(
      "document.body.dataset.setdownPreviewRuntime || ''",
    )).toBe('lean');
    const [leanUrl] = await reading.urls();

    await window.locator('.mode-toggle').click();
    await expect(window.locator('.editor-surface')).toBeVisible();
    await window.locator('.monaco-editor').click({ position: { x: 120, y: 80 } });
    await window.keyboard.press('Control+End');
    await window.keyboard.insertText('\n```mermaid\ngraph TD\n  A --> B\n```\n');

    await expect.poll(() => reading.evaluate(
      "document.body.dataset.setdownPreviewRuntime || ''",
    ), { timeout: 15_000 }).toBe('crossnote');
    await expect.poll(async () => (await reading.urls())[0]).not.toBe(leanUrl);

    await window.keyboard.press('Escape');
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect.poll(reading.hasVisible).toBe(true);
    await expect.poll(() => reading.evaluate(
      "document.querySelectorAll('.markdown-preview[data-for=\"preview\"] .mermaid').length",
    )).toBe(1);
  } finally {
    await disposeApplication(application);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
