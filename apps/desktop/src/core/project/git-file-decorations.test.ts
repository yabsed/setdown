import { expect, test } from 'vitest';
import { gitFileDecorations, gitChangeDecoration } from './git-file-decorations';
import { parseIgnoreCheck } from './upstream/git-resource';
import { gitDecorationColors } from '../theme/git-decoration-colors';
import { THEME_PROFILES, themeProfile } from '../theme/theme-catalog';

const change = (xy: string, path = 'note.md', previousPath?: string) =>
  ({ path, previousPath, indexStatus: xy[0], workingTreeStatus: xy[1] });

test.each([
  ['M ', 'M', 'Index Modified', 'stageModified'], [' M', 'M', 'Modified', 'modified'],
  ['MM', 'M', 'Modified', 'modified'], ['AM', 'M', 'Modified', 'modified'],
  ['A ', 'A', 'Index Added', 'added'], [' A', 'A', 'Intent to Add', 'added'],
  ['D ', 'D', 'Index Deleted', 'stageDeleted'], [' D', 'D', 'Deleted', 'deleted'],
  ['R ', 'R', 'Index Renamed', 'renamed'], [' R', 'R', 'Intent to Rename', 'renamed'],
  ['C ', 'C', 'Index Copied', 'renamed'], [' T', 'T', 'Type Changed', 'modified'],
  ['??', 'U', 'Untracked', 'untracked'],
  ['DD', '!', 'Conflict: Both Deleted', 'conflicting'], ['AU', '!', 'Conflict: Added By Us', 'conflicting'],
  ['UD', '!', 'Conflict: Deleted By Them', 'conflicting'], ['UA', '!', 'Conflict: Added By Them', 'conflicting'],
  ['DU', '!', 'Conflict: Deleted By Us', 'conflicting'], ['AA', '!', 'Conflict: Both Added', 'conflicting'],
  ['UU', '!', 'Conflict: Both Modified', 'conflicting'],
])('%s retains upstream badge, text and theme role', (xy, badge, tooltip, color) => {
  expect(gitFileDecorations([change(xy)]).get('note.md')).toEqual({
    badge, tooltip, color: `gitDecoration.${color}ResourceForeground`, propagate: badge !== 'D',
  });
});

test('rename aliases retain working-tree precedence and copies do not decorate the source', () => {
  const renamed = gitFileDecorations([change('RM', 'new.md', 'old.md')]);
  expect(renamed.get('new.md')?.tooltip).toBe('Modified');
  expect(renamed.get('old.md')).toEqual(renamed.get('new.md'));
  expect(gitFileDecorations([change('C ', 'copy.md', 'old.md')]).has('old.md')).toBe(false);
  expect(gitFileDecorations([change('  ')])).toEqual(new Map());
});

test('SCM groups retain their own letters and colors for partially staged additions and renames', () => {
  expect(gitChangeDecoration(change('AM'), true)).toMatchObject({ badge: 'A', color: 'gitDecoration.addedResourceForeground' });
  expect(gitChangeDecoration(change('AM'), false)).toMatchObject({ badge: 'M', color: 'gitDecoration.modifiedResourceForeground' });
  expect(gitChangeDecoration(change('RM'), true)?.badge).toBe('R');
  expect(gitChangeDecoration(change('RM'), false)?.badge).toBe('M');
  expect(gitChangeDecoration(change('DD'), false)?.badge).toBe('!');
});

test('upstream verbose ignore parser excludes negations and preserves unusual paths', () => {
  expect(parseIgnoreCheck('.gitignore\0' + '1\0*.log\0a\nb.log\0.gitignore\0' + '2\0!keep.log\0keep.log\0'))
    .toEqual(['a\nb.log']);
});

test('all themes resolve every Git role and imported overrides retain their exact colors', () => {
  for (const profile of THEME_PROFILES) {
    const colors = gitDecorationColors(profile);
    expect(Object.keys(colors)).toHaveLength(10);
    for (const [role, color] of Object.entries(colors)) {
      expect(color).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/i);
      if (profile.workbenchColors?.[role]) expect(color).toBe(profile.workbenchColors[role]);
    }
  }
  expect(gitDecorationColors(themeProfile('github-light'))['gitDecoration.modifiedResourceForeground']).toBe('#895503');
  expect(gitDecorationColors(themeProfile('github-dark'))['gitDecoration.modifiedResourceForeground']).toBe('#E2C08D');
});
