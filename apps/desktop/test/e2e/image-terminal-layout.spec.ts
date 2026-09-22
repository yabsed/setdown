import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposeApplication, focusApplication } from './electron-app';

test('fit image stays still beside the explorer and terminal', async () => {
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-image-terminal-'));
  const file = fileURLToPath(new URL('../../../../docs/assets/image1.png', import.meta.url));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    await focusApplication(app);
    const page = await app.firstWindow();
    await expect(page.getByRole('region', { name: 'Image reader' })).toHaveAttribute('data-image-ready', 'true');
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    const explorer = page.getByRole('button', { name: 'Explorer', exact: true });
    if (await explorer.getAttribute('aria-expanded') !== 'true') await explorer.click();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Integrated terminal' })).toBeVisible();
    // Previously both scrollbars appeared and disappeared, alternating fit size
    // every few frames after the terminal opened.
    const sizes = await page.evaluate(() => new Promise<number[]>((resolve) => {
      const image = document.querySelector('.image-surface img')!;
      const widths: number[] = [];
      const sample = () => {
        widths.push(image.getBoundingClientRect().width);
        if (widths.length < 60) requestAnimationFrame(sample);
        else resolve(widths);
      };
      requestAnimationFrame(sample);
    }));
    const steady = sizes.slice(15);
    expect(Math.max(...steady) - Math.min(...steady)).toBeLessThan(1);
  } finally { await disposeApplication(app); await rm(config, { recursive: true, force: true }); }
});
