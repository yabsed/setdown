import type { ExplorerSelection } from './explorer-selection';

const KEY = 'setdown:explorer-tree';
type TreeState = { root: string; selection: ExplorerSelection; focused: string; scroll: number;
  filter: string; showHidden: boolean; sort: 'name' | 'type' };
function restore(): TreeState {
  const empty: TreeState = { root: '', selection: { paths: [], anchor: '' }, focused: '', scroll: 0, filter: '', showHidden: true, sort: 'name' };
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    return { ...empty, root: typeof value.root === 'string' ? value.root : '',
      selection: { paths: Array.isArray(value.selection?.paths) ? value.selection.paths.filter((item: unknown) => typeof item === 'string') : [],
        anchor: typeof value.selection?.anchor === 'string' ? value.selection.anchor : '' },
      focused: typeof value.focused === 'string' ? value.focused : '',
      scroll: Number.isFinite(value.scroll) ? Math.max(0, value.scroll) : 0,
      showHidden: value.showHidden !== false, sort: value.sort === 'type' ? 'type' : 'name' };
  } catch { return empty; }
}
// The view can unmount when Search/Git is selected without losing tree state.
export const tree = $state(restore());
export function rememberTree(): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(tree)); } catch { /* Storage is optional. */ }
}
export const under = (candidate: string, root: string) => candidate === root
  || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
export function selectPaths(paths: string[]): void {
  tree.selection = { paths, anchor: paths[0] ?? '' }; tree.focused = paths[0] ?? ''; rememberTree();
}
export function remapTree(from: string, to: string): void {
  const remap = (value: string) => under(value, from) ? `${to}${value.slice(from.length)}` : value;
  tree.selection = { paths: tree.selection.paths.map(remap), anchor: remap(tree.selection.anchor) };
  tree.focused = remap(tree.focused); rememberTree();
}
