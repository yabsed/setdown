import { expect, type Locator, type Page } from '@playwright/test';

/** The command list a person opens with F1 in an editor. */
export const commandList = (page: Page): Locator => page.getByRole('dialog', { name: 'Commands', exact: true });

/** Runs a command the way a person does: F1, its name, Enter. The name must be the first match,
 * so a test cannot pass by running a neighbouring command. */
export async function runCommand(page: Page, editor: Locator, name: string): Promise<void> {
  await editor.press('F1');
  const list = commandList(page), input = list.getByRole('searchbox');
  await input.fill(name);
  await expect(list.getByRole('option').first()).toContainText(name);
  await input.press('Enter');
  await expect(list).toBeHidden();
}

/** The menu at the cursor of a code file: what the language tool says applies there, then the
 * editing every text has. */
export const hereMenu = (page: Page): Locator => page.getByRole('dialog', { name: 'Actions here', exact: true });

/** The rows of the open menu as a person reads them: the group's name where a group begins, and the entry. */
export async function hereRows(page: Page): Promise<{ group: string; label: string }[]> {
  return hereMenu(page).getByRole('option').evaluateAll(rows => rows.map(row => ({
    group: row.querySelector('.group')?.textContent?.trim() ?? '', label: row.querySelector('.label')?.textContent?.trim() ?? '' })));
}
