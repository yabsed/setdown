import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('downloads expose native progress and controls, retain completed files across restart, and remove only records', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(({ session, shell }, root) => {
      session.fromPartition('persist:setdown-browser').on('will-download', (_event, item) => item.setSavePath(`${root}/${item.getFilename()}`));
      // Exercise main's path handling without launching external apps/windows.
      const calls: string[] = [];
      (globalThis as { downloadCalls?: string[] }).downloadCalls = calls;
      shell.openPath = async file => { calls.push(`open:${file}`); return ''; };
      shell.showItemInFolder = file => { calls.push(`show:${file}`); };
    }, f.root);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    let report = f.page.locator('.download').filter({ hasText: 'report.txt' });
    await expect(report).toHaveAttribute('data-state', 'completed');
    expect(await readFile(path.join(f.root, 'report.txt'), 'utf8')).toBe('Downloaded by Setdown.');
    await report.getByRole('button', { name: 'Open download: report.txt', exact: true }).click();
    await report.getByRole('button', { name: 'Show download in folder: report.txt', exact: true }).click();
    expect(await f.app.evaluate(() => (globalThis as { downloadCalls?: string[] }).downloadCalls))
      .toEqual([`open:${f.root}/report.txt`, `show:${f.root}/report.txt`]);
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    const slow = f.page.locator('.download').filter({ hasText: 'slow.txt' });
    await expect(slow).toHaveAttribute('data-state', 'progressing');
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.downloads()).find(item => item.name === 'slow.txt')?.received)).toBeGreaterThan(0);
    await slow.getByRole('button', { name: 'Pause download: slow.txt', exact: true }).click();
    await expect(slow.locator('.status')).toContainText('Paused');
    await slow.getByRole('button', { name: 'Resume download: slow.txt', exact: true }).click();
    await expect(slow.locator('.status')).toContainText('Downloading');
    f.finishDownloads();
    await expect(slow).toHaveAttribute('data-state', 'completed');
    expect((await readFile(path.join(f.root, 'slow.txt'))).length).toBe(262144);
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    const progressing = f.page.locator('.download[data-state="progressing"]');
    await progressing.getByRole('button', { name: 'Cancel download: slow.txt', exact: true }).click();
    await expect(progressing).toHaveCount(0);
    await expect(f.page.locator('.download[data-state="cancelled"]')).toHaveCount(1);
    await f.restart();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Downloads', exact: true }).click();
    report = f.page.locator('.download').filter({ hasText: 'report.txt' });
    await expect(report).toHaveAttribute('data-state', 'completed');
    await report.getByRole('button', { name: 'Remove download: report.txt', exact: true }).click();
    await expect(report).toHaveCount(0);
    expect(await readFile(path.join(f.root, 'report.txt'), 'utf8')).toBe('Downloaded by Setdown.');
    expect(f.errors).toEqual([]);
  } finally { f.finishDownloads(); await f.dispose(); }
});

