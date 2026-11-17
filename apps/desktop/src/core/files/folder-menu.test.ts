import { expect, it } from 'vitest';
import { folderMenu, readFolderMenuContext, type FolderMenuContext, type FolderMenuItem } from './folder-menu';

const base: FolderMenuContext = { target: 'entry', trash: false, bookmarked: false, kind: 'file', single: true, files: true, chooses: false,
  search: false, archive: false, writable: true, clipboard: false, multiple: true, empty: false, layout: 'list', showHidden: false, sort: 'name', descending: false };
const rows = (items: FolderMenuItem[]): string[] => items.map(item => item.type === 'separator' ? '-'
  : `${item.role ? (item.checked ? '(x) ' : '( ) ') : ''}${item.label}${item.enabled ? '' : ' (off)'}${item.accelerator ? ` [${item.accelerator}]` : ''}`);
const commands = (items: FolderMenuItem[]) => items.flatMap(item => item.type === 'command' ? [item.command] : []);

it('lists a file row\'s commands in the order of the folder tab', () => {
  expect(rows(folderMenu(base))).toEqual([
    'Open', 'Open with Default Application', 'Open With…', '-',
    'Cut [CmdOrCtrl+X]', 'Copy [CmdOrCtrl+C]', 'Duplicate [CmdOrCtrl+D]', 'Copy Path', '-',
    'Rename [F2]', 'Compress to .zip', 'Move to Trash [Delete]', 'Delete Permanently [Shift+Delete]', '-',
    'Open in Terminal', '-',
    'Properties [Alt+Enter]',
  ]);
});

it('offers what the selection allows: folders, documents, archives, search results, choosers and trash', () => {
  expect(rows(folderMenu({ ...base, kind: 'directory', files: false, bookmarked: true }))).toEqual([
    'Open', 'Open in New Tab', 'Open to the Side', '-',
    'Cut [CmdOrCtrl+X]', 'Copy [CmdOrCtrl+C]', 'Duplicate [CmdOrCtrl+D]', 'Copy Path', '-',
    'Rename [F2]', 'Compress to .zip', 'Move to Trash [Delete]', 'Delete Permanently [Shift+Delete]', '-',
    'Remove Bookmark', 'Open as Workspace Folder', 'Open in Terminal', '-',
    'Properties [Alt+Enter]',
  ]);
  expect(rows(folderMenu({ ...base, kind: 'directory', files: false }))).toContain('Add to Bookmarks');
  expect(rows(folderMenu({ ...base, kind: 'document' })).slice(0, 4)).toEqual(['Open', 'Open to the Side', 'Open with Default Application', 'Open With…']);
  expect(rows(folderMenu({ ...base, archive: true }))).toContain('Extract Here');
  expect(rows(folderMenu({ ...base, kind: 'directory', archive: true }))).not.toContain('Extract Here');
  expect(rows(folderMenu({ ...base, search: true }))).toContain('Open Item Location');
  expect(rows(folderMenu({ ...base, chooses: true }))[0]).toBe('Choose');
  // Several rows: nothing that needs exactly one, and a folder among them is not opened beside.
  const several = rows(folderMenu({ ...base, kind: 'directory', single: false, search: true, archive: true }));
  for (const label of ['Open in New Tab', 'Open to the Side', 'Open Item Location', 'Rename [F2]', 'Extract Here', 'Add to Bookmarks', 'Open as Workspace Folder', 'Properties [Alt+Enter]'])
    expect(several).not.toContain(label);
  expect(several.at(-1)).toBe('Open in Terminal');
  const trashed = rows(folderMenu({ ...base, trash: true }));
  expect(trashed).toContain('Restore'); expect(trashed).not.toContain('Move to Trash [Delete]');
});

it('lists the folder\'s own commands with the current view checked', () => {
  expect(rows(folderMenu({ ...base, target: 'folder', layout: 'grid', showHidden: true, sort: 'size', descending: true, clipboard: true }))).toEqual([
    'New Folder [CmdOrCtrl+Shift+N]', 'New File', 'Paste [CmdOrCtrl+V]', 'Undo File Operation [CmdOrCtrl+Z]', 'Select All [CmdOrCtrl+A]', '-',
    '( ) List View [CmdOrCtrl+1]', '(x) Grid View [CmdOrCtrl+2]', '(x) Show Hidden Files [CmdOrCtrl+H]',
    '( ) Sort by Name', '( ) Sort by Modified', '(x) Sort by Size', '( ) Sort by Kind', '(x) Reverse Order', 'Refresh [F5]', '-',
    'Bookmark This Folder', 'Open as Workspace Folder', 'Open in Terminal', 'Copy Folder Path', '-',
    'Properties',
  ]);
  const locked = rows(folderMenu({ ...base, target: 'folder', writable: false, clipboard: true, multiple: false, bookmarked: true }));
  expect(locked).toEqual(expect.arrayContaining(['New Folder (off) [CmdOrCtrl+Shift+N]', 'New File (off)', 'Paste (off) [CmdOrCtrl+V]', 'Select All (off) [CmdOrCtrl+A]', 'Remove Bookmark']));
  expect(rows(folderMenu({ ...base, target: 'folder' }))).toContain('Paste (off) [CmdOrCtrl+V]');
  const trash = rows(folderMenu({ ...base, target: 'folder', trash: true, empty: true }));
  expect(trash).toEqual(expect.arrayContaining(['New Folder (off) [CmdOrCtrl+Shift+N]', 'Empty Trash (off)', 'Open in Terminal']));
  expect(trash).not.toContain('Bookmark This Folder'); expect(trash).not.toContain('Open as Workspace Folder');
  expect(rows(folderMenu({ ...base, target: 'folder', trash: true }))).toContain('Empty Trash');
});

it('names every command once per menu', () => {
  for (const context of [base, { ...base, kind: 'directory' as const, files: false, search: true }, { ...base, target: 'folder' as const }, { ...base, target: 'folder' as const, trash: true }]) {
    const list = commands(folderMenu(context));
    expect(new Set(list).size).toBe(list.length);
  }
});

it('reads a context from IPC, keeping only known fields and values', () => {
  expect(readFolderMenuContext(base)).toEqual(base);
  expect(readFolderMenuContext({ target: 'folder', layout: 'grid', sort: 'modified', descending: true, kind: 'directory', label: 'Injected', writable: 'yes' })).toEqual({
    ...base, target: 'folder', kind: 'directory', single: false, files: false, writable: false, multiple: false, layout: 'grid', sort: 'modified', descending: true });
  expect(readFolderMenuContext({ target: 'entry', kind: 'socket', layout: 'tiles', sort: 'owner' })).toMatchObject({ kind: 'file', layout: 'list', sort: 'name' });
  for (const value of [null, undefined, 'entry', 7, [], {}, { target: 'tab' }]) expect(readFolderMenuContext(value)).toBeNull();
});
