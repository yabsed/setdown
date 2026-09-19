import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { GitChange } from '../../../protocol/desktop-api';
import { gitChangeGroups } from './git-change-groups';

const change = (staged: boolean, unstaged: boolean, conflict = false): GitChange => ({
  path: 'file.md', filePath: '/project/file.md', status: 'M', indexStatus: staged ? 'M' : ' ',
  workingTreeStatus: unstaged ? 'M' : ' ', staged, unstaged, conflict,
});
for (const [name, changes, expected] of [
  ['clean', [], 0], ['staged only', [change(true, false)], 1],
  ['changed only', [change(false, true)], 1], ['both groups in one file', [change(true, true)], 2],
  ['50 files in one group', Array.from({ length: 50 }, () => change(false, true)), 1],
  ['both groups in separate files', [change(true, false), change(false, true)], 2],
  ['conflicts form a separate group', [change(true, true, true)], 0],
] as const) test(`SCM group badge: ${name}`, () => assert.equal(gitChangeGroups(changes).badge, expected));
test('unknown snapshot has no numeric badge and conflicts stay available separately', () => {
  assert.equal(gitChangeGroups().badge, 0);
  assert.equal(gitChangeGroups([change(true, true, true)]).conflicts.length, 1);
});
