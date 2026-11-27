import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const kotlin = vi.hoisted(() => ({ kotlinServerForRun: vi.fn(), forgetKotlinServer: vi.fn() }));
vi.mock('./kotlin-download', async importOriginal => ({ ...await importOriginal<typeof import('./kotlin-download')>(), ...kotlin }));
const packages = vi.hoisted(() => ({ ensure: vi.fn(), present: vi.fn() }));
vi.mock('./language-package-store', async importOriginal => ({
  ...await importOriginal<typeof import('./language-package-store')>(),
  LanguagePackageStore: class { ensure = packages.ensure; present = packages.present; },
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

test('Python environments are asked of Zed for the project folder with the tools\' environment', async () => {
  const f = await fixture();
  host.request.mockResolvedValue({ toolchains: [
    { name: 'Python 3.12.3 (app-x-py3.12; Poetry)', path: '/cache/pypoetry/virtualenvs/app-x-py3.12/bin/python', data: { kind: 'Poetry', project: f.project, prefix: '/cache/pypoetry/virtualenvs/app-x-py3.12', name: 'app-x-py3.12' } },
    { name: 'not an interpreter', path: 'relative/python' }] });
  expect(await f.installer.pythonEnvironments(f.project, { PATH: '/usr/bin', PYENV_ROOT: '/pyenv' })).toEqual([
    { name: 'Python 3.12.3 (app-x-py3.12; Poetry)', path: '/cache/pypoetry/virtualenvs/app-x-py3.12/bin/python', kind: 'Poetry', project: f.project, prefix: '/cache/pypoetry/virtualenvs/app-x-py3.12', environment: 'app-x-py3.12' }]);
  expect(host.request).toHaveBeenLastCalledWith('toolchains', { root: f.project, language: 'Python', env: { PATH: '/usr/bin', PYENV_ROOT: '/pyenv' } });
  host.request.mockRejectedValue(Error('Zed lists no environments for Python'));
  await expect(f.installer.pythonEnvironments(f.project, {})).rejects.toThrow('Zed lists no environments');
  f.installer.dispose();
});

test("JetBrains' Kotlin server is verified and started as its Zed extension starts it, without asking the extension for the program", async () => {
  const f = await fixture(), server = builtinLanguageServers.find(server => server.id === 'kotlin-lsp')!, work = path.join(f.directory, 'extensions', 'work', 'kotlin');
  const program = path.join(work, 'kotlin-lsp-271.3588.0', 'kotlin-server-271.3588.0', 'bin', 'intellij-server'), told: string[] = [];
  kotlin.kotlinServerForRun.mockImplementation(async (options: { progress?(received: number, total?: number): void }) => { options.progress?.(5e7, 2e8); options.progress?.(7e6, undefined); return { folder: path.join(work, 'kotlin-lsp-271.3588.0'), version: '271.3588.0', program, downloaded: true }; });
  host.prepare.mockClear();
  const prepared = await f.installer.prepare(server, 'kotlin', f.project, {}, { automaticInstall: true, args: ['--verbose'], settings: { 'intellij.buildTool': 'gradle' } }, message => told.push(message));
  // The extension looks only for the build the release list names and would download that one; it is not asked.
  expect(host.prepare).not.toHaveBeenCalled();
  expect(prepared).toMatchObject({ executable: program, args: ['--stdio', '--verbose'], env: {}, languageId: 'kotlin', settings: { kotlin: { 'intellij.buildTool': 'gradle' }, 'intellij.buildTool': 'gradle' } });
  expect(kotlin.kotlinServerForRun).toHaveBeenCalledWith(expect.objectContaining({ work, fetch: f.download }));
  expect(told).toEqual([`Downloading ${server.name}… 25%`, `Downloading ${server.name}… 7 MB`]);
  // A download that fails its checksum is the person's to read, so nothing unverified starts.
  kotlin.kotlinServerForRun.mockRejectedValue(Error('Could not verify the language server download: expected SHA-256 a, got b. The downloaded file was deleted.'));
  await expect(f.installer.prepare(server, 'kotlin', path.join(f.root, 'other'), {}, { automaticInstall: true })).rejects.toThrow('Could not verify the language server download');
  // Without download permission nothing is fetched: a server that is already here is used, and without one the person is told.
  kotlin.kotlinServerForRun.mockClear();
  await expect(f.installer.prepare(server, 'kotlin', path.join(f.root, 'fourth'), {}, { automaticInstall: false })).rejects.toThrow('Automatic downloads are disabled');
  await mkdir(path.dirname(program), { recursive: true }); await writeFile(program, '#!/bin/sh\n');
  expect(await f.installer.prepare(server, 'kotlin', path.join(f.root, 'fifth'), {}, { automaticInstall: false })).toMatchObject({ executable: program, args: ['--stdio'] });
  // Other tools never touch the Kotlin download.
  host.prepare.mockResolvedValue(binary(f.executable));
  await f.installer.prepare(definition, 'go', f.project, {}, { automaticInstall: true });
  expect(kotlin.kotlinServerForRun).not.toHaveBeenCalled(); f.installer.dispose();
});

test('an extension is asked what it adds to a tool it did not set up, once it is loaded, and nothing is downloaded for the question', async () => {
  const f = await fixture(), work = path.join(f.directory, 'extensions', 'work', 'vue');
  // No extension is loaded and none answered before: the host is not even asked.
  host.request.mockClear();
  expect(await f.installer.contributions(['typescript-language-server'], f.project, {})).toEqual({});
  expect(host.request).not.toHaveBeenCalled();
  // Vue's extension answered in an earlier run. Its package is still here, so it is loaded and asked again.
  await writeFile(path.join(f.directory, 'contributors.json'), JSON.stringify({ version: 1, tools: { 'typescript-language-server': ['vue'] } }));
  await mkdir(path.join(work, 'node_modules', '@vue', 'typescript-plugin'), { recursive: true });
  await writeFile(path.join(work, 'node_modules', '@vue', 'typescript-plugin', 'package.json'), '{}');
  packages.present.mockResolvedValue(true);
  const order: string[] = [];
  const vue = { server: 'vue-language-server', initializationOptions: { plugins: [{ name: '@vue/typescript-plugin', location: work, languages: ['typescript', 'vue.js'] }] }, settings: null };
  // Marko's tool was never set up here: the folder its extension names does not exist.
  const marko = { server: 'marko', initializationOptions: { plugins: [{ name: '@marko/ts-plugin', location: path.join(f.directory, 'extensions', 'work', 'marko') }] }, settings: null };
  host.request.mockImplementation(async (op: string, values: Record<string, unknown>) => {
    order.push(op);
    if (op === 'contributions') { expect(values).toMatchObject({ servers: ['typescript-language-server'], root: f.project }); return { 'typescript-language-server': [vue, marko] }; }
    return undefined;
  });
  const again = new LanguageProvisioner(f.directory, '/unused-host', f.download);
  expect(await again.contributions(['typescript-language-server'], f.project, {})).toEqual({ 'typescript-language-server': [vue] });
  expect(order).toEqual(['extensions', 'contributions']);
  expect(host.request).toHaveBeenCalledWith('extensions', { extensions: [expect.objectContaining({ id: 'vue' })] });
  expect(packages.ensure).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled();
  // Both extensions are remembered as contributors, to be loaded next time when their package is there.
  expect(JSON.parse(await readFile(path.join(f.directory, 'contributors.json'), 'utf8')).tools['typescript-language-server']).toEqual(['marko', 'vue']);
  // An extension's answer depends on the project. Silence for one project does not take it off the list.
  host.request.mockImplementation(async (op: string) => { order.push(op); return op === 'contributions' ? { 'typescript-language-server': [] } : undefined; });
  expect(await again.contributions(['typescript-language-server'], f.project, {})).toEqual({ 'typescript-language-server': [] });
  expect(JSON.parse(await readFile(path.join(f.directory, 'contributors.json'), 'utf8')).tools['typescript-language-server']).toEqual(['marko', 'vue']);
  // A package that is no longer on this computer is not fetched for the question.
  packages.present.mockResolvedValue(false); order.length = 0;
  const later = new LanguageProvisioner(f.directory, '/unused-host', f.download);
  expect(await later.contributions(['typescript-language-server'], f.project, {})).toEqual({});
  expect(order).toEqual([]);
  f.installer.dispose(); again.dispose(); later.dispose();
});

test("Angular's server is installed for the extension where the project brings none, and named in the extension's own option", async () => {
  const f = await fixture(), angular = builtinLanguageServers.find(server => server.id === 'zed.angular.angular')!;
  const installed = path.join(f.directory, 'npm', '@angular--language-server', '0.0.0', 'node_modules', '@angular', 'language-server');
  await mkdir(path.join(installed, 'bin'), { recursive: true });
  await writeFile(path.join(installed, 'package.json'), '{"name":"@angular/language-server"}');
  const told: string[] = [];
  host.request.mockImplementation(async (op: string) => op === 'inventory' ? { servers: [], languages: ['Angular'] }
    : op === 'npm' ? { executable: process.execPath, args: [path.join(installed, 'bin', 'ngserver')], settings: {}, initializationOptions: {} } : undefined);
  host.prepare.mockResolvedValue(binary(f.executable));
  await f.installer.prepare(angular, 'angular', f.project, {}, { automaticInstall: true }, message => told.push(message));
  expect(host.request).toHaveBeenCalledWith('npm', expect.objectContaining({ package: '@angular/language-server', command: 'ngserver' }), expect.anything());
  expect(host.prepare.mock.calls.at(-1)![0].settings.angular.initialization_options).toEqual({ angular_language_server_path: installed });
  expect(told).toContain('Downloading @angular/language-server…');
  // A project with its own copy is left to the extension, which starts that one.
  const own = path.join(f.root, 'own'), copy = path.join(own, 'node_modules', '@angular', 'language-server');
  await mkdir(copy, { recursive: true }); await writeFile(path.join(copy, 'package.json'), '{}');
  host.request.mockClear();
  await f.installer.prepare(angular, 'angular', own, {}, { automaticInstall: true });
  expect(host.request.mock.calls.some(call => call[0] === 'npm')).toBe(false);
  expect(host.prepare.mock.calls.at(-1)![0].settings.angular.initialization_options).toEqual({});
  // What the person wrote in the option is what the extension gets.
  await f.installer.prepare(angular, 'angular', f.project, {}, { automaticInstall: true, initializationOptions: { angular_language_server_path: '/my/copy' } });
  expect(host.request.mock.calls.some(call => call[0] === 'npm')).toBe(false);
  expect(host.prepare.mock.calls.at(-1)![0].settings.angular.initialization_options).toEqual({ angular_language_server_path: '/my/copy' });
  f.installer.dispose();
});

// ---- A program of this computer that cannot run is passed by for Setdown's own copy (`program-health.ts`) ----

test.skipIf(process.platform === 'win32')("a kotlin-lsp on PATH is started as the Kotlin extension starts it, and one whose build has expired gives way to Setdown's verified build", async () => {
  const f = await fixture(), server = builtinLanguageServers.find(server => server.id === 'kotlin-lsp')!, work = path.join(f.directory, 'extensions', 'work', 'kotlin');
  const bin = path.join(f.root, 'home', '.local', 'bin'), local = path.join(bin, 'kotlin-lsp'), env = { PATH: bin };
  await mkdir(bin, { recursive: true }); await writeFile(local, '#!/bin/sh\n', { mode: 0o755 });
  const own = path.join(work, 'kotlin-lsp-271.3588.0', 'kotlin-server-271.3588.0', 'bin', 'intellij-server');
  kotlin.kotlinServerForRun.mockClear(); kotlin.kotlinServerForRun.mockResolvedValue({ folder: path.join(work, 'kotlin-lsp-271.3588.0'), version: '271.3588.0', program: own, downloaded: true });
  host.prepare.mockClear();
  // zed-extensions/kotlin 0.3.5 `language_server_binary_path`: `worktree.which("kotlin-lsp")` comes before any download.
  expect(await f.installer.prepare(server, 'kotlin', f.project, env, { automaticInstall: true })).toMatchObject({ executable: local, args: ['--stdio'], env: {} });
  expect(kotlin.kotlinServerForRun).not.toHaveBeenCalled();
  // It ended saying its build has expired: from the next start on Setdown's own build is used, and what was passed by is named.
  expect(await f.installer.setAside(local, { detail: 'This build of kotlin-server has expired.', lasting: true })).toBe(true);
  const prepared = await f.installer.prepare(server, 'kotlin', path.join(f.root, 'second'), env, { automaticInstall: true });
  expect(prepared).toMatchObject({ executable: own, args: ['--stdio'], instead: { program: local, detail: 'This build of kotlin-server has expired.' } });
  expect(host.prepare).not.toHaveBeenCalled();
  // Setdown's own copy is never set aside: there is nothing behind it.
  expect([f.installer.manages(own), f.installer.manages(local), await f.installer.setAside(own, { lasting: true })]).toEqual([true, false, false]);
  // It is remembered by the next run of the app, until the person asks for another try.
  const next = new LanguageProvisioner(f.directory, '/unused-host', f.download);
  expect(await next.prepare(server, 'kotlin', path.join(f.root, 'third'), env, { automaticInstall: true })).toMatchObject({ executable: own, instead: { program: local } });
  // Without leave to download and with no copy here, the program of this computer is all there is: its own words say why it does not run.
  kotlin.kotlinServerForRun.mockClear();
  expect(await next.prepare(server, 'kotlin', path.join(f.root, 'fourth'), env, { automaticInstall: false })).toMatchObject({ executable: local });
  expect(kotlin.kotlinServerForRun).not.toHaveBeenCalled();
  await next.tryProgramsAgain();
  expect(await next.prepare(server, 'kotlin', path.join(f.root, 'fifth'), env, { automaticInstall: true })).toMatchObject({ executable: local });
  next.dispose(); f.installer.dispose();
});

test("a program Zed's adapter found on this computer and that cannot run is passed by: the adapter is asked again without it", async () => {
  const f = await fixture(), local = path.join(f.root, 'cargo', 'bin', 'gopls');
  await mkdir(path.dirname(local), { recursive: true }); await writeFile(local, 'a launcher that only prints an error', { mode: 0o755 });
  host.prepare.mockReset();
  host.prepare.mockImplementation(async (request: { skipPrograms?: string[] }) => binary(request.skipPrograms?.includes(local) ? f.executable : local));
  // While nothing is known against it, the program of this computer is used, and the adapter is asked once.
  expect(await f.installer.prepare(definition, 'go', f.project, {}, { automaticInstall: true })).toMatchObject({ executable: local });
  expect(host.prepare).toHaveBeenCalledTimes(1);
  expect(await f.installer.setAside(local, { detail: 'It is not a language tool that answers.', lasting: false })).toBe(true);
  host.prepare.mockClear();
  const prepared = await f.installer.prepare(definition, 'go', path.join(f.root, 'other'), {}, { automaticInstall: true });
  expect(prepared).toMatchObject({ executable: f.executable, instead: { program: local, detail: 'It is not a language tool that answers.' } });
  expect(host.prepare.mock.calls.map(([request]) => (request as { skipPrograms?: string[] }).skipPrograms)).toEqual([undefined, [local]]);
  // What was passed by is not written into the receipt of the command.
  const receipts = await readdir(path.join(f.directory, 'launches'));
  for (const receipt of receipts) expect(await readFile(path.join(f.directory, 'launches', receipt), 'utf8')).not.toContain('instead');
  // An adapter that has no other program answers with the same one: it is started, and its failure is the person's to read.
  host.prepare.mockImplementation(async () => binary(local));
  expect(await f.installer.prepare(definition, 'go', path.join(f.root, 'third'), {}, { automaticInstall: true })).toEqual(expect.not.objectContaining({ instead: expect.anything() }));
  f.installer.dispose();
});
