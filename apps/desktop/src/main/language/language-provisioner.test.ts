import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AutomaticDownloadsDisabled, LanguageProvisioner } from './language-provisioner';
import { builtinLanguageServers } from './catalog/profiles';

const host = vi.hoisted(() => ({ request: vi.fn(), prepare: vi.fn() }));
vi.mock('./zed-language-host', async importOriginal => ({
  ...await importOriginal<typeof import('./zed-language-host')>(),
  ZedLanguageHost: class { request = host.request; prepare = host.prepare; dispose() {} },
}));
const roots: string[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const definition = builtinLanguageServers.find(server => server.id === 'gopls')!;
const binary = (executable: string) => ({ executable, args: [], env: {}, settings: {}, initializationOptions: {} });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-zed-resolution-')); roots.push(root);
  const directory = path.join(root, 'packages'), project = path.join(root, 'project'), executable = path.join(directory, 'server');
  await mkdir(directory); await mkdir(project); await writeFile(executable, 'managed executable');
  host.request.mockResolvedValue({ servers: ['gopls'], languages: ['Go'] });
  const download = vi.fn<typeof fetch>();
  return { root, directory, project, executable, download, installer: new LanguageProvisioner(directory, '/unused-host', download) };
}

test('Zed checks the project before a managed receipt and a newly available external tool wins', async () => {
  const f = await fixture(); host.prepare.mockResolvedValue(binary(f.executable));
  await f.installer.prepare(definition, 'go', f.project, {}, { automaticInstall: true });
  host.prepare.mockResolvedValue(binary('/project/bin/gopls'));
  expect(await f.installer.prepare(definition, 'go', f.project, {}, { automaticInstall: true })).toMatchObject({ executable: '/project/bin/gopls' });
  expect(host.prepare).toHaveBeenCalledTimes(2); expect(f.download).not.toHaveBeenCalled(); f.installer.dispose();
});

test('a validated managed command survives restart and disabled downloads after Zed checks external tools', async () => {
  const f = await fixture(); host.prepare.mockResolvedValue(binary(f.executable));
  await f.installer.prepare(definition, 'go', f.project, { PATH: '/tools', HOME: f.root }, { automaticInstall: true }); f.installer.dispose();
  host.prepare.mockRejectedValue(Error('downloading language servers disabled'));
  const reopened = new LanguageProvisioner(f.directory, '/unused-host', f.download);
  expect(await reopened.prepare(definition, 'go', f.project, { HOME: f.root, PATH: '/tools' }, { automaticInstall: false })).toMatchObject({ executable: f.executable });
  expect(host.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ root: f.project, allowBinaryDownload: false }), undefined);
  expect(await reopened.installation('gopls')).toEqual({ state: 'ready', source: 'managed', executable: f.executable });
  expect(f.download).not.toHaveBeenCalled();
  await writeFile(f.executable, 'replacement executable with different bytes');
  expect(await reopened.installation('gopls')).toBeUndefined();
  await expect(reopened.prepare(definition, 'go', f.project, { HOME: f.root, PATH: '/tools' }, { automaticInstall: false })).rejects.toBeInstanceOf(AutomaticDownloadsDisabled);
  expect(f.download).not.toHaveBeenCalled(); reopened.dispose();
});

test('disabled downloads permit a usable Zed external command but never install an unprepared WASI extension', async () => {
  const f = await fixture(); host.prepare.mockResolvedValue(binary('/project/bin/gopls'));
  expect(await f.installer.prepare(definition, 'go', f.project, {}, { automaticInstall: false })).toMatchObject({ executable: '/project/bin/gopls' });
  host.prepare.mockClear();
  await expect(f.installer.prepare(builtinLanguageServers.find(server => server.id === 'fortls')!, 'fortran', f.project, {}, { automaticInstall: false })).rejects.toThrow('Automatic downloads are disabled');
  expect(host.prepare).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled(); f.installer.dispose();
});

test('explicit arguments survive Zed resolution and project environment caches are scoped and refreshable', async () => {
  const f = await fixture(), script = path.join(f.project, 'server.cjs');
  await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  host.prepare.mockResolvedValue({ ...binary(process.execPath), args: [script, '--stdio'] });
  const prepared = await f.installer.prepare(definition, 'go', f.project, {}, { args: ['--log-level', 'debug'] });
  expect(JSON.parse(execFileSync(prepared.executable, prepared.args, { encoding: 'utf8' }))).toEqual(['--stdio', '--log-level', 'debug']);
  host.request.mockImplementation(async (_op, values) => ({ PATH: values.root }));
  expect(await f.installer.projectEnvironment(f.project, {})).toEqual({ PATH: f.project });
  expect(await f.installer.projectEnvironment(f.root, {})).toEqual({ PATH: f.root });
  const calls = host.request.mock.calls.length;
  await f.installer.projectEnvironment(f.project, {}); expect(host.request).toHaveBeenCalledTimes(calls);
  f.installer.resetEnvironment(); await f.installer.projectEnvironment(f.project, {});
  expect(host.request).toHaveBeenCalledTimes(calls + 1); f.installer.dispose();
});
