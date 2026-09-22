import { expect, test } from 'vitest';
import { layoutGitGraph } from '@web-git-graph/web';
import type { GitGraphCommit } from '@web-git-graph/protocol';
import type { GitSnapshot } from '../../../protocol/desktop-api';
import { autoGraphRefs, graphRowInsets } from './git-graph-presentation';

test('Auto follows the current branch and its tracking ref, including detached HEAD', () => {
  const status = { repository: true, branch: 'topic', upstream: 'origin/topic' } as GitSnapshot;
  expect(autoGraphRefs(status)).toEqual(['refs/heads/topic', 'refs/remotes/origin/topic']);
  expect(autoGraphRefs({ ...status, upstream: '' })).toEqual(['refs/heads/topic']);
  expect(autoGraphRefs({ ...status, branch: '(detached)' })).toEqual(['HEAD']);
  expect(autoGraphRefs({ ...status, repository: false })).toEqual([]);
});

test('subject starts after a bend but moves left when its extra lane ends', () => {
  const commits: GitGraphCommit[] = [
    { oid: 'merge', parents: ['left', 'right'], message: 'Merge', kind: 'commit' },
    { oid: 'left', parents: ['root'], message: 'Left', kind: 'commit' },
    { oid: 'right', parents: ['root'], message: 'Right', kind: 'commit' },
    { oid: 'root', parents: ['oldest'], message: 'Root', kind: 'commit' },
    { oid: 'oldest', parents: [], message: 'Oldest', kind: 'commit' }
  ];
  const layout = layoutGitGraph(commits);
  const insets = graphRowInsets(commits, layout);
  expect(insets[0]).toBeGreaterThan(insets[4]!);
  expect(insets[4]).toBe(30);
  for (const segment of layout.segments) {
    const needed = 30 + Math.max(segment.from.lane, segment.to.lane) * 16;
    for (let row = segment.from.row; row <= Math.min(commits.length - 1, segment.to.row); row++) {
      expect(insets[row]).toBeGreaterThanOrEqual(needed);
    }
  }
});
