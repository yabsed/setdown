import { expect, test, vi } from 'vitest';
import type { ContextMenuParams, WebContents } from 'electron';
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));
import { clipboard } from 'electron';
import { browserContextMenu } from './browser-context-menu';
function fixture(overrides: Partial<ContextMenuParams> = {}) {
  const frame = { url: 'https://site.test/frame', isDestroyed: () => false };
  const wc = { focusedFrame: frame, copyImageAt: vi.fn(), pasteAndMatchStyle: vi.fn(), downloadURL: vi.fn(), copy: vi.fn() };
  const params = { frame, x: 35, y: 49, linkURL: '', srcURL: '', selectionText: '', mediaType: 'none', isEditable: false,
    dictionarySuggestions: [], editFlags: { canPaste: true, canCopy: true }, ...overrides } as ContextMenuParams;
  const valid = vi.fn(() => true), open = vi.fn();
  const menu = browserContextMenu(wc as unknown as WebContents, params, valid, open, vi.fn(), false, false);
  const click = (label: string) => menu.find(item => item.label === label)!.click!({} as never, {} as never, {} as never);
  return { wc, frame, menu, valid, open, click };
}
test('copies actual image pixels without rescaling hit-test coordinates; downloads stay native', () => {
  const f = fixture({ mediaType: 'image', srcURL: 'https://site.test/pic.png', hasImageContents: true });
  f.click('Copy Image'); expect(f.wc.copyImageAt).toHaveBeenCalledWith(35, 49);
  f.click('Save Image As…'); expect(f.wc.downloadURL).toHaveBeenCalledWith('https://site.test/pic.png');
  f.click('Open Image in New Tab'); expect(f.open).toHaveBeenCalledWith('https://site.test/pic.png', true);
  f.valid.mockReturnValue(false); f.click('Copy Image'); expect(f.wc.copyImageAt).toHaveBeenCalledTimes(1);
});
test('native editing refuses changed frames and navigated menu targets', () => {
  const f = fixture({ isEditable: true });
  f.click('Paste as Plain Text'); expect(f.wc.pasteAndMatchStyle).toHaveBeenCalledTimes(1);
  f.wc.focusedFrame = { ...f.frame }; f.click('Paste as Plain Text'); expect(f.wc.pasteAndMatchStyle).toHaveBeenCalledTimes(1);
  f.frame.url = 'https://site.test/another'; f.click('Paste as Plain Text'); expect(f.wc.pasteAndMatchStyle).toHaveBeenCalledTimes(1);
});
test('mail addresses omit query parameters; password selections have no search action', () => {
  const f = fixture({ linkURL: 'mailto:user%2Btag@example.com?subject=Secret' }); f.click('Copy Email Address');
  expect(clipboard.writeText).toHaveBeenCalledWith('user+tag@example.com');
  expect(fixture({ selectionText: 'password', formControlType: 'input-password' }).menu.some(item => item.label?.startsWith('Search'))).toBe(false);
});
