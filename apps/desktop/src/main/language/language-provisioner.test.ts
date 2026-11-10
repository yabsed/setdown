import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomaticDownloadsDisabled, LanguageProvisioner } from './language-provisioner';
import { builtinLanguageServers } from './catalog/profiles';

const host = vi.hoisted(() => ({ request: vi.fn(), prepare: vi.fn() }));
vi.mock('./zed-language-host', async importOriginal => ({
  ...await importOriginal<typeof import('./zed-language-host')>(),
  ZedLanguageHost: class { request = host.request; prepare = host.prepare; dispose() {} },
}));
const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test('a validated managed launch survives disabled downloads and process restart without consulting the host or network', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-managed-policy-')); roots.push(root);
  const directory = path.join(root, 'packages'), project = path.join(root, 'project'), executable = path.join(directory, 'server');
  await mkdir(directory); await mkdir(project); await writeFile(executable, 'managed executable');
  const definition = builtinLanguageServers.find(server => server.id === 'gopls')!;
  host.request.mockResolvedValue({ servers: ['gopls'], languages: ['Go'] });
  host.prepare.mockResolvedValue({ executable, args: [], env: {}, settings: {}, initializationOptions: {} });
  const download = vi.fn<typeof fetch>();
  const installer = new LanguageProvisioner(directory, '/unused-host', download);
  await installer.prepare(definition, 'go', project, {}, { automaticInstall: true });
  expect(host.prepare).toHaveBeenCalledOnce(); installer.dispose(); vi.clearAllMocks();
  const reopened = new LanguageProvisioner(directory, '/unused-host', download);
  expect(await reopened.prepare(definition, 'go', project, {}, { automaticInstall: false })).toMatchObject({ executable });
  expect(await reopened.installation('gopls')).toEqual({ state: 'ready', source: 'managed', executable });
  expect(host.request).not.toHaveBeenCalled(); expect(host.prepare).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  const receipt = JSON.parse(await readFile(path.join(directory, 'launches', (await readdir(path.join(directory, 'launches')))[0]), 'utf8'));
  expect(receipt.files).toHaveLength(1);
  // Changed bytes cannot be silently trusted or repaired over the network while downloads are off.
  await writeFile(executable, 'replacement executable with different bytes');
  expect(await reopened.installation('gopls')).toBeUndefined();
  await expect(reopened.prepare(definition, 'go', project, {}, { automaticInstall: false })).rejects.toBeInstanceOf(AutomaticDownloadsDisabled);
  expect(host.request).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); reopened.dispose();
});

test('disabled downloads with no receipt neither starts the host nor fetches a package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-download-policy-')); roots.push(root);
  const download = vi.fn<typeof fetch>(), installer = new LanguageProvisioner(root, '/unused-host', download);
  await expect(installer.prepare(builtinLanguageServers.find(server => server.id === 'gopls')!, 'go', root, {}, { automaticInstall: false })).rejects.toThrow('Automatic downloads are disabled');
  expect(host.request).not.toHaveBeenCalled(); expect(host.prepare).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); installer.dispose();
});
