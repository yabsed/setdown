import { expect, type Locator, type Page } from '@playwright/test';
import type { TestApplication } from '../electron/electron-app';

/** Exercise the displayed UI at the existing split size, including overflow. */
export async function clickLocationAction(app: TestApplication, page: Page, name: string,
  group: Locator = page.locator('.editor-group.focused')) {
  const button = group.getByRole('button', { name, exact: true, includeHidden: true });
  // As with a normal locator click, wait for the command to become available
  // after tab loading. CSS overflow hiding is distinct from a hidden command.
  await expect.poll(async () => await button.count() === 1
    && await button.evaluate(element => !element.closest('[hidden]'))).toBe(true);
  if (await button.isVisible()) { await button.click(); return; }
  await group.getByRole('button', { name: 'More page actions', exact: true }).click();
  await expect.poll(() => app.windows().some(window => window.url().includes('location-overlay=1'))).toBe(true);
  const panel = app.windows().find(window => window.url().includes('location-overlay=1'))!;
  await panel.getByRole('menuitem', { name, exact: true }).click();
}
