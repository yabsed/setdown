/**
 * Tab groups as Firefox has them: a named, coloured run of neighbouring tabs in one strip that
 * folds to its label (firefox `browser/components/tabbrowser/content/tabgroup.mjs`). In this
 * code "group" already means an editor group, a pane with its own strip, so a tab group is a
 * cluster here. People read "tab group".
 */
/** Firefox's nine colours in the order of its swatches (`tabgroup-menu.mjs` `COLORS`). */
export const TAB_CLUSTER_COLORS = ['blue', 'purple', 'cyan', 'orange', 'yellow', 'pink', 'green', 'gray', 'red'] as const;
export type TabClusterColor = typeof TAB_CLUSTER_COLORS[number];
export const TAB_CLUSTER_COLOR_NAMES: Record<TabClusterColor, string> = {
  blue: 'Blue', purple: 'Purple', cyan: 'Cyan', orange: 'Orange', yellow: 'Yellow', pink: 'Pink', green: 'Green', gray: 'Gray', red: 'Red',
};
export type TabCluster = { id: string; name: string; color: TabClusterColor; collapsed: boolean; tabs: string[] };
/** The part of an editor group that clusters live in: its tab order, its pinned prefix, its selection. */
export type ClusteredStrip = { tabs: string[]; sticky: number; activeId: string | null; clusters: TabCluster[] };

export const MAX_TAB_CLUSTER_NAME = 80;
export const isTabClusterColor = (value: unknown): value is TabClusterColor => TAB_CLUSTER_COLORS.includes(value as TabClusterColor);
/** A name as it is kept: one line, no longer than a label can usefully show. */
export const tabClusterName = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TAB_CLUSTER_NAME);
/** What a cluster is called where it is listed or read aloud. An empty name is allowed, as in Firefox ("Unnamed Group"). */
export const tabClusterTitle = (cluster: Pick<TabCluster, 'name' | 'color'>): string =>
  cluster.name.trim() || `Unnamed group (${TAB_CLUSTER_COLOR_NAMES[cluster.color]})`;

/** Firefox `nextUnusedColor`: the first of the nine that no open group uses. When all nine are
 * used Firefox takes a random one; here it is the one used least, so the answer can be tested. */
export function nextTabClusterColor(used: Iterable<TabClusterColor>): TabClusterColor {
  const counts = new Map<TabClusterColor, number>(TAB_CLUSTER_COLORS.map(color => [color, 0]));
  for (const color of used) counts.set(color, (counts.get(color) ?? 0) + 1);
  return TAB_CLUSTER_COLORS.reduce((least, color) => counts.get(color)! < counts.get(least)! ? color : least);
}

export const tabClusterOf = (strip: Pick<ClusteredStrip, 'clusters'>, tabId: string): TabCluster | undefined =>
  strip.clusters.find(cluster => cluster.tabs.includes(tabId));

/**
 * What every change to a strip ends with. A tab is in at most one cluster; pinned tabs are in
 * none (Firefox keeps pinned tabs outside every group); a cluster's tabs stand together, in the
 * strip's order; a cluster with no tab is gone ("When you remove all tabs from a group, the tab
 * group is deleted"). A tab found between the members of a cluster it does not belong to comes
 * to stand after that cluster.
 */
export function normalizeTabClusters(strip: ClusteredStrip): void {
  const loose = new Set(strip.tabs.slice(strip.sticky)), claimed = new Set<string>();
  for (const cluster of strip.clusters) cluster.tabs = cluster.tabs.filter(id => loose.has(id) && !claimed.has(id) && !!claimed.add(id));
  for (let index = strip.clusters.length - 1; index >= 0; index--) if (!strip.clusters[index].tabs.length) strip.clusters.splice(index, 1);
  const owner = new Map<string, TabCluster>();
  for (const cluster of strip.clusters) for (const id of cluster.tabs) owner.set(id, cluster);
  const placed = new Set<TabCluster>(), order: string[] = [];
  for (const id of strip.tabs) {
    const cluster = owner.get(id);
    if (!cluster) { order.push(id); continue; }
    if (placed.has(cluster)) continue;
    placed.add(cluster);
    cluster.tabs = strip.tabs.filter(tab => owner.get(tab) === cluster);
    order.push(...cluster.tabs);
  }
  strip.tabs.splice(0, strip.tabs.length, ...order);
  strip.clusters.sort((a, b) => strip.tabs.indexOf(a.tabs[0]) - strip.tabs.indexOf(b.tabs[0]));
}

/** The tabs a strip shows: those outside folded clusters, and the selected tab wherever it is
 * (Firefox `tabgroup.mjs` `isTabVisibleInGroup`). Moving to the next or previous tab goes over these. */
export function visibleTabs(strip: ClusteredStrip): string[] {
  const hidden = new Set(strip.clusters.filter(cluster => cluster.collapsed).flatMap(cluster => cluster.tabs));
  return strip.tabs.filter(id => id === strip.activeId || !hidden.has(id));
}

/** One piece of a strip as it is drawn, in order: a cluster's label, a tab, or the count of a folded cluster's hidden tabs. */
export type StripItem = { kind: 'label'; cluster: TabCluster } | { kind: 'tab'; id: string; cluster?: TabCluster; last: boolean }
  | { kind: 'more'; cluster: TabCluster; count: number };
export function stripItems(strip: ClusteredStrip): StripItem[] {
  const items: StripItem[] = [], shown = new Set(visibleTabs(strip));
  for (const id of strip.tabs) {
    const cluster = tabClusterOf(strip, id);
    if (cluster && cluster.tabs[0] === id) items.push({ kind: 'label', cluster });
    if (shown.has(id)) items.push({ kind: 'tab', id, ...(cluster ? { cluster } : {}),
      last: !!cluster && cluster.tabs.filter(tab => shown.has(tab)).at(-1) === id });
    // Firefox shows "+N" only for a folded group that holds the selected tab and others beside it.
    if (cluster?.collapsed && cluster.tabs.at(-1) === id && cluster.tabs.length > 1 && cluster.tabs.includes(strip.activeId ?? ''))
      items.push({ kind: 'more', cluster, count: cluster.tabs.length - 1 });
  }
  return items;
}

/** A drawn piece of a strip with its left and right edges, as the pointer meets it during a drag. `id`: the tab, or the cluster of a label or count. */
export type StripPiece = { kind: 'tab' | 'label' | 'more'; id: string; left: number; right: number };
/** Where a dragged tab would land: `index` in the strip's tabs as they stand, the cluster it joins
 * (`null`: none), and `edge`, where the guide line is drawn. */
export type StripDrop = { index: number; cluster: string | null; edge: number };
/**
 * The place under the pointer, as Firefox reads it (`drag-and-drop.mjs`): the nearer half of a tab
 * is before or after it, in that tab's own cluster; before a label is before the whole cluster;
 * the far half of a label is the cluster's first place, or, folded, its end ("a tab can be dragged
 * into a collapsed group without expanding it"); the count belongs to the cluster in its near half
 * and to what follows in its far half; past the last piece is the end of the strip, in no cluster.
 */
export function stripDrop(strip: ClusteredStrip, pieces: StripPiece[], x: number): StripDrop {
  const at = (id: string) => strip.tabs.indexOf(id);
  const piece = pieces.find(each => x < each.right);
  if (!piece) return { index: strip.tabs.length, cluster: null, edge: pieces.at(-1)?.right ?? x };
  const near = x < (piece.left + piece.right) / 2, edge = near ? piece.left : piece.right;
  if (piece.kind === 'tab') return { index: at(piece.id) + (near ? 0 : 1), cluster: tabClusterOf(strip, piece.id)?.id ?? null, edge };
  const cluster = strip.clusters.find(each => each.id === piece.id);
  if (!cluster?.tabs.length) return { index: strip.tabs.length, cluster: null, edge };
  const first = at(cluster.tabs[0]), end = at(cluster.tabs.at(-1)!) + 1;
  if (piece.kind === 'more') return { index: end, cluster: near ? cluster.id : null, edge };
  return near ? { index: first, cluster: null, edge } : { index: cluster.collapsed ? end : first, cluster: cluster.id, edge };
}
