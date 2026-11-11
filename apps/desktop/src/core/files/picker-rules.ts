import type { PathPickerFilter, PathPickerRequest } from './folder-types';

/**
 * Picker acceptance rules.
 *
 * Ported from GNOME Files (GPL-3.0-or-later): `mode_can_accept_files`,
 * `nautilus_file_chooser_can_accept` and `action_accept` in
 * vendor/nautilus/src/nautilus-file-chooser.c, plus the name validator in
 * nautilus-filename-validator.c. The extension postfix follows VS Code's
 * SimpleFileDialog `addPostfix` (MIT, vendor/vscode/.../simpleFileDialog.ts).
 */
export type PickerItem = { path: string; directory: boolean };
type Rules = Pick<PathPickerRequest, 'kind' | 'files' | 'folders' | 'multiple'>;

/** Every selected item must match the request; single requests take exactly one. */
export function canAcceptSelection(request: Rules, selection: PickerItem[]): boolean {
  if (request.kind !== 'open' || !selection.length) return false;
  if (!request.multiple && selection.length !== 1) return false;
  return selection.every(item => item.directory ? request.folders : request.files);
}

/** Folder requests may accept the folder being shown; virtual places cannot be chosen. */
export function canAcceptCurrentFolder(request: Rules, current: { virtual?: boolean }): boolean {
  return request.kind === 'open' && request.folders && !current.virtual;
}

export function canAccept(request: Rules, selection: PickerItem[], current: { path: string; virtual?: boolean }, name?: NameCheck): boolean {
  if (request.kind === 'save') return !!name?.valid && !current.virtual;
  return canAcceptSelection(request, selection) || canAcceptCurrentFolder(request, current);
}

/** Nautilus returns the selection when it fits, otherwise the current folder. */
export function acceptedPaths(request: Rules, selection: PickerItem[], current: { path: string; virtual?: boolean }): string[] {
  if (canAcceptSelection(request, selection)) return selection.map(item => item.path);
  return canAcceptCurrentFolder(request, current) ? [current.path] : [];
}

/** Double-click/Enter on a file accepts it directly when the request takes files. */
export function activationAccepts(request: Rules, item: PickerItem): boolean {
  return request.kind === 'open' && !item.directory && request.files;
}

const extensionOf = (name: string) => name.includes('.') && !name.startsWith('.') ? name.slice(name.indexOf('.') + 1).toLowerCase() : '';

export function matchesFilter(name: string, filter: PathPickerFilter | null): boolean {
  if (!filter || !filter.extensions.length || filter.extensions.includes('*')) return true;
  const lower = name.toLowerCase();
  return filter.extensions.some(extension => lower.endsWith(`.${extension.toLowerCase()}`));
}

/** Filters narrow files only. Folders always stay visible so the user can navigate. */
export function visibleInPicker(entry: { name: string; directory: boolean }, request: Rules, filter: PathPickerFilter | null): boolean {
  if (entry.directory) return true;
  if (request.kind === 'open' && !request.files) return true;
  return matchesFilter(entry.name, filter);
}

export type NameCheck = { valid: boolean; message?: string; warning?: string; exists?: 'file' | 'directory' };

/** Live save-name feedback with Nautilus's wording. */
export function checkName(name: string, existing?: { directory: boolean } | null, separator: '/' | '\\' = '/'): NameCheck {
  if (!name) return { valid: false };
  if (name.includes('/') || (separator === '\\' && name.includes('\\'))) return { valid: false, message: `File names cannot contain “${separator}”` };
  if (name === '.' || name === '..') return { valid: false, message: 'A file cannot be called “.” or “..”' };
  if (name.includes('\0')) return { valid: false, message: 'File names cannot contain a NUL character' };
  if (new TextEncoder().encode(name).length > 255) return { valid: false, message: 'File name is too long' };
  if (existing?.directory) return { valid: false, message: 'A folder with that name already exists', exists: 'directory' };
  const warning = existing ? 'A file with that name already exists' : name.startsWith('.') ? 'Files with “.” at the beginning of their name are hidden' : undefined;
  return { valid: true, ...(warning ? { warning } : {}), ...(existing ? { exists: 'file' as const } : {}) };
}

/** Append the active filter's first extension when the typed name matches none. */
export function withFilterExtension(name: string, filters: PathPickerFilter[], active: PathPickerFilter | null): string {
  if (!active || !active.extensions.length || active.extensions.includes('*')) return name;
  if (filters.some(filter => filter.extensions.includes('*') ? false : matchesFilter(name, filter))) return name;
  return `${name}.${active.extensions[0]}`;
}

/** Select the base name only, as GNOME Files and VS Code do for Save. */
export function nameSelection(name: string): [number, number] {
  const extension = extensionOf(name);
  return [0, extension ? name.length - extension.length - 1 : name.length];
}
