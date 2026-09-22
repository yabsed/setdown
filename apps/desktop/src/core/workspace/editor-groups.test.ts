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
  it('uses VS Code edge bands and preferred horizontal direction at corners', () => {
    expect(splitDirection(50, 50, 100, 100)).toBeNull();
    expect(splitDirection(9, 50, 100, 100)).toBe('left');
    expect(splitDirection(91, 50, 100, 100)).toBe('right');
    expect(splitDirection(50, 9, 100, 100)).toBe('up');
    expect(splitDirection(50, 91, 100, 100)).toBe('down');
    expect(splitDirection(25, 1, 100, 100)).toBe('left');
  });
});
