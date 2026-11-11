import { expect, it } from 'vitest';
import { ownerFor } from './file-command-target';

/** A minimal `closest` over a chain of class/attribute descriptors (innermost first). */
const element = (...chain: { classes?: string[]; tag?: string; folder?: string }[]) => ({
  closest(selector: string) {
    for (const part of selector.split(',').map(item => item.trim())) for (const node of chain) {
      if (part === '[data-folder-list]' && node.folder) return { dataset: { folderList: node.folder } };
      if (/^(input|textarea|select)$/.test(part) && node.tag === part) return node;
      const match = /^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/.exec(part);
      if (match && node.classes?.includes(match[1]) && !(match[2] && node.classes.includes(match[2]))) return node;
    }
    return null;
  },
}) as unknown as Element;

it('routes file commands to the explorer or the folder tab under the pointer, never to inputs', () => {
  const tree = { classes: ['explorer-tree'] };
  expect(ownerFor(element({ classes: ['explorer-row'] }, tree), true)).toBe('explorer');
  expect(ownerFor(element({ classes: ['explorer-row'] }, tree), false)).toBe('');
  expect(ownerFor(element({ tag: 'input' }, { classes: ['explorer-row', 'explorer-edit'] }, tree), true)).toBe('');
  expect(ownerFor(element({ classes: ['folder-row'] }, { folder: 'tab-1' }), true)).toBe('folder:tab-1');
  expect(ownerFor(element({ tag: 'input' }, { folder: 'tab-1' }), true)).toBe('');
});
