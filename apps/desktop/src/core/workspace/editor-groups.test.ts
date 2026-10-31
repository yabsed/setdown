import { describe, expect, it } from 'vitest';
import { EditorGroups, groupLayout, splitDirection } from './editor-groups';

describe('editor groups', () => {
  it('nests splits and retains each group selection while changing command focus', () => {
    const groups = new EditorGroups();
    for (const id of ['a', 'b', 'c']) groups.add(id);
    groups.activate('a');
    groups.move('b', 'group-0', 'right');
    const right = groups.focusedId;
    groups.move('c', right, 'down');
    const boxes = groupLayout(groups.tree).groups;
    expect(boxes.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 0, y: 0, width: 50, height: 100 },
      { x: 50, y: 0, width: 50, height: 50 },
      { x: 50, y: 50, width: 50, height: 50 },
    ]);
    groups.activate('a');
    expect(groups.groups.map(g => g.activeId)).toEqual(['a', 'b', 'c']);
    expect(groups.focusedId).toBe('group-0');
  });
  it('moves tabs with insertion semantics and collapses empty branches', () => {
    const groups = new EditorGroups();
    for (const id of ['a', 'b', 'c']) groups.add(id);
    groups.activate('b'); groups.move('b', 'group-0', null, 3);
    expect(groups.focused.tabs).toEqual(['a', 'c', 'b']);
    groups.move('c', 'group-0', 'right');
    const right = groups.focusedId;
    groups.move('c', 'group-0', null, 1);
    expect(groups.groups).toHaveLength(1);
    expect(groups.focused.tabs).toEqual(['a', 'c', 'b']);
    expect(groupLayout(groups.tree).groups[0].width).toBe(100);
    expect(groups.groups.some(g => g.id === right)).toBe(false);
  });
  it('does not manufacture empty groups from a sole tab; close selects a local neighbor', () => {
    const groups = new EditorGroups(); groups.add('a'); groups.activate('a');
    groups.move('a', 'group-0', 'right'); expect(groups.groups).toHaveLength(1);
    groups.add('b'); groups.add('c'); groups.activate('b'); groups.remove('b');
    expect(groups.focused.activeId).toBe('c');
    groups.move('c', 'group-0', 'down'); groups.remove('c');
    expect(groups.focused.activeId).toBe('a'); expect(groups.groups).toHaveLength(1);
  });
  it('maps all eight body cells consistently at different sizes and aspect ratios', () => {
    // User's grid: 1 2 5 6 / 3 4 7 8. The middle half has no dead zone.
    const cells = [
      [1, .125, .25, 'left'], [2, .375, .25, 'up'],
      [5, .625, .25, 'up'], [6, .875, .25, 'right'],
      [3, .125, .75, 'left'], [4, .375, .75, 'down'],
      [7, .625, .75, 'down'], [8, .875, .75, 'right'],
    ] as const;
    for (const [width, height] of [[1920, 1000], [1600, 800], [500, 900], [317.5, 211.25]]) {
      for (const [cell, x, y, direction] of cells) {
        expect(splitDirection(width * x, height * y, width, height), `cell ${cell}`).toBe(direction);
      }
      // Cover the interiors as well as cell centers, including the old 1/3
      // corner threshold and the former guide-free central rectangle.
      for (const y of [.01, .25, .49, .5, .51, .75, .99]) {
        for (const x of [.01, .249, .751, .99]) {
          expect(splitDirection(width * x, height * y, width, height)).toBe(x < .5 ? 'left' : 'right');
        }
        for (const x of [.251, .3, .5, .7, .749]) {
          expect(splitDirection(width * x, height * y, width, height)).toBe(y < .5 ? 'up' : 'down');
        }
      }
    }
  });
  it('switches at exact quarter/half boundaries regardless of the approach direction', () => {
    const points = [
      [249, 200, 'left'], [250, 200, 'up'], [251, 200, 'up'],
      [749, 200, 'up'], [750, 200, 'right'], [751, 200, 'right'],
      [500, 299, 'up'], [500, 300, 'down'], [500, 301, 'down'],
      [249, 400, 'left'], [250, 400, 'down'], [749, 400, 'down'], [750, 400, 'right'],
      [0, 0, 'left'], [1000, 0, 'right'], [0, 600, 'left'], [1000, 600, 'right'],
    ] as const;
    for (const path of [points, [...points].reverse()]) {
      for (const [x, y, direction] of path) expect(splitDirection(x, y, 1000, 600)).toBe(direction);
    }
  });
  it('rejects outside points, empty bodies and non-finite geometry', () => {
    for (const [x, y, width, height] of [
      [-1, 300, 1000, 600], [1001, 300, 1000, 600], [500, -1, 1000, 600], [500, 601, 1000, 600],
      [0, 0, 0, 600], [0, 0, 1000, 0], [0, 0, -1, 600], [0, 0, 1000, -1],
      [NaN, 0, 1000, 600], [0, Infinity, 1000, 600], [0, 0, Infinity, 600], [0, 0, 1000, NaN],
    ]) expect(splitDirection(x, y, width, height)).toBeNull();
  });
  it('replaces only the group preview even when a pinned tab has focus', () => {
    const groups = new EditorGroups();
    groups.add('pinned'); groups.activate('pinned');
    groups.add('preview', false); groups.activate('preview');
    groups.activate('pinned');
    expect(groups.add('next', false)).toBe('preview');
    expect(groups.focused).toMatchObject({ tabs: ['pinned', 'next'], activeId: 'pinned', previewId: 'next' });
    groups.pin('next'); groups.add('third', false);
    expect(groups.focused.tabs).toEqual(['pinned', 'third', 'next']);
    expect(groups.isPinned('next')).toBe(true);
  });
  it('keeps independent previews across splits and pins moved tabs', () => {
    const groups = new EditorGroups();
    groups.add('left'); groups.add('right'); groups.move('right', 'group-0', 'right');
    const right = groups.focusedId;
    groups.add('right-preview', false);
    groups.activate('left'); groups.add('left-preview', false);
    expect(groups.groups.map(group => group.previewId)).toEqual(['left-preview', 'right-preview']);
    groups.move('left-preview', right, null);
    expect(groups.groups.map(group => group.previewId)).toEqual([null, 'right-preview']);
    expect(groups.isPinned('left-preview')).toBe(true);
    groups.remove('right-preview');
    expect(groups.groups.map(group => group.previewId)).toEqual([null, null]);
  });
  it('replacing a sole preview retains its group identity and split geometry', () => {
    const groups = new EditorGroups();
    groups.add('left'); groups.add('right'); groups.move('right', 'group-0', 'right');
    groups.add('preview', false); groups.activate('preview');
    groups.remove('right');
    const id = groups.focusedId;
    const tree = structuredClone(groups.tree);
    expect(groups.add('next', false)).toBe('preview');
    expect(groups.focused).toEqual({ id, tabs: ['next'], activeId: 'next', previewId: 'next' });
    expect(groups.tree).toEqual(tree);
    expect(groups.groups).toHaveLength(2);
  });
});
