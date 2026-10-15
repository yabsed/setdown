import { afterEach, expect, test, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ServerDiscovery } from './server-discovery';
import { capture, ServerEnvironment } from './server-environment';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'setdown-discovery-')); roots.push(home);
  const env = { HOME: home, PATH: path.join(home, 'path'), SETDOWN_LSP_INHERIT_ENV: '1' };
  const create = async (directory: string, command = 'fortls') => {
    await mkdir(directory, { recursive: true }); const file = path.join(directory, command);
    await writeFile(file, '#!/bin/sh\nexit 99\n'); await chmod(file, 0o755); return file;
  };
  return { home, env, create, discovery: new ServerDiscovery(new ServerEnvironment(env)) };
}

test('PATH ordering wins; discovery does not execute found servers or change the application environment', async () => {
  const f = await fixture();
  const first = await f.create(f.env.PATH), second = await f.create(path.join(f.home, '.local/bin'));
  const originalPath = process.env.PATH;
  const found = await f.discovery.find('fortls', { resolveEnvironment: true });
  expect(found.candidates.map(c => c.path)).toEqual([first, second]); expect(found.selected?.path).toBe(first);
  expect(process.env.PATH).toBe(originalPath); f.discovery.dispose();
});

test('fallback installations require a choice when ambiguous; explicit missing selections never fall through', async () => {
  const f = await fixture();
  await f.create(path.join(f.home, '.local/bin')); await f.create(path.join(f.home, '.cargo/bin'));
  const found = await f.discovery.find('fortls'); expect(found.candidates).toHaveLength(2); expect(found.selected).toBeUndefined();
  expect((await f.discovery.find(path.join(f.home, 'removed/fortls'))).candidates).toEqual([]);
  f.discovery.dispose();
});

test('rescan invalidates negative results and excludes relative PATH entries and non-executable files', async () => {
  const f = await fixture();
  expect((await f.discovery.find('fortls')).selected).toBeUndefined();
  const file = await f.create(f.env.PATH);
  expect((await f.discovery.find('fortls')).selected).toBeUndefined();
  f.discovery.reset(); expect((await f.discovery.find('fortls')).selected?.path).toBe(file);
  await chmod(file, 0o644); f.discovery.reset(); expect((await f.discovery.find('fortls')).selected).toBeUndefined();
  const relative = new ServerDiscovery(new ServerEnvironment({ ...f.env, PATH: '.:relative' }));
  expect((await relative.find('fortls')).searched).not.toContain('.'); f.discovery.dispose(); relative.dispose();
});

test('Python scripts metadata is queried only when needed and reused by the read-only catalog', async () => {
  const f = await fixture(); await f.create(f.env.PATH, 'python3');
  const bin = path.join(f.home, 'custom python/bin'); const server = await f.create(bin);
  const query = vi.fn(async () => JSON.stringify([bin]));
  const discovery = new ServerDiscovery(new ServerEnvironment(f.env), query);
  expect((await discovery.find('fortls', { python: true })).selected).toBeUndefined(); expect(query).not.toHaveBeenCalled();
  expect((await discovery.find('fortls', { python: true, resolveEnvironment: true })).selected?.path).toBe(server);
  discovery.reset();
  await discovery.find('fortls', { python: true, resolveEnvironment: true });
  expect((await discovery.find('fortls', { python: true })).selected?.path).toBe(server);
  expect(query).toHaveBeenCalledTimes(2); discovery.dispose(); f.discovery.dispose();
});

test('shell resolution is shared, preserves multiline values, and removes helper flags', async () => {
  const query = vi.fn(async (_executable: string, args: string[]) => {
    const marker = args.at(-1)!.match(/[a-f0-9]{32}/)![0];
    return `shell startup banner\n${marker}${JSON.stringify({ PATH: '/tools/bin', MULTILINE: 'one\ntwo', ELECTRON_RUN_AS_NODE: '1' })}${marker}\n`;
  });
  const environment = new ServerEnvironment({ SHELL: '/bin/zsh', PATH: '/usr/bin', HOME: '/tmp' }, '/tmp', query);
  const pending = environment.resolve(); expect(environment.resolve()).toBe(pending);
  expect(await pending).toEqual({ source: 'shell', env: { PATH: '/tools/bin', MULTILINE: 'one\ntwo' } });
  expect(query).toHaveBeenCalledOnce(); environment.reset(); await environment.resolve(); expect(query).toHaveBeenCalledTimes(2); environment.dispose();
});

test('activated runtime environments are retained and shell failure falls back with a diagnosis', async () => {
  const query = vi.fn(async () => { throw Error('timed out'); });
  const activated = new ServerEnvironment({ VIRTUAL_ENV: '/venv', PATH: '/venv/bin' }, '/tmp', query);
  expect((await activated.resolve()).env.PATH).toBe('/venv/bin'); expect(query).not.toHaveBeenCalled();
  const gui = new ServerEnvironment({ SHELL: '/bin/bash', PATH: '/usr/bin' }, '/tmp', query);
  expect(await gui.resolve()).toEqual({ source: 'inherited', env: { SHELL: '/bin/bash', PATH: '/usr/bin' }, message: 'Error: timed out' });
  activated.dispose(); gui.dispose();
});

test('metadata subprocesses have output limits and a real cancellation deadline', async () => {
  await expect(capture(process.execPath, ['-e', 'process.stdout.write("x".repeat(1100000))'], {}, os.tmpdir())).rejects.toThrow(/too much output/);
  await expect(capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, os.tmpdir(), undefined, 150)).rejects.toThrow(/timed out/);
  const abort = new AbortController(); abort.abort();
  await expect(capture(process.execPath, [], {}, os.tmpdir(), abort.signal)).rejects.toThrow(/cancelled/);
});


test('reset cancels an in-flight discovery instead of caching or returning its stale result', async () => {
  const f = await fixture();
  await f.create(f.env.PATH, 'python3');
  let finish!: (value: string) => void;
  const query = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const discovery = new ServerDiscovery(new ServerEnvironment(f.env), query);
  const finding = discovery.find('fortls', { python: true, resolveEnvironment: true });
  const rejected = expect(finding).rejects.toThrow(/cancelled/);
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  discovery.reset(); finish('[]'); await rejected;
  const server = await f.create(f.env.PATH);
  expect((await discovery.find('fortls', { resolveEnvironment: true })).selected?.path).toBe(server);
  discovery.dispose(); f.discovery.dispose();
});


test('a real login-shell helper discovers a server exposed only by the user shell profile', async () => {
  const f = await fixture();
  const bin = path.join(f.home, '설치 도구 bin');
  const executable = await f.create(bin);
  await writeFile(path.join(f.home, '.bash_profile'), 'export PATH="$HOME/설치 도구 bin:/usr/bin:/bin"\n');
  const environment = new ServerEnvironment({ HOME: f.home, PATH: '/usr/bin:/bin', SHELL: '/bin/bash' });
  const discovery = new ServerDiscovery(environment);
  try {
    const found = await discovery.find('fortls', { resolveEnvironment: true });
    expect(found.environment.source).toBe('shell');
    expect(found.environment.env.PATH?.split(path.delimiter)[0]).toBe(bin);
    expect(found.selected?.path).toBe(executable);
  } finally { discovery.dispose(); f.discovery.dispose(); }
});
