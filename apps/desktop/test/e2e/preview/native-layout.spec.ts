import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fixture } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

for (const kind of ['markdown', 'website'] as const) {
  test(`${kind} follows content position changes without a window or pane resize`, async () => {
    const f = await fixture(kind === 'markdown');
    try {
      if (kind === 'website') await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      const prefix = kind === 'markdown' ? 'marktex-preview://document/' : `${f.origin}/first`;
      let nativeId: number | null = null;
      const native = () => f.app.evaluate(({ BrowserWindow }, { prefix, id }) => {
        const owner = BrowserWindow.getAllWindows()[0];
        const view = owner.contentView.children.find(view => 'webContents' in view && view.getVisible()
          && (view as Electron.WebContentsView).webContents.getURL().startsWith(prefix)
          && (id === null || (view as Electron.WebContentsView).webContents.id === id)) as Electron.WebContentsView | undefined;
        return view ? { id: view.webContents.id, bounds: view.getBounds() } : null;
      }, { prefix, id: nativeId });
      await expect.poll(native).not.toBeNull();
      const initial = (await native())!;
      nativeId = initial.id;
      await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isLoading(), initial.id)).toBe(false);
      await f.app.evaluate(async ({ webContents }, id) => {
        await webContents.fromId(id)!.executeJavaScript(`(() => {
          window.__layoutClicks = 0;
          const marker = document.createElement('canvas'); marker.width = 64; marker.height = 64;
          marker.style.cssText = 'position:fixed;left:20px;top:20px;width:64px;height:64px;z-index:2147483647';
          const context = marker.getContext('2d'); context.fillStyle = '#168648'; context.fillRect(0, 0, 64, 64);
          marker.onclick = () => window.__layoutClicks++;
          document.body.append(marker);
        })()`);
      }, initial.id);
      // The background half of a split has its own geometry. Its layout can
      // change while both the area and the focused reader retain their size.
      if (kind === 'markdown') {
        await writeFile(`${f.root}/second.md`, '# Second reader\n\nKeep both groups visible.\n');
        await f.page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), `${f.root}/second.md`);
      } else await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
      const second = f.page.getByRole('tab', { name: kind === 'markdown' ? /second\.md/ : /Second page/ });
      await expect(second).toHaveAttribute('aria-selected', 'true');
      const transfer = await f.page.evaluateHandle(() => new DataTransfer());
      await second.dispatchEvent('dragstart', { dataTransfer: transfer });
      const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
      const drop = { dataTransfer: transfer, clientX: box.x + box.width * .98, clientY: box.y + box.height / 2 };
      await body.dispatchEvent('dragover', drop); await body.dispatchEvent('drop', drop);
      await second.dispatchEvent('dragend', { dataTransfer: transfer }); await transfer.dispose();
      await expect(f.page.locator('.editor-group')).toHaveCount(2);
      const follows = async () => {
        const expected = (await body.boundingBox())!, current = await native();
        return current?.id === initial.id && Object.entries(expected).every(([key, value]) =>
          Math.abs(current.bounds[key as keyof typeof current.bounds] - value) <= 1);
      };
      await expect.poll(follows).toBe(true);
      const splitBounds = (await native())!.bounds;
      // A layout publication during a temporarily unavailable background host
      // hides its native child. Restoring that host must show the same reader
      // again even though the window, area and focused reader never resize.
      await body.evaluate(node => { (node as HTMLElement).style.display = 'none'; });
      await second.click();
      await expect.poll(native).toBeNull();
      await body.evaluate(node => { (node as HTMLElement).style.display = ''; });
      try {
        await expect.poll(follows).toBe(true);
      } finally {
        await writeFile(test.info().outputPath('restored-layout.json'), JSON.stringify({
          expected: await body.boundingBox(), actual: await native(),
        }, null, 2));
      }
      for (const offset of [32, 16, 0]) {
        // A late layout pass can move a surface without resizing it. Neither
        // the old area ResizeObserver nor the reader's size observer sees this.
        await f.page.evaluate(offset => new Promise<void>(resolve => requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('.editor-area')!.style.transform = `translateY(-${offset}px)`;
          resolve();
        })), offset);
        const expected = (await body.boundingBox())!;
        await expect.poll(async () => {
          const current = await native();
          return current?.id === initial.id && Object.entries(expected).every(([key, value]) =>
            Math.abs(current.bounds[key as keyof typeof current.bounds] - value) <= 1);
        }).toBe(true);
        expect((await native())!.bounds.width).toBe(splitBounds.width);
        expect((await native())!.bounds.height).toBe(splitBounds.height);
      }
      for (const offset of [16, 0]) {
        await body.evaluate((node, offset) => { (node as HTMLElement).style.transform = `translateY(-${offset}px)`; }, offset);
        await expect.poll(follows).toBe(true);
        expect((await native())!.bounds.width).toBe(splitBounds.width);
        expect((await native())!.bounds.height).toBe(splitBounds.height);
      }
      const bounds = (await native())!.bounds;
      const point = await f.app.evaluate(({ BrowserWindow }, bounds) => {
        const owner = BrowserWindow.getAllWindows()[0].getContentBounds();
        return { x: owner.x + bounds.x + 50, y: owner.y + bounds.y + 50 };
      }, bounds);
      // Screen capture includes native composition; capturePage() can wake a
      // stuck reader and would hide the regression under test.
      const capture = async () => Buffer.from(await f.app.evaluate(async ({ desktopCapturer, screen }) => {
        const display = screen.getPrimaryDisplay();
        return (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size }))
          .find(source => source.display_id === String(display.id))!.thumbnail.toPNG().toString('base64');
      }), 'base64');
      await expect.poll(async () => [...await sharp(await capture())
        .extract({ left: Math.round(point.x), top: Math.round(point.y), width: 1, height: 1 })
        .removeAlpha().raw().toBuffer()]).toEqual([22, 134, 72]);
      await writeFile(test.info().outputPath('native-layout.png'), await capture());
      await nativeInput({ click: point });
      await expect.poll(() => f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!
        .executeJavaScript('window.__layoutClicks'), initial.id)).toBe(1);
      expect(f.errors).toEqual([]);
    } finally { await f.dispose(); }
  });
}
