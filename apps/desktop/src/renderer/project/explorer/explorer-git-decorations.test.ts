import { expect, test } from 'vitest';
import type { GitSnapshot, ProjectEntry } from '../../../protocol/desktop-api';
import { resourceDecoration } from '../../../core/project/git-file-decorations';
import { Status } from '../../../core/project/upstream/git-resource';
import { explorerGitDecorations } from './explorer-git-decorations';

const entry = (path: string, kind: ProjectEntry['kind'] = 'directory'): ProjectEntry => ({ path, kind, name: path });
const snapshot = (values: Array<[string, typeof Status[keyof typeof Status]]>) => ({ decorations:
  values.map(([path, status]) => ({ ...resourceDecoration(status), path })) }) as GitSnapshot;

test('collapsed ancestors use ordered propagating descendants, never deleted or neighboring paths', () => {
  const entries = [entry('/repo/src'), entry('/repo/deleted'), entry('/repo/clean'), entry('/repo/src/nested')];
  const result = explorerGitDecorations(entries, '/repo', snapshot([
    ['/repo/src/z.md', Status.UNTRACKED], ['/repo/src/a.md', Status.MODIFIED],
    ['/repo/src/nested/a.md', Status.INDEX_ADDED], ['/repo/deleted/gone.md', Status.DELETED],
    ['/repo-other/clean/a.md', Status.MODIFIED],
  ]), new Set());
  expect(result.get('/repo/src')).toMatchObject({ badge: '●', child: true, color: 'gitDecoration.modifiedResourceForeground' });
  expect(result.get('/repo/src/nested')).toMatchObject({ child: true, color: 'gitDecoration.addedResourceForeground' });
  expect(result.has('/repo/deleted')).toBe(false); expect(result.has('/repo/clean')).toBe(false);
});

test('ignore decorates only checked entries and cannot override a tracked change', () => {
  const entries = [entry('/repo/cache'), entry('/repo/cache/a.md', 'document'), entry('/repo/clean')];
  const result = explorerGitDecorations(entries, '/repo', snapshot([['/repo/cache/a.md', Status.MODIFIED]]),
    new Set(['/repo/cache', '/repo/cache/a.md']));
  expect(result.get('/repo/cache/a.md')?.tooltip).toBe('Modified');
  expect(result.get('/repo/cache')?.color).toBe('gitDecoration.ignoredResourceForeground');
  expect(result.has('/repo/clean')).toBe(false);
  expect(explorerGitDecorations(entries, '/repo', null, new Set())).toEqual(new Map());
});

test('Windows paths are case insensitive; POSIX backslashes and repository scope survive', () => {
  expect(explorerGitDecorations([entry('C:\\Repo\\src')], 'C:\\Repo', snapshot([['c:/repo/src/a.md', Status.MODIFIED]]), new Set())
    .get('C:\\Repo\\src')?.child).toBe(true);
  const result = explorerGitDecorations([entry('/repo/a\\b'), entry('/repo/a'), entry('/elsewhere/a')], '/repo',
    snapshot([['/repo/a\\b/c.md', Status.UNTRACKED]]), new Set());
  expect(result.get('/repo/a\\b')?.child).toBe(true); expect(result.size).toBe(1);
});
