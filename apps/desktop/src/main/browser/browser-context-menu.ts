import { clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { isWebURL } from '../../core/browser/browser-url';

/** A native menu captures its source document/frame, never the selected tab.
 * Pass native hit-test coordinates through unchanged, including at non-100% zoom. */
export function browserContextMenu(contents: WebContents, params: ContextMenuParams,
  valid: () => boolean, open: (url: string, background: boolean) => void,
  navigation: (direction: -1 | 1) => void, canBack: boolean, canForward: boolean): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  // Electron event payloads may expose native accessors. Snapshot plain values
  // while the event is live; callbacks must not dereference its native storage.
  params = { ...params, frame: params.frame, linkURL: params.linkURL, srcURL: params.srcURL,
    selectionText: params.selectionText, editFlags: { ...params.editFlags }, dictionarySuggestions: [...params.dictionarySuggestions] };
  const frame = params.frame, frameURL = frame?.url;
  const current = () => valid() && !!frame && !frame.isDestroyed() && frame.url === frameURL;
  const action = (label: string, run: () => void | Promise<void>, enabled = true): MenuItemConstructorOptions => ({ label, enabled,
    click: () => { if (current()) { try { void Promise.resolve(run()).catch(console.error); } catch (error) { console.error(error); } } } });
  const edit = (label: string, run: () => void, enabled: boolean) => action(label, () => {
    if (contents.focusedFrame === frame) run();
  }, enabled);
  const separator = () => { if (items.length) items.push({ type: 'separator' }); };
  if (isWebURL(params.linkURL)) {
    items.push(action('Open Link in New Tab', () => open(params.linkURL, true)),
      action('Open Link in Foreground Tab', () => open(params.linkURL, false)),
      action('Copy Link Address', () => clipboard.writeText(params.linkURL)),
      action('Save Link As…', () => contents.downloadURL(params.linkURL)));
  } else if (/^mailto:/i.test(params.linkURL)) {
    items.push(action('Copy Email Address', () => {
      const address = params.linkURL.slice(7).split('?')[0];
      let decoded = address;
      try { decoded = decodeURIComponent(address); } catch { /* Keep malformed escapes literal. */ }
      return clipboard.writeText(decoded);
    }));
  }
  if (params.mediaType === 'image') {
    separator();
    items.push(action('Copy Image', () => contents.copyImageAt(params.x, params.y), params.hasImageContents),
      action('Copy Image Address', () => clipboard.writeText(params.srcURL), !!params.srcURL));
    if (isWebURL(params.srcURL)) items.push(action('Open Image in New Tab', () => open(params.srcURL, true)));
    if (/^(https?:|data:image\/|blob:)/i.test(params.srcURL)) items.push(action('Save Image As…', () => contents.downloadURL(params.srcURL)));
  }
  if (params.isEditable) {
    separator();
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) items.push(edit(suggestion, () => contents.replaceMisspelling(suggestion), true));
    if (params.misspelledWord) {
      items.push(action('Add to Dictionary', () => { contents.session.addWordToSpellCheckerDictionary(params.misspelledWord); }));
      separator();
    }
    // Native editing commands follow the focused frame. If focus moved while
    // the menu was open, decline instead of editing another frame's form.
    items.push(edit('Undo', () => contents.undo(), params.editFlags.canUndo), edit('Redo', () => contents.redo(), params.editFlags.canRedo),
      { type: 'separator' }, edit('Cut', () => contents.cut(), params.editFlags.canCut), edit('Copy', () => contents.copy(), params.editFlags.canCopy),
      edit('Paste', () => contents.paste(), params.editFlags.canPaste), edit('Paste as Plain Text', () => contents.pasteAndMatchStyle(), params.editFlags.canPaste),
      edit('Select All', () => contents.selectAll(), params.editFlags.canSelectAll));
  } else if (params.selectionText) { separator(); items.push(edit('Copy', () => contents.copy(), params.editFlags.canCopy)); }
  // Do not turn a password selection into a search query.
  const selection = params.formControlType === 'input-password' ? '' : params.selectionText.trim().slice(0, 1000);
  if (selection) items.push(action(`Search for “${selection.slice(0, 40)}${selection.length > 40 ? '…' : ''}”`,
    () => open(`https://www.google.com/search?q=${encodeURIComponent(selection)}`, false)));
  separator();
  items.push(action('Back', () => navigation(-1), canBack), action('Forward', () => navigation(1), canForward),
    action('Reload', () => contents.reload()), action('Reload Without Cache', () => contents.reloadIgnoringCache()));
  return items;
}
