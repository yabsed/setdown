/** Editor groups own selection; the workspace owns documents and command focus. */
export type SplitDirection = 'left' | 'right' | 'up' | 'down';
export type Group = { id: string; tabs: string[]; activeId: string | null };
export type GroupTree = { kind: 'group'; id: string } | {
  kind: 'split'; id: string; axis: 'x' | 'y'; ratio: number; first: GroupTree; second: GroupTree;
};
export type GroupBox = { id: string; x: number; y: number; width: number; height: number };
export type SashBox = GroupBox & { axis: 'x' | 'y'; ratio: number };

export function groupLayout(tree: GroupTree, box = { x: 0, y: 0, width: 100, height: 100 }) {
  const groups: GroupBox[] = [], sashes: SashBox[] = [];
  function visit(node: GroupTree, rect: typeof box) {
    if (node.kind === 'group') { groups.push({ id: node.id, ...rect }); return; }
    sashes.push({ id: node.id, axis: node.axis, ratio: node.ratio, ...rect });
    const horizontal = node.axis === 'x';
    visit(node.first, { ...rect, width: horizontal ? rect.width * node.ratio : rect.width,
      height: horizontal ? rect.height : rect.height * node.ratio });
    visit(node.second, { x: rect.x + (horizontal ? rect.width * node.ratio : 0),
      y: rect.y + (horizontal ? 0 : rect.height * node.ratio),
      width: horizontal ? rect.width * (1 - node.ratio) : rect.width,
      height: horizontal ? rect.height : rect.height * (1 - node.ratio) });
  }
  visit(tree, box);
  return { groups, sashes };
}

/** VS Code DropOverlay: 10% edge activation, thirds choose direction at corners. */
export function splitDirection(x: number, y: number, width: number, height: number): SplitDirection | null {
  if (width <= 0 || height <= 0) return null;
  const px = x / width, py = y / height;
  if (px > .1 && px < .9 && py > .1 && py < .9) return null;
  return px < 1 / 3 ? 'left' : px > 2 / 3 ? 'right' : py < .5 ? 'up' : 'down';
}

export class EditorGroups {
  private serial = 0;
  readonly groups: Group[] = [{ id: 'group-0', tabs: [], activeId: null }];
  tree: GroupTree = { kind: 'group', id: 'group-0' };
  focusedId = 'group-0';
  get focused() { return this.groups.find(g => g.id === this.focusedId)!; }
  owner(tabId: string) { return this.groups.find(g => g.tabs.includes(tabId)); }
  add(tabId: string) { if (!this.owner(tabId)) this.focused.tabs.push(tabId); }
  activate(tabId: string) {
    const group = this.owner(tabId);
    if (group) { group.activeId = tabId; this.focusedId = group.id; }
  }
  remove(tabId: string) {
    const group = this.owner(tabId);
    if (!group) return;
    const index = group.tabs.indexOf(tabId);
    group.tabs.splice(index, 1);
    if (group.activeId === tabId) group.activeId = group.tabs[Math.min(index, group.tabs.length - 1)] ?? null;
    this.prune();
  }
  move(tabId: string, targetId: string, direction: SplitDirection | null, index?: number) {
    const source = this.owner(tabId), target = this.groups.find(g => g.id === targetId);
    if (!source || !target) return;
    // Splitting a group's sole tab back into itself leaves exactly the same group.
    if (source === target && source.tabs.length === 1 && direction) return;
    let destination = target;
    if (direction) {
      destination = { id: `group-${++this.serial}`, tabs: [], activeId: null };
      this.groups.push(destination);
      const before = direction === 'left' || direction === 'up';
      const leaf: GroupTree = { kind: 'group', id: destination.id };
      const replace = (node: GroupTree): GroupTree => node.kind === 'group'
        ? node.id === targetId ? { kind: 'split', id: `split-${++this.serial}`, axis: direction === 'left' || direction === 'right' ? 'x' : 'y',
          ratio: .5, first: before ? leaf : node, second: before ? node : leaf } : node
        : { ...node, first: replace(node.first), second: replace(node.second) };
      this.tree = replace(this.tree);
    }
    const from = source.tabs.indexOf(tabId);
    source.tabs.splice(from, 1);
    if (source.activeId === tabId) source.activeId = source.tabs[Math.min(from, source.tabs.length - 1)] ?? null;
    let at = index ?? destination.tabs.length;
    if (source === destination && index !== undefined && from < at) at--;
    destination.tabs.splice(Math.max(0, Math.min(at, destination.tabs.length)), 0, tabId);
    this.activate(tabId);
    this.prune();
  }
  resize(id: string, ratio: number) {
    const visit = (node: GroupTree): void => {
      if (node.kind === 'group') return;
      if (node.id === id && Number.isFinite(ratio)) node.ratio = Math.max(.1, Math.min(.9, ratio));
      else { visit(node.first); visit(node.second); }
    };
    visit(this.tree);
  }
  private prune() {
    if (this.groups.length === 1) return;
    const empty = new Set(this.groups.filter(g => !g.tabs.length).map(g => g.id));
    const prune = (node: GroupTree): GroupTree | null => {
      if (node.kind === 'group') return empty.has(node.id) ? null : node;
      const first = prune(node.first), second = prune(node.second);
      return first && second ? { ...node, first, second } : first ?? second;
    };
    const tree = prune(this.tree);
    if (!tree) return;
    this.tree = tree;
    for (let i = this.groups.length - 1; i >= 0; i--) if (empty.has(this.groups[i].id)) this.groups.splice(i, 1);
    if (!this.groups.some(g => g.id === this.focusedId)) this.focusedId = groupLayout(tree).groups[0].id;
  }
}
