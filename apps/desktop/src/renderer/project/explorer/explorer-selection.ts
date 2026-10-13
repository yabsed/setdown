export type ExplorerSelection = { paths: string[]; anchor: string };

/** Range selection follows the visible tree order, including expanded children. */
export function selectEntry(selection: ExplorerSelection, path: string, visible: string[],
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}): ExplorerSelection {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  const current = selection.paths.filter(path => visible.includes(path));
  if (modifiers.shiftKey) {
    const anchor = visible.includes(selection.anchor) ? selection.anchor : path;
    const start = visible.indexOf(anchor), end = visible.indexOf(path);
    const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { paths: additive ? [...new Set([...current, ...range])] : range, anchor };
  }
  return { paths: additive
    ? current.includes(path) ? current.filter(item => item !== path) : [...current, path]
    : [path], anchor: path };
}

/** A selected folder carries its descendants; never move or trash them twice. */
export function topLevelPaths(paths: string[]): string[] {
  return [...new Set(paths)].filter(path => !paths.some(parent => parent !== path
    && (path.startsWith(`${parent}/`) || path.startsWith(`${parent}\\`))));
}

export const PROJECT_ENTRIES = 'application/x-setdown-project-entries';
export const PROJECT_FILES = 'application/x-setdown-project-files';
export function draggedPaths(transfer: DataTransfer | null, listType: string, legacyType: string): string[] {
  if (!transfer) return [];
  const list = transfer.getData(listType);
  if (list) {
    try {
      const value: unknown = JSON.parse(list);
      return Array.isArray(value) && value.every(path => typeof path === 'string' && path.length > 0)
        ? [...new Set(value)] : [];
    } catch { return []; }
  }
  const single = transfer.getData(legacyType);
  return single ? [single] : [];
}
