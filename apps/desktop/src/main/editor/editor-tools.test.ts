import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readEditorPolicy, glob } from './editor-policy';
import { SnapshotStore } from './snapshot-store';
import { contentHash, parseWorkspaceSnapshot } from '../../core/workspace/workspace-snapshot';

test('EditorConfig applies nearest declarations and unset within the project boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-policy-'));
  try {
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = crlf\ntrim_trailing_whitespace = true\n');
    await writeFile(path.join(root, 'sub', '.editorconfig'), '[*.{md,py}]\nindent_size = 2\ntab_width = 8\nend_of_line = unset\n[*.py]\nindent_style = tab\n');
    const markdown = await readEditorPolicy(path.join(root, 'sub', '한글 문서.md'), root);
    expect(markdown.tabSize).toBe(8); expect(markdown.indentSize).toBe(2); expect(markdown.insertSpaces).toBe(true); expect(markdown.eol).toBeUndefined();
    expect(markdown.settings.find(setting => setting.key === 'indent_size')?.source).toBe(path.join(root, 'sub', '.editorconfig'));
    expect(markdown.warnings).toContain('trim_trailing_whitespace=true is reported only; it does not rewrite this file.');
    expect((await readEditorPolicy(path.join(root, 'sub', 'code.py'), root)).insertSpaces).toBe(false);
    expect((await readEditorPolicy(path.join(root, 'sub', 'file.txt'), root)).tabSize).toBe(4);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('EditorConfig globs support nested paths, alternatives, classes and bounded numeric ranges', () => {
  expect(glob('**/*.py', 'src/x.py')).toBe(true); expect(glob('**/*.py', 'x.py')).toBe(true);
  expect(glob('sub/*.{md,txt}', 'sub/a.md')).toBe(true); expect(glob('sub/*.md', 'sub/deep/a.md')).toBe(false);
  expect(glob('file{1..3}.[ch]', 'file2.c')).toBe(true); expect(glob('[!a]*.py', 'abc.py')).toBe(false);
  expect(() => glob('{1..10000000}', '1')).toThrow('too large');
});
test('snapshot writes are atomic, serialized, bounded and cannot escape the artifact directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-snapshot-'));
  try {
    const store = new SnapshotStore(root);
    await Promise.all([store.write('First', { value: 1 }, 'recovery-test'), store.write('Latest', { value: 2 }, 'recovery-test')]);
    expect(await store.read('recovery-test')).toEqual({ value: 2 }); expect(await store.list()).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(root, 'recovery-test.json'), 'utf8')).name).toBe('Latest');
    await expect(store.read('../secret')).rejects.toThrow('Invalid snapshot');
    await writeFile(path.join(root, 'damaged.json'), '{'); expect((await store.list()).some(entry => entry.name.includes('damaged'))).toBe(true);
    await expect(store.read('damaged')).rejects.toThrow();
    await store.remove('recovery-test'); expect((await store.list()).map(entry => entry.id)).toEqual(['damaged']);
    const name = '한글, "value": title';
    const id = await store.write(name, { text: 'large content '.repeat(100_000) });
    expect((await store.list()).find(entry => entry.id === id)?.name).toBe(name);
    expect(await store.read(id)).toEqual({ text: 'large content '.repeat(100_000) });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('session validation enforces content identity, tree ownership and version before restore', async () => {
  const hash = await contentHash('original'); expect(hash).not.toBe(await contentHash('changed'));
  const value = { version: 1, root: '/project', contents: [{ key: 'content', path: '/project/a.md', untitled: false, savedHash: hash, text: 'dirty' }],
    views: [{ key: 'a', content: 'content', path: '/project/a.md', kind: 'document', surface: 'editor' }],
    groups: [{ id: 'group', tabs: ['a'], active: 'a' }], tree: { kind: 'group', id: 'group' }, focused: 'group' };
  expect(parseWorkspaceSnapshot(value).contents[0].text).toBe('dirty');
  const binary = { ...value, contents: [{ ...value.contents[0], text: undefined, binary: { extension: 'png', data: 'AAEC' } }] };
  expect(parseWorkspaceSnapshot(binary).contents[0].binary?.data).toBe('AAEC');
  for (const data of [1234, 'a', 'bad?']) {
    expect(() => parseWorkspaceSnapshot({ ...binary, contents: [{ ...binary.contents[0], binary: { extension: 'png', data } }] })).toThrow('binary recovery');
  }
  expect(() => parseWorkspaceSnapshot({ ...value, version: 2 })).toThrow();
  expect(() => parseWorkspaceSnapshot({ ...value, groups: [{ id: 'group', tabs: ['a', 'a'], active: 'a' }] })).toThrow();
  expect(() => parseWorkspaceSnapshot({ ...value, tree: { kind: 'group', id: 'missing' } })).toThrow();
  expect(() => parseWorkspaceSnapshot({ ...value, views: [{ ...value.views[0], content: 'missing' }] })).toThrow();
  expect(() => parseWorkspaceSnapshot({ ...value, views: [{ ...value.views[0], editor: { unicode: '한'.repeat(400_000) } }] })).toThrow('View state exceeds');
});
