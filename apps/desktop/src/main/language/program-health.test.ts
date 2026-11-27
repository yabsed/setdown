import { afterEach, beforeEach, expect, test } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { programOnPath, SetAsidePrograms, setAsideFor, setAsideNote } from './program-health';

let root = '';
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'setdown-programs-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const program = async (folder: string, name: string, text = '#!/bin/sh\n') => {
  await mkdir(path.join(root, folder), { recursive: true });
  const file = path.join(root, folder, name);
  await writeFile(file, text); await chmod(file, 0o755);
  return file;
};
// What JetBrains' Kotlin server of an old build writes before it ends by itself.
const expired = 'This build of kotlin-server has expired.';

test.skipIf(process.platform === 'win32')('a program is found on PATH in the order of its folders, and one that is passed by gives way to the next', async () => {
  const first = await program('first', 'kotlin-lsp'), second = await program('second', 'kotlin-lsp');
  await mkdir(path.join(root, 'folder', 'kotlin-lsp'), { recursive: true });
  const env = { PATH: [path.join(root, 'missing'), path.join(root, 'folder'), path.join(root, 'first'), path.join(root, 'second')].join(path.delimiter) };
  expect(await programOnPath('kotlin-lsp', env)).toBe(first);
  expect(await programOnPath('kotlin-lsp', env, undefined, [first])).toBe(second);
  expect(await programOnPath('kotlin-lsp', env, undefined, [first, second])).toBeUndefined();
  // A file that may not be run is no program, and no PATH is no program.
  await chmod(first, 0o644);
  expect(await programOnPath('kotlin-lsp', env)).toBe(second);
  expect(await programOnPath('kotlin-lsp', {})).toBeUndefined();
  // A relative folder of PATH is read from the project, as Zed's `which_in` reads it.
  expect(await programOnPath('kotlin-lsp', { PATH: 'second' }, root)).toBe(second);
});

test('a program set aside is passed by until it is replaced, the person asks, or a day went by', async () => {
  const file = await program('bin', 'kotlin-lsp'), store = path.join(root, 'state', 'programs-set-aside.json');
  let now = 1_000_000;
  const programs = new SetAsidePrograms(store, () => now);
  expect(await programs.find(file)).toBeUndefined();
  expect(await programs.add(file, { detail: expired, lasting: true })).toBe(true);
  expect(await programs.find(file)).toMatchObject({ detail: expired, lasting: true });
  // Setting it aside twice changes nothing: a tool that is started again for it would end the same way.
  expect(await programs.add(file, { detail: expired, lasting: true })).toBe(false);
  // It is remembered by the next run of the app.
  expect(await new SetAsidePrograms(store, () => now).find(file)).toMatchObject({ detail: expired });
  expect(JSON.parse(await readFile(store, 'utf8'))).toMatchObject({ version: 1, programs: { [file]: { detail: expired } } });
  // The person installed another build over it: the file changed, so it is started again.
  await writeFile(file, '#!/bin/sh\necho newer\n'); await utimes(file, new Date(2_000_000), new Date(2_000_000));
  expect(await programs.find(file)).toBeUndefined();
  expect(await new SetAsidePrograms(store, () => now).find(file)).toBeUndefined();
  // A day later it is given one more start: what a launcher starts can change without the launcher changing.
  expect(await programs.add(file, { detail: expired, lasting: true })).toBe(true);
  now += setAsideFor - 1; expect(await programs.find(file)).toBeDefined();
  now += 2; expect(await programs.find(file)).toBeUndefined();
  // A restart of the tool is the person asking for another try.
  expect(await programs.add(file, { lasting: true })).toBe(true);
  await programs.clear();
  expect([await programs.find(file), await programs.programs(), await new SetAsidePrograms(store, () => now).find(file)]).toEqual([undefined, [], undefined]);
});

test('what can mend itself is set aside for this run only, and what is no file is not set aside', async () => {
  const file = await program('bin', 'rust-analyzer'), store = path.join(root, 'programs-set-aside.json');
  const programs = new SetAsidePrograms(store);
  expect(await programs.add(file, { detail: 'It is not a language tool that answers.', lasting: false })).toBe(true);
  expect(await programs.find(file)).toMatchObject({ lasting: false });
  expect(await new SetAsidePrograms(store).find(file)).toBeUndefined();
  expect(await programs.add(path.join(root, 'bin', 'gone'), { lasting: true })).toBe(false);
  expect(await programs.add('relative/tool', { lasting: true })).toBe(false);
  // A file that is not what this writes is read as nothing set aside.
  await writeFile(store, '{"version":2,"programs":{"/x":{}}}');
  expect(await new SetAsidePrograms(store).programs()).toEqual([]);
  await writeFile(store, 'not json');
  expect(await new SetAsidePrograms(store).find(file)).toBeUndefined();
});

test.skipIf(process.platform === 'win32')('a link is followed: replacing what it points at is seen', async () => {
  const target = await program('opt', 'tool-1'), link = path.join(root, 'tool');
  await symlink(target, link);
  const programs = new SetAsidePrograms(path.join(root, 'programs-set-aside.json'));
  expect(await programs.add(link, { lasting: true })).toBe(true);
  expect(await programs.find(link)).toBeDefined();
  await writeFile(target, '#!/bin/sh\necho 2\n'); await utimes(target, new Date(5_000_000), new Date(5_000_000));
  expect(await programs.find(link)).toBeUndefined();
});

test('the person is told which program was passed by, in the words the program gave', () => {
  expect(setAsideNote('Kotlin', '/home/a/.local/bin/kotlin-lsp', expired))
    .toBe("Kotlin was found on this computer at /home/a/.local/bin/kotlin-lsp, and that program does not run: This build of kotlin-server has expired. Setdown is using its own copy. Restart Kotlin to try that program again.");
  expect(setAsideNote('gopls', '/usr/bin/gopls')).toBe('gopls was found on this computer at /usr/bin/gopls, and that program does not run. Setdown is using its own copy. Restart gopls to try that program again.');
});
