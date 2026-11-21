import { expect, type Page } from '@playwright/test';

type MenuName = 'File' | 'View' | 'Edit' | 'Window';

/** The one menu button in the top-left tab strip; File, View, Edit and Window are its submenus. */
export const applicationMenuButton = (page: Page) => page.getByRole('button', { name: 'Application menu', exact: true });

/**
 * Opens one of the four menus the way a pointer does: the menu button, then that menu's row.
 * Over a live web page the menu paints in its own native layer, so the row is clicked where it appeared.
 * The opened menu's items are then found in that same page or layer, as before.
 */
export async function openApplicationMenu(page: Page, name: MenuName): Promise<void> {
  await applicationMenuButton(page).click();
  const layers = () => [page, ...page.context().pages().filter(layer => layer !== page && layer.url().includes('menu-overlay=1'))];
  const row = (layer: Page) => layer.locator(`[data-menu-item-id="application-menu-${name.toLowerCase()}"]`);
  const shown = async () => {
    for (const layer of layers()) if (await row(layer).isVisible().catch(() => false)) return layer;
    return null;
  };
  await expect.poll(async () => !!await shown()).toBe(true);
  await row((await shown())!).click();
}
