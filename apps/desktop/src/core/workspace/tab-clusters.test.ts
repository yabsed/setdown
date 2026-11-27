import { describe, expect, it } from 'vitest';
import { EditorGroups } from './editor-groups';
import { nextTabClusterColor, normalizeTabClusters, stripDrop, stripItems, tabClusterName, tabClusterTitle, TAB_CLUSTER_COLORS, visibleTabs, type ClusteredStrip, type StripPiece, type TabCluster } from './tab-clusters';

const cluster = (id: string, tabs: string[], change: Partial<TabCluster> = {}): TabCluster => ({ id, name: '', color: 'blue', collapsed: false, tabs, ...change });
const strip = (tabs: string[], clusters: TabCluster[], change: Partial<ClusteredStrip> = {}): ClusteredStrip => ({ tabs, sticky: 0, activeId: tabs[0] ?? null, clusters, ...change });
/** A strip as it reads: `[name: a b] c`, a folded tab group in parentheses. */
const read = (groups: EditorGroups, id = groups.focusedId) => {
  const group = groups.groups.find(each => each.id === id)!;
  return group.tabs.map((tab, index) => {
    const own = group.clusters.find(each => each.tabs.includes(tab));
    const open = own?.tabs[0] === tab ? (own.collapsed ? '(' : '[') : '', close = own?.tabs.at(-1) === tab ? (own.collapsed ? ')' : ']') : '';
    return `${index === group.sticky && group.sticky ? '| ' : ''}${open}${tab}${close}`;
  }).join(' ');
};
function opened(...tabs: string[]) { const groups = new EditorGroups(); for (const tab of tabs) { groups.add(tab); groups.activate(tab); } return groups; }

describe('the rules a strip keeps after every change', () => {
  it('keeps each tab in one tab group, its members together and in strip order, and none among the pinned tabs', () => {
    const state = strip(['pin', 'a', 'x', 'b', 'c', 'd'], [cluster('one', ['b', 'a', 'pin', 'gone']), cluster('two', ['c', 'a', 'd'])], { sticky: 1 });
    normalizeTabClusters(state);
    // `x` stood between two members of a tab group it is not in: it comes after that group.
    expect(state.tabs).toEqual(['pin', 'a', 'b', 'x', 'c', 'd']);
    expect(state.clusters.map(each => [each.id, each.tabs])).toEqual([['one', ['a', 'b']], ['two', ['c', 'd']]]);
  });
  it('removes a tab group that has no tab left, and lists tab groups in strip order', () => {
    const state = strip(['a', 'b', 'c'], [cluster('late', ['c']), cluster('empty', ['closed']), cluster('early', ['a'])]);
    normalizeTabClusters(state);
    expect(state.clusters.map(each => each.id)).toEqual(['early', 'late']);
    expect(state.tabs).toEqual(['a', 'b', 'c']);
  });
});

describe('what a strip shows', () => {
  const folded = () => strip(['a', 'b', 'c', 'd', 'e'], [cluster('one', ['b', 'c', 'd'], { collapsed: true })]);
  it('hides the tabs of a folded tab group, except the selected one', () => {
    expect(visibleTabs(folded())).toEqual(['a', 'e']);
    expect(visibleTabs({ ...folded(), activeId: 'c' })).toEqual(['a', 'c', 'e']);
  });
  it('draws a label before a tab group, and the count of hidden tabs after the selected member of a folded one', () => {
    const shape = (state: ClusteredStrip) => stripItems(state).map(item => item.kind === 'label' ? `label:${item.cluster.id}`
      : item.kind === 'more' ? `+${item.count}` : `${item.id}${item.cluster ? `@${item.cluster.id}` : ''}${item.last ? '.' : ''}`);
    expect(shape(folded())).toEqual(['a', 'label:one', 'e']);
    expect(shape({ ...folded(), activeId: 'c' })).toEqual(['a', 'label:one', 'c@one.', '+2', 'e']);
    expect(shape(strip(['a', 'b', 'c'], [cluster('one', ['a', 'b'])]))).toEqual(['label:one', 'a@one', 'b@one.', 'c']);
    // Firefox shows no count for a folded tab group of one tab.
    expect(shape(strip(['a', 'b'], [cluster('one', ['a'], { collapsed: true })]))).toEqual(['label:one', 'a@one.', 'b']);
  });
});

describe('where a dragged tab lands', () => {
  // Each piece is 100 wide, in the order the strip draws them.
  const pieces = (...drawn: Array<[StripPiece['kind'], string]>): StripPiece[] => drawn.map(([kind, id], index) => ({ kind, id, left: index * 100, right: index * 100 + 98 }));
  it('reads the nearer half of a tab as before or after it, in that tab\'s own tab group', () => {
    const state = strip(['a', 'b', 'c', 'd'], [cluster('one', ['b', 'c'])]);
    const drawn = pieces(['tab', 'a'], ['label', 'one'], ['tab', 'b'], ['tab', 'c'], ['tab', 'd']);
    expect(stripDrop(state, drawn, 20)).toEqual({ index: 0, cluster: null, edge: 0 });
    expect(stripDrop(state, drawn, 80)).toEqual({ index: 1, cluster: null, edge: 98 });      // after `a`: before the tab group, outside it
    expect(stripDrop(state, drawn, 220)).toEqual({ index: 1, cluster: 'one', edge: 200 });
    expect(stripDrop(state, drawn, 380)).toEqual({ index: 3, cluster: 'one', edge: 398 });    // the far half of the last member: still inside
    expect(stripDrop(state, drawn, 420)).toEqual({ index: 3, cluster: null, edge: 400 });     // the near half of what follows: outside
    expect(stripDrop(state, drawn, 900)).toEqual({ index: 4, cluster: null, edge: 498 });
    // The 2px between two pieces belongs to the piece after it.
    expect(stripDrop(state, drawn, 299)).toEqual({ index: 2, cluster: 'one', edge: 300 });
  });
  it('reads a label as before the tab group, or as its first place; folded, as its end', () => {
    const state = strip(['a', 'b', 'c', 'd'], [cluster('one', ['b', 'c'])]);
    const open = pieces(['tab', 'a'], ['label', 'one'], ['tab', 'b'], ['tab', 'c'], ['tab', 'd']);
    expect(stripDrop(state, open, 120)).toEqual({ index: 1, cluster: null, edge: 100 });
    expect(stripDrop(state, open, 180)).toEqual({ index: 1, cluster: 'one', edge: 198 });
    state.clusters[0].collapsed = true;
    const folded = pieces(['tab', 'a'], ['label', 'one'], ['tab', 'd']);
    expect(stripDrop(state, folded, 120)).toEqual({ index: 1, cluster: null, edge: 100 });
    expect(stripDrop(state, folded, 180)).toEqual({ index: 3, cluster: 'one', edge: 198 });
    expect(stripDrop(state, folded, 220)).toEqual({ index: 3, cluster: null, edge: 200 });
  });
  it('reads the count of a folded tab group as its end, then as what follows', () => {
    const state = strip(['a', 'b', 'c', 'd'], [cluster('one', ['a', 'b', 'c'], { collapsed: true })], { activeId: 'b' });
    const drawn = pieces(['label', 'one'], ['tab', 'b'], ['more', 'one'], ['tab', 'd']);
    expect(stripDrop(state, drawn, 120)).toEqual({ index: 1, cluster: 'one', edge: 100 });
    expect(stripDrop(state, drawn, 220)).toEqual({ index: 3, cluster: 'one', edge: 200 });
    expect(stripDrop(state, drawn, 280)).toEqual({ index: 3, cluster: null, edge: 298 });
    // An empty strip, and a label whose tab group is gone, put the tab at the end.
    expect(stripDrop(strip([], []), [], 40)).toEqual({ index: 0, cluster: null, edge: 40 });
    expect(stripDrop(state, pieces(['label', 'gone']), 80)).toMatchObject({ index: 4, cluster: null });
  });
  it('carries the place to the strip: a drop on a folded label joins without unfolding, and shows the tab as the selected one', () => {
    const groups = opened('a', 'b', 'c', 'd');
    const one = groups.createCluster(['b', 'c'])!;
    groups.setCluster(one.id, { collapsed: true }); groups.activate('a');
    const drop = stripDrop(groups.focused, pieces(['tab', 'a'], ['label', one.id], ['tab', 'd']), 180);
    groups.move('d', groups.focusedId, null, drop.index, drop.cluster);
    expect(read(groups)).toBe('a (b c d)');
    expect(visibleTabs(groups.focused)).toEqual(['a', 'd']);
  });
});

describe('names and colours', () => {
  it('gives the first colour no tab group uses, in Firefox\'s order, then the one used least', () => {
    expect(TAB_CLUSTER_COLORS).toEqual(['blue', 'purple', 'cyan', 'orange', 'yellow', 'pink', 'green', 'gray', 'red']);
    expect(nextTabClusterColor([])).toBe('blue');
    expect(nextTabClusterColor(['blue', 'cyan'])).toBe('purple');
    expect(nextTabClusterColor([...TAB_CLUSTER_COLORS, 'blue', 'purple'])).toBe('cyan');
  });
  it('lists a tab group without a name by its colour, and keeps a name to one line', () => {
    expect(tabClusterTitle({ name: '  ', color: 'green' })).toBe('Unnamed group (Green)');
    expect(tabClusterTitle({ name: '쇼핑', color: 'green' })).toBe('쇼핑');
    expect(tabClusterName('two\nlines')).toBe('two lines');
    expect(tabClusterName('x'.repeat(200))).toHaveLength(80);
  });
});

describe('tab groups in an editor group', () => {
  it('makes a tab group where its first tab stands, unfolded and unnamed, each in the next colour', () => {
    const groups = opened('a', 'b', 'c', 'd');
    const first = groups.createCluster(['c', 'a'])!;
    expect(read(groups)).toBe('b [c a] d');
    expect(first).toMatchObject({ name: '', color: 'blue', collapsed: false });
    expect(groups.createCluster(['d'])).toMatchObject({ color: 'purple' });
    // A tab group in another pane counts for the next colour too.
    groups.move('b', groups.focusedId, 'right');
    expect(groups.createCluster(['b'])).toMatchObject({ color: 'cyan' });
    expect(groups.createCluster(['nowhere'])).toBeNull();
  });
  it('adds a tab at the end of a tab group, and a tab that leaves comes to stand right after it', () => {
    const groups = opened('a', 'b', 'c', 'd', 'e');
    const one = groups.createCluster(['b', 'c'])!;
    expect(groups.addToCluster('a', one.id)).toBe(true);
    expect(read(groups)).toBe('[b c a] d e');
    expect(groups.addToCluster('a', one.id)).toBe(false);
    expect(groups.removeFromCluster('b')).toBe(true);
    expect(read(groups)).toBe('[c a] b d e');
    expect(groups.removeFromCluster('b')).toBe(false);
    // Taking the last tab out, or closing it, ends the tab group.
    groups.removeFromCluster('a'); groups.remove('c');
    expect(read(groups)).toBe('a b d e');
    expect(groups.focused.clusters).toEqual([]);
  });
  it('ungroups without moving a tab, and changes name, colour and fold', () => {
    const groups = opened('a', 'b', 'c');
    const one = groups.createCluster(['a', 'b'])!;
    expect(groups.setCluster(one.id, { name: 'Reading\nlist', color: 'red', collapsed: true })).toBe(true);
    expect(groups.cluster(one.id)).toMatchObject({ name: 'Reading list', color: 'red', collapsed: true });
    expect(read(groups)).toBe('(a b) c');
    expect(groups.ungroup(one.id)).toBe(true);
    expect(read(groups)).toBe('a b c');
    expect(groups.setCluster(one.id, { name: 'gone' })).toBe(false);
    expect(groups.ungroup(one.id)).toBe(false);
  });
  it('opens a new tab after the tab group of the selected tab, outside it; "new tab in group" goes to its end and unfolds it', () => {
    const groups = opened('a', 'b', 'c', 'd');
    const one = groups.createCluster(['a', 'b', 'c'])!;
    groups.activate('a'); groups.add('new');
    expect(read(groups)).toBe('[a b c] new d');
    groups.setCluster(one.id, { collapsed: true }); groups.activate('d');
    groups.add('inside', true, groups.focusedId, { cluster: one.id });
    expect(read(groups)).toBe('[a b c inside] new d');
  });
  it('lets a preview that replaces the selected preview keep its place in the tab group', () => {
    const groups = opened('a', 'b');
    groups.add('peek', false); groups.activate('peek');
    const one = groups.createCluster(['b', 'peek'])!;
    expect(read(groups)).toBe('a [b peek]');
    expect(groups.add('next', false)).toBe('peek');
    expect(read(groups)).toBe('a [b next]');
    expect(groups.cluster(one.id)!.tabs).toEqual(['b', 'next']);
  });
  it('takes a pinned tab out of its tab group, and releases a pinned tab that is put into one', () => {
    const groups = opened('a', 'b', 'c');
    const one = groups.createCluster(['b', 'c'])!;
    groups.stick('b');
    expect(read(groups)).toBe('b | a [c]');
    expect(groups.addToCluster('b', one.id)).toBe(true);
    expect(read(groups)).toBe('a [c b]');
    expect(groups.focused.sticky).toBe(0);
    groups.stick('a');
    expect(groups.createCluster(['a'])).not.toBeNull();
    expect(groups.focused.sticky).toBe(0);
  });
  it('a moved tab joins the tab group it is set down in, stays at an edge of its own, and otherwise is in none', () => {
    const groups = opened('a', 'b', 'c', 'd', 'e');
    const id = groups.focusedId, one = groups.createCluster(['b', 'c', 'd'])!;
    groups.move('e', id, null, 2);                     // between b and c
    expect(read(groups)).toBe('a [b e c d]');
    groups.move('e', id, null, 5);                     // past the last member: still at its own tab group's edge
    expect(read(groups)).toBe('a [b c d e]');
    groups.move('e', id, null, 0);                     // before `a`: no member beside it
    expect(read(groups)).toBe('e a [b c d]');
    // A drop names the tab group, or none, whatever stands beside the tab.
    groups.move('a', id, null, 2, one.id);
    expect(read(groups)).toBe('e [a b c d]');
    groups.move('b', id, null, 2, null);               // set down among members, named as none: after the group
    expect(read(groups)).toBe('e [a c d] b');
    groups.move('e', id, null, 4, one.id);
    expect(read(groups)).toBe('[a c d e] b');
  });
  it('leaves its tab group when it moves to another pane, and the group it empties is gone', () => {
    const groups = opened('a', 'b', 'c');
    const origin = groups.focusedId;
    groups.createCluster(['a']); groups.createCluster(['b', 'c']);
    groups.move('a', origin, 'right');
    expect(read(groups, origin)).toBe('[b c]');
    expect(read(groups)).toBe('a');
    expect(groups.tabCluster('a')).toBeUndefined();
    expect(groups.groups.flatMap(group => group.clusters)).toHaveLength(1);
  });
  it('after closing the selected tab, selects the nearest tab that shows instead of one hidden in a folded tab group', () => {
    const groups = opened('a', 'b', 'c', 'd');
    const one = groups.createCluster(['b', 'c'])!;
    groups.setCluster(one.id, { collapsed: true });
    groups.activate('a'); groups.remove('a');
    expect(groups.focused.activeId).toBe('d');
    groups.remove('d');
    // Only hidden tabs are left: one of them is selected and shows.
    expect(groups.focused.activeId).toBe('c');
    expect(visibleTabs(groups.focused)).toEqual(['c']);
  });
});
