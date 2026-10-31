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
  it('offers symmetric quarter-width split bands and retains horizontal corner preference', () => {
    expect(splitDirection(50, 50, 100, 100)).toBeNull();
    expect(splitDirection(9, 50, 100, 100)).toBe('left');
    expect(splitDirection(91, 50, 100, 100)).toBe('right');
    expect(splitDirection(50, 9, 100, 100)).toBe('up');
    expect(splitDirection(50, 91, 100, 100)).toBe('down');
    expect(splitDirection(25, 1, 100, 100)).toBe('left');
    expect(splitDirection(20, 50, 100, 100)).toBe('left');
    expect(splitDirection(80, 50, 100, 100)).toBe('right');
    expect(splitDirection(50, 20, 100, 100)).toBe('up');
    expect(splitDirection(50, 80, 100, 100)).toBe('down');
  });
  it('keeps a painted split through boundary jitter but releases it in the center or outside', () => {
    expect(splitDirection(245, 300, 1000, 600)).toBe('left');
    expect(splitDirection(255, 300, 1000, 600, 'left')).toBe('left');
    expect(splitDirection(745, 300, 1000, 600, 'right')).toBe('right');
    expect(splitDirection(500, 155, 1000, 600, 'up')).toBe('up');
    expect(splitDirection(500, 445, 1000, 600, 'down')).toBe('down');
    expect(splitDirection(270, 300, 1000, 600, 'left')).toBeNull();
    expect(splitDirection(730, 300, 1000, 600, 'right')).toBeNull();
    for (const previous of ['left', 'right', 'up', 'down'] as const) {
      expect(splitDirection(500, 300, 1000, 600, previous)).toBeNull();
      expect(splitDirection(50, 50, 100, 100, previous)).toBeNull();
      expect(splitDirection(-1, 300, 1000, 600, previous)).toBeNull();
    }
  });
  it('switches a top or bottom guide to either side without a center detour', () => {
    for (const [width, height] of [[1920, 1000], [1600, 800], [500, 900]]) {
      for (const previous of ['up', 'down'] as const) {
        const y = height * (previous === 'up' ? .1 : .9);
        expect(splitDirection(width / 2, y, width, height)).toBe(previous);
        for (const fraction of [.01, .2, .25, .3]) {
          expect(splitDirection(width * fraction, y, width, height, previous)).toBe('left');
          expect(splitDirection(width * (1 - fraction), y, width, height, previous)).toBe('right');
        }
      }
    }
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
