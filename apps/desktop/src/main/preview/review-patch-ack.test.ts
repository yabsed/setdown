import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { PreviewManager, type PreviewViewState } from './preview-manager';
vi.mock('electron', () => ({ ipcMain: {}, WebContentsView: class {} }));
vi.mock('./review-preparation', () => ({ ReviewPreparation: class { receive() {} } }));

function manager() {
  const previews = new PreviewManager({ preload: '', stateFor: () => null, theme: () => 'paper',
    themeAssets: () => { throw new Error('unused'); }, forgetTab() {} });
  previews.views.set('review', { ownerWebContentsId: 1,
    view: { webContents: { id: 2 } } } as unknown as PreviewViewState);
  return previews;
}
test('an error acknowledgment rejects instead of promoting an uninstalled patch', async () => {
  const previews = manager();
  const pending = previews.waitForUpdate('review', 8, true);
  const rejected = assert.rejects(pending, /wrong base/);
  previews.receive(2, { type: 'marktex:html-updated', revision: 8, error: 'wrong base' });
  await rejected;
});
test('a late patch ACK cannot satisfy a new-revision full-reset waiter', async () => {
  const previews = manager(); let done = false;
  const pending = previews.waitForUpdate('review', 9, true).then(() => { done = true; });
  previews.receive(2, { type: 'marktex:html-updated', revision: 8 });
  await Promise.resolve(); assert.equal(done, false);
  previews.receive(2, { type: 'marktex:html-updated', revision: 9 });
  await pending; assert.equal(done, true);
});
