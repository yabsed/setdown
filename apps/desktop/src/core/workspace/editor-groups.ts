/** Editor groups own selection; the workspace owns documents and command focus. */
export type SplitDirection = 'left' | 'right' | 'up' | 'down';
export type EditorGroupPlacement = { groupId: string; direction: SplitDirection | null; index?: number };
export type EditorOpenOptions = { pinned?: boolean; groupId?: string; side?: boolean };
/** `sticky` counts the leading tabs that are pinned to the start of the strip. */
export type Group = { id: string; tabs: string[]; activeId: string | null; previewId: string | null; sticky: number };
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

/** Body grid: left/up/up/right above left/down/down/right. Position alone owns the guide. */
export function splitDirection(x: number, y: number, width: number, height: number): SplitDirection | null {
  if (![x, y, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return null;
  const px = x / width, py = y / height;
  return px < .25 ? 'left' : px >= .75 ? 'right' : py < .5 ? 'up' : 'down';
}

export class EditorGroups {
  private serial = 0;
  readonly groups: Group[] = [{ id: 'group-0', tabs: [], activeId: null, previewId: null, sticky: 0 }];
  tree: GroupTree = { kind: 'group', id: 'group-0' };
  focusedId = 'group-0';
  private maximized: { tree: GroupTree; id: string } | null = null;
  get displayTree(): GroupTree { return this.maximized ? { kind: 'group', id: this.maximized.id } : this.tree; }
  equalize(): void {
    this.maximized = null;
    const visit = (node: GroupTree): void => { if (node.kind === 'split') { node.ratio = .5; visit(node.first); visit(node.second); } };
    visit(this.tree);
  }
  pruneEmpty(): void { this.prune(); }
  toggleMaximize(): void { this.maximized = this.maximized ? null : { tree: this.tree, id: this.focusedId }; }
  get focused() { return this.groups.find(g => g.id === this.focusedId)!; }
  owner(tabId: string) { return this.groups.find(g => g.tabs.includes(tabId)); }
  /** VS Code EditorGroupModel: one replaceable preview per group; other tabs stay pinned. */
  add(tabId: string, pinned = true, groupId = this.focusedId): string | null {
    if (this.owner(tabId)) return null;
    const group = this.groups.find(group => group.id === groupId);
    if (!group) throw Error('The target editor group was closed.');
    const previous = pinned ? null : group.previewId;
    let at = group.activeId ? group.tabs.indexOf(group.activeId) + 1 : group.tabs.length;
    if (previous) {
      const index = group.tabs.indexOf(previous);
      group.tabs.splice(index, 1);
      if (at > index) at--;
      if (group.activeId === previous) group.activeId = tabId;
    }
    group.tabs.splice(Math.max(at, group.sticky), 0, tabId);
    if (!pinned) group.previewId = tabId;
    return previous;
  }
  isPinned(tabId: string): boolean { return this.owner(tabId)?.previewId !== tabId; }
  pin(tabId: string): boolean {
    const group = this.owner(tabId);
    if (!group || group.previewId !== tabId) return false;
    group.previewId = null;
    return true;
  }
  isSticky(tabId: string): boolean {
    const group = this.owner(tabId);
    return !!group && group.tabs.indexOf(tabId) < group.sticky;
  }
  /** VS Code EditorGroupModel.stick: a pinned tab joins the end of the leading sticky tabs. */
  stick(tabId: string): boolean {
    const group = this.owner(tabId);
    if (!group || this.isSticky(tabId)) return false;
    this.pin(tabId);
    group.tabs.splice(group.tabs.indexOf(tabId), 1);
    group.tabs.splice(group.sticky++, 0, tabId);
    return true;
  }
  /** The released tab becomes the first ordinary tab, so it does not jump across the strip. */
  unstick(tabId: string): boolean {
    const group = this.owner(tabId);
    if (!group || !this.isSticky(tabId)) return false;
    group.tabs.splice(group.tabs.indexOf(tabId), 1);
    group.tabs.splice(--group.sticky, 0, tabId);
    return true;
  }
  activate(tabId: string) {
    const group = this.owner(tabId);
    if (group) { group.activeId = tabId; this.focusedId = group.id; if (this.maximized) this.maximized.id = group.id; }
  }
  split(targetId: string, direction: SplitDirection): Group {
    this.maximized = null;
    if (!this.groups.some(group => group.id === targetId)) throw Error('The target editor group was closed.');
    const destination: Group = { id: `group-${++this.serial}`, tabs: [], activeId: null, previewId: null, sticky: 0 };
    this.groups.push(destination);
    const before = direction === 'left' || direction === 'up';
    const leaf: GroupTree = { kind: 'group', id: destination.id };
    const replace = (node: GroupTree): GroupTree => node.kind === 'group'
      ? node.id === targetId ? { kind: 'split', id: `split-${++this.serial}`, axis: direction === 'left' || direction === 'right' ? 'x' : 'y',
        ratio: .5, first: before ? leaf : node, second: before ? node : leaf } : node
      : { ...node, first: replace(node.first), second: replace(node.second) };
    this.tree = replace(this.tree);
    return destination;
  }
  /** The nearest group that shares an edge with the target on that side, if any. */
  neighbor(targetId: string, direction: SplitDirection): Group | null {
    const boxes = groupLayout(this.tree).groups, target = boxes.find(box => box.id === targetId);
    if (!target) throw Error('The target editor group was closed.');
    const horizontal = direction === 'left' || direction === 'right', before = direction === 'left' || direction === 'up';
    const start = (box: GroupBox) => horizontal ? box.x : box.y, extent = (box: GroupBox) => horizontal ? box.width : box.height;
    const crossStart = (box: GroupBox) => horizontal ? box.y : box.x, crossExtent = (box: GroupBox) => horizontal ? box.height : box.width;
    const found = boxes.filter(box => box.id !== targetId
      && (before ? start(box) + extent(box) <= start(target) + .001 : start(box) >= start(target) + extent(target) - .001)
      && crossStart(box) < crossStart(target) + crossExtent(target) && crossStart(box) + crossExtent(box) > crossStart(target))
      .sort((a, b) => before ? start(b) + extent(b) - start(a) - extent(a) || crossStart(a) - crossStart(b) : start(a) - start(b) || crossStart(a) - crossStart(b))[0];
    return found ? this.groups.find(group => group.id === found.id)! : null;
  }
  side(targetId: string): Group { return this.neighbor(targetId, 'right') ?? this.split(targetId, 'right'); }
  /**
   * A group on screen next to the target, for a transient tab that should leave the target's
   * tab in view: right, then left, below, above. Null when the target is the only group shown.
   */
  beside(targetId: string): Group | null {
    if (this.maximized) return null;
    for (const direction of ['right', 'left', 'down', 'up'] as const) {
      const found = this.neighbor(targetId, direction);
      if (found) return found;
    }
    return null;
  }
  remove(tabId: string) {
    const group = this.owner(tabId);
    if (!group) return;
    const index = group.tabs.indexOf(tabId);
    group.tabs.splice(index, 1);
    if (index < group.sticky) group.sticky--;
    if (group.previewId === tabId) group.previewId = null;
    if (group.activeId === tabId) group.activeId = group.tabs[Math.min(index, group.tabs.length - 1)] ?? null;
    this.prune();
  }
  move(tabId: string, targetId: string, direction: SplitDirection | null, index?: number) {
    const source = this.owner(tabId), target = this.groups.find(g => g.id === targetId);
    if (!source || !target) return;
    this.pin(tabId);
    // Splitting a group's sole tab back into itself leaves exactly the same group.
    if (source === target && source.tabs.length === 1 && direction) return;
    let destination = target;
    if (direction) destination = this.split(targetId, direction);
    const from = source.tabs.indexOf(tabId), sticky = from < source.sticky;
    source.tabs.splice(from, 1);
    if (sticky) source.sticky--;
    if (source.activeId === tabId) source.activeId = source.tabs[Math.min(from, source.tabs.length - 1)] ?? null;
    let at = index ?? destination.tabs.length;
    if (source === destination && index !== undefined && from < at) at--;
    at = Math.max(0, Math.min(at, destination.tabs.length));
    // VS Code: reordering past the sticky tabs releases a pin and dropping among them creates one;
    // a pinned tab that changes groups stays pinned there.
    const stick = source === destination && index !== undefined
      ? at < destination.sticky || (sticky && at === destination.sticky)
      : sticky || (index !== undefined && at < destination.sticky);
    destination.tabs.splice(stick ? Math.min(at, destination.sticky) : Math.max(at, destination.sticky), 0, tabId);
    if (stick) destination.sticky++;
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
    if (this.maximized && !this.groups.find(group => group.id === this.maximized?.id)?.tabs.length) this.maximized = null;
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
