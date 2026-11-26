import { expect, type Locator, type Page } from '@playwright/test';
import type { TestApplication } from '../electron/electron-app';

/** Exercise the original toolbar command at the existing split size. */
export async function clickLocationAction(_app: TestApplication, page: Page, name: string,
  group: Locator = page.locator('.editor-group.focused')) {
  const button = group.getByRole('button', { name, exact: true, includeHidden: true });
  // Wait for the command to become available after tab loading.
  await expect.poll(async () => await button.count() === 1
    && await button.evaluate(element => !element.closest('[hidden]'))).toBe(true);
  await button.click();
}

/**
 * Start typing an address with the pointer. A file address is links to its folders, so the middle
 * of the field may be one of them; the clear button at its end never is.
 */
export async function clearAddress(address: Locator) {
  await address.locator('xpath=..').getByRole('button', { name: 'Clear address', exact: true }).click();
  await expect(address).toBeFocused();
  await expect(address).toHaveValue('');
}
