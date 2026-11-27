import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { GitCli } from './engines/git-cli';
import { gitComparedFile, gitComparedText } from './git-compare';

const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-compare-calls-')); temporary.push(root);
  await GitCli.run(root, ['init']);
  await GitCli.run(root, ['config', 'user.email', 'setdown@example.test']);
  await GitCli.run(root, ['config', 'user.name', 'Setdown Test']);
  await writeFile(path.join(root, 'notes.md'), '# Notes\n');
  await writeFile(path.join(root, 'figure.bin'), Buffer.from([1, 0, 2]));
  await GitCli.run(root, ['add', '.']); await GitCli.run(root, ['commit', '-m', 'base']);
  const cli = (await GitCli.connect(root))!;
  // Every command below runs in the temporary repository, never in the one these tests are part of.
  expect(cli.repositoryRoot.startsWith(os.tmpdir()) || cli.repositoryRoot.includes('setdown-git-compare-calls-')).toBe(true);
  // Every git process a read starts, by its first words.
  const calls: string[] = [];
  for (const method of ['run', 'runBytes'] as const) {
    const original = cli[method].bind(cli) as (...args: unknown[]) => unknown;
    vi.spyOn(cli, method).mockImplementation(((...args: unknown[]) => { calls.push((args[0] as string[]).slice(0, 2).join(' ')); return original(...args); }) as never);
  }
  const exists = cli.objectExists.bind(cli);
  vi.spyOn(cli, 'objectExists').mockImplementation(specification => { calls.push('rev-parse'); return exists(specification); });
  return { cli, calls, root: cli.repositoryRoot };
}

test('a stored file that is there is read with two git processes: its size, then its bytes', async () => {
  // A Markdown review waits for both sides before it prepares its reader; each process is a few milliseconds of that wait.
  const { cli, calls } = await repository();
  expect(await gitComparedText(cli, 'HEAD:notes.md', 'notes.md')).toEqual({ text: '# Notes\n', note: { size: 8 } });
  expect(calls).toEqual(['cat-file -s', 'cat-file blob']);
  calls.length = 0;
  expect(await gitComparedText(cli, ':notes.md', 'notes.md')).toMatchObject({ text: '# Notes\n' });
  expect(calls).toEqual(['cat-file -s', 'cat-file blob']);
  // A file with no text to show is not read: its size and its kind.
  calls.length = 0;
  expect(await gitComparedText(cli, 'HEAD:figure.bin', 'figure.bin')).toEqual({ text: null, note: { size: 3, reason: 'binary' } });
  expect(calls).toEqual(['cat-file -s', 'cat-file -t']);
  // The bytes of a version for a reader: the same two.
  calls.length = 0;
  expect(await gitComparedFile(cli, 'HEAD:figure.bin')).toEqual({ bytes: Buffer.from([1, 0, 2]) });
  expect(calls).toEqual(['cat-file -s', 'show HEAD:figure.bin']);
});

test('what is not a file of that version is a submodule or missing, asked only then', async () => {
  const { cli, calls, root } = await repository();
  expect(await gitComparedText(cli, 'HEAD:gone.md', 'gone.md')).toEqual({ text: '', note: { missing: true } });
  expect(calls).toEqual(['cat-file -s', 'ls-tree HEAD']);
  expect(await gitComparedFile(cli, 'HEAD:gone.pdf')).toBeNull();
  expect(await gitComparedText(cli, undefined, 'notes.md')).toEqual({ text: '', note: { missing: true } });
  // A submodule's entry names a commit this repository does not hold.
  const oid = '1'.repeat(40);
  await GitCli.run(root, ['update-index', '--add', '--cacheinfo', `160000,${oid},vendor/lib`]);
  calls.length = 0;
  expect(await gitComparedText(cli, ':vendor/lib', 'vendor/lib')).toEqual({ text: `Subproject commit ${oid}\n`, note: { submodule: true } });
  expect(calls).toEqual(['cat-file -s', 'ls-files -s']);
  // And one it does hold: the commit has a size, and is still read as a submodule, for a path with text and for one without.
  const held = (await GitCli.run(root, ['rev-parse', 'HEAD'])).trim();
  await GitCli.run(root, ['update-index', '--add', '--cacheinfo', `160000,${held},vendor/held`]);
  await GitCli.run(root, ['update-index', '--add', '--cacheinfo', `160000,${held},vendor/held.md`]);
  expect(await gitComparedText(cli, ':vendor/held', 'vendor/held')).toEqual({ text: `Subproject commit ${held}\n`, note: { submodule: true } });
  expect(await gitComparedText(cli, ':vendor/held.md', 'vendor/held.md')).toEqual({ text: `Subproject commit ${held}\n`, note: { submodule: true } });
});
