import type { FolderSort } from './folder-presentation';

/** A folder tab's context menus: one for the selected entries, one for the folder itself. */
export type FolderMenuCommand = 'open' | 'open-tab' | 'open-side' | 'open-external' | 'open-with' | 'open-location'
  | 'cut' | 'copy' | 'duplicate' | 'copy-path' | 'rename' | 'extract' | 'compress' | 'restore' | 'trash' | 'delete'
  | 'bookmark' | 'open-workspace' | 'open-terminal' | 'properties'
  | 'new-folder' | 'new-file' | 'paste' | 'undo' | 'select-all' | 'view-list' | 'view-grid' | 'show-hidden'
  | `sort-${FolderSort}` | 'reverse' | 'refresh' | 'empty-trash' | 'copy-folder-path';

export type FolderMenuContext = {
  /** `entry`: the selection, opened on one of its rows. `folder`: the folder shown, opened on empty space. */
  target: 'entry' | 'folder';
  /** The folder shown is the trash. */
  trash: boolean;
  /** The entry, or the folder shown, is bookmarked. */
  bookmarked: boolean;
  /** Entry menu: the row's kind, whether it is the whole selection, and whether the selection has a non-folder. */
  kind: 'directory' | 'document' | 'file';
  single: boolean;
  files: boolean;
  /** Entry menu: Open answers a chooser request instead of opening. */
  chooses: boolean;
  /** Entry menu: the row is a search result, so it has a folder of its own to go to. */
  search: boolean;
  /** Entry menu: one archive file is selected. */
  archive: boolean;
  /** Folder menu: what can change here. */
  writable: boolean;
  clipboard: boolean;
  multiple: boolean;
  empty: boolean;
  /** Folder menu: the current view. */
  layout: 'list' | 'grid';
  showHidden: boolean;
  sort: FolderSort;
  descending: boolean;
};

export type FolderMenuItem = { type: 'separator' }
  | { type: 'command'; command: FolderMenuCommand; label: string; enabled: boolean; accelerator?: string; checked?: boolean; role?: 'radio' | 'checkbox' };

const SORTS: Array<[FolderSort, string]> = [['name', 'Name'], ['modified', 'Modified'], ['size', 'Size'], ['type', 'Kind']];

/** The context arrives over IPC: keep only the fields and values this menu understands. */
export function readFolderMenuContext(value: unknown): FolderMenuContext | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.target !== 'entry' && input.target !== 'folder') return null;
  const flag = (key: keyof FolderMenuContext) => input[key] === true;
  return {
    target: input.target, trash: flag('trash'), bookmarked: flag('bookmarked'),
    kind: input.kind === 'directory' || input.kind === 'document' ? input.kind : 'file',
    single: flag('single'), files: flag('files'), chooses: flag('chooses'), search: flag('search'), archive: flag('archive'),
    writable: flag('writable'), clipboard: flag('clipboard'), multiple: flag('multiple'), empty: flag('empty'),
    layout: input.layout === 'grid' ? 'grid' : 'list', showHidden: flag('showHidden'),
    sort: SORTS.find(([sort]) => sort === input.sort)?.[0] ?? 'name', descending: flag('descending'),
  };
}

export function folderMenu(context: FolderMenuContext): FolderMenuItem[] {
  const item = (command: FolderMenuCommand, label: string, accelerator?: string, enabled = true): FolderMenuItem =>
    ({ type: 'command', command, label, enabled, ...(accelerator ? { accelerator } : {}) });
  const toggle = (command: FolderMenuCommand, label: string, checked: boolean, role: 'radio' | 'checkbox', accelerator?: string): FolderMenuItem =>
    ({ type: 'command', command, label, enabled: true, checked, role, ...(accelerator ? { accelerator } : {}) });
  const { single, trash } = context;
  const directory = single && context.kind === 'directory';
  const sections: FolderMenuItem[][] = context.target === 'entry' ? [
    [item('open', context.chooses ? 'Choose' : 'Open'),
      ...(directory ? [item('open-tab', 'Open in New Tab'), item('open-side', 'Open to the Side')]
        : single && context.kind === 'document' ? [item('open-side', 'Open to the Side')] : []),
      ...(context.files ? [item('open-external', 'Open with Default Application'), item('open-with', 'Open With…')] : []),
      ...(context.search && single ? [item('open-location', 'Open Item Location')] : [])],
    [item('cut', 'Cut', 'CmdOrCtrl+X'), item('copy', 'Copy', 'CmdOrCtrl+C'), item('duplicate', 'Duplicate', 'CmdOrCtrl+D'), item('copy-path', 'Copy Path')],
    [...(single ? [item('rename', 'Rename', 'F2')] : []),
      ...(single && context.kind !== 'directory' && context.archive ? [item('extract', 'Extract Here')] : []),
      item('compress', 'Compress to .zip'),
      trash ? item('restore', 'Restore') : item('trash', 'Move to Trash', 'Delete'),
      item('delete', 'Delete Permanently', 'Shift+Delete')],
    [...(directory ? [item('bookmark', context.bookmarked ? 'Remove Bookmark' : 'Add to Bookmarks'), item('open-workspace', 'Open as Workspace Folder')] : []),
      item('open-terminal', 'Open in Terminal')],
    single ? [item('properties', 'Properties', 'Alt+Enter')] : [],
  ] : [
    [item('new-folder', 'New Folder', 'CmdOrCtrl+Shift+N', context.writable && !trash), item('new-file', 'New File', undefined, context.writable && !trash),
      item('paste', 'Paste', 'CmdOrCtrl+V', context.clipboard && context.writable), item('undo', 'Undo File Operation', 'CmdOrCtrl+Z'),
      item('select-all', 'Select All', 'CmdOrCtrl+A', context.multiple)],
    [toggle('view-list', 'List View', context.layout === 'list', 'radio', 'CmdOrCtrl+1'), toggle('view-grid', 'Grid View', context.layout === 'grid', 'radio', 'CmdOrCtrl+2'),
      toggle('show-hidden', 'Show Hidden Files', context.showHidden, 'checkbox', 'CmdOrCtrl+H'),
      ...SORTS.map(([sort, label]) => toggle(`sort-${sort}`, `Sort by ${label}`, context.sort === sort, 'radio')),
      toggle('reverse', 'Reverse Order', context.descending, 'checkbox'), item('refresh', 'Refresh', 'F5')],
    [...(trash ? [item('empty-trash', 'Empty Trash', undefined, !context.empty)]
      : [item('bookmark', context.bookmarked ? 'Remove Bookmark' : 'Bookmark This Folder'), item('open-workspace', 'Open as Workspace Folder')]),
      item('open-terminal', 'Open in Terminal'), item('copy-folder-path', 'Copy Folder Path')],
    [item('properties', 'Properties')],
  ];
  return sections.filter(section => section.length).flatMap((section, index) => index ? [{ type: 'separator' as const }, ...section] : section);
}
