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
    // "Show in folder" opens a Setdown folder tab with the download selected, not the system file manager.
    const folderTab = f.page.getByRole('tab', { name: path.basename(f.root), exact: false });
    await expect(folderTab).toHaveAttribute('aria-selected', 'true');
    await expect(f.page.locator('.folder-content:not(.inactive) .folder-row[aria-selected="true"] .folder-label')).toHaveText('report.txt');
    expect(await f.app.evaluate(() => (globalThis as { downloadCalls?: string[] }).downloadCalls)).toEqual([`open:${f.root}/report.txt`]);
    await folderTab.getByTitle('Close tab', { exact: true }).click();
    await expect(folderTab).toHaveCount(0);
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


test('the Browser activity icon counts running and unseen downloads until the Downloads list shows them', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(({ session }, root) => {
      session.fromPartition('persist:setdown-browser').on('will-download', (_event, item) => item.setSavePath(`${root}/${item.getFilename()}`));
    }, f.root);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    const icon = f.page.getByRole('button', { name: 'Browser', exact: true });
    const badge = icon.locator('.download-activity-badge');
    await expect(badge).toHaveCount(0);
    // Another side view is open: the icon alone reports the transfer, like the Git count.
    const explorer = f.page.locator('.activity-bar button[aria-label="Explorer"]');
    await explorer.click();
    await expect(explorer).toHaveAttribute('aria-expanded', 'true');
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    await expect(badge).toHaveText('1');
    await expect(icon).toHaveAccessibleDescription('1 active or new download');
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    await expect(badge).toHaveText('2');
    await expect(icon).toHaveAccessibleDescription('2 active or new downloads');
    await expect(explorer).toHaveAttribute('aria-expanded', 'true');
    // The badged icon opens the Downloads list. Seeing it clears the finished file; the running one stays counted.
    await icon.click();
    const downloads = f.page.getByRole('button', { name: 'Downloads', exact: true });
    await expect(downloads).toHaveAttribute('aria-pressed', 'true');
    await expect(f.page.locator('.download').filter({ hasText: 'report.txt' })).toHaveAttribute('data-state', 'completed');
    await expect(badge).toHaveText('1');
    await expect(downloads.locator('.count')).toHaveText('1');
    f.finishDownloads();
    await expect(f.page.locator('.download').filter({ hasText: 'slow.txt' })).toHaveAttribute('data-state', 'completed');
    await expect(badge).toHaveCount(0);
    // A file that finishes while another section is shown stays counted until its list is opened.
    await f.page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    await expect(badge).toHaveText('1');
    await expect(downloads.locator('.count')).toHaveText('1');
    await downloads.click();
    await expect(badge).toHaveCount(0);
    await expect(downloads.locator('.count')).toHaveCount(0);
    // Stored downloads of an earlier session are not news.
    await f.restart();
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await expect(f.page.getByRole('button', { name: 'Browser', exact: true })).toBeVisible();
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.downloads()).length)).toBeGreaterThan(0);
    await expect(f.page.locator('.download-activity-badge')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { f.finishDownloads(); await f.dispose(); }
});

test('a download that starts while the side panel is closed opens its Downloads list', async () => {
  test.setTimeout(90_000);
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.app.evaluate(({ session }, root) => {
      session.fromPartition('persist:setdown-browser').on('will-download', (_event, item) => item.setSavePath(`${root}/${item.getFilename()}`));
    }, f.root);
    const panel = f.page.locator('.project-sidebar');
    const icon = f.page.locator('.activity-bar button[aria-label="Browser"]');
    const explorer = f.page.locator('.activity-bar button[aria-label="Explorer"]');
    const downloads = f.page.getByRole('button', { name: 'Downloads', exact: true });
    const rows = f.page.locator('.download');
    // The web page sits where the shell reserves room for it, beside whatever the side panel takes.
    const pageLeft = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin))
      .map(view => view.getBounds().x)[0], f.origin);
    const reservedLeft = () => f.page.locator('.group-body').first().evaluate(node => Math.round(node.getBoundingClientRect().left));
    // Hidden altogether.
    await expect(panel).toBeHidden();
    const hiddenLeft = await reservedLeft();
    await expect.poll(pageLeft).toBe(hiddenLeft);
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    await expect(icon).toHaveAttribute('aria-expanded', 'true');
    await expect(downloads).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.filter({ hasText: 'report.txt' })).toHaveAttribute('data-state', 'completed');
    // Shown and seen at once, so the download leaves nothing to count on the icon.
    await expect(icon.locator('.download-activity-badge')).toHaveCount(0);
    expect(await reservedLeft()).toBeGreaterThan(hiddenLeft + 200);
    await expect.poll(pageLeft).toBe(await reservedLeft());
    // The panel opens beside the work; it does not take the keyboard from it.
    expect(await f.page.evaluate(() => !!document.activeElement?.closest('.project-sidebar'))).toBe(false);
    // Collapsed to its icons, with another Browser section last shown.
    await f.page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await icon.click();
    await expect(icon).toHaveAttribute('aria-expanded', 'false');
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    await expect(icon).toHaveAttribute('aria-expanded', 'true');
    await expect(downloads).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(2);
    // Collapsed on another view, with the Clear browsing data panel left open behind it.
    await f.page.getByRole('button', { name: 'History', exact: true }).click();
    await f.page.getByRole('button', { name: 'Clear browsing data…', exact: true }).click();
    await explorer.click(); await explorer.click();
    await expect(explorer).toHaveAttribute('aria-expanded', 'false');
    await evaluatePage(f.app, f.origin, 'location.href="/slow-download";true');
    await expect(icon).toHaveAttribute('aria-expanded', 'true');
    await expect(downloads).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.filter({ hasText: 'slow.txt' })).toHaveAttribute('data-state', 'progressing');
    // An open panel belongs to what the user is reading there: the icon counts the download instead.
    await explorer.click();
    await expect(explorer).toHaveAttribute('aria-expanded', 'true');
    await evaluatePage(f.app, f.origin, 'location.href="/download";true');
    await expect(icon.locator('.download-activity-badge')).toHaveText('2');
    await expect(explorer).toHaveAttribute('aria-expanded', 'true');
    expect(f.errors).toEqual([]);
  } finally { f.finishDownloads(); await f.dispose(); }
});
