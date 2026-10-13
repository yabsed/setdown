import { expect, type Locator, type Page } from '@playwright/test';

/** Real pointer drag, including the native child-surface leave boundary. */
export async function dragTerminal(page: Page, tab: Locator, body: Locator, direction: 'right' | 'down' | 'center') {
  const from = (await tab.boundingBox())!, to = (await body.boundingBox())!;
  const x = from.x + Math.min(30, from.width / 2), y = from.y + from.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y + 12, { steps: 8 });
  await expect(page.locator('.shell')).toHaveClass(/is-tab-dragging/);
  await page.evaluate(({ x, y }) => window.dispatchEvent(new DragEvent('dragleave', {
    bubbles: true, clientX: x, clientY: y, relatedTarget: null,
  })), { x: x + 20, y: y + 12 });
  await page.mouse.move(to.x + to.width * (direction === 'right' ? .97 : .5),
    to.y + to.height * (direction === 'down' ? .97 : .5), { steps: 12 });
  await expect(page.locator('.group-drop-overlay')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
}
