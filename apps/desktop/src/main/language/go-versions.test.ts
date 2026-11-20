import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canChooseGo, currentGoChoice, downloadableGoVersions, downloadedGo, goChoices, goChoiceText, goDownloadCommands, goDownloadImportPath, goDownloadList, goDownloadTool,
  goLabel, goOlder, goSdkFolder, goSwitchRefusals, goSwitchRefusedMessage, goVersionLabel, installedGoVersions, isCurrentGo, readGoVersion, sdkGoPrograms, withGoFirst,
  type GoSdkFiles } from './go-versions';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-go-versions-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const go = process.platform === 'win32' ? 'go.exe' : 'go';

test('a Go version is read as vscode-go reads it', () => {
  expect(readGoVersion('go1.22.3')).toEqual({ text: '1.22.3', numbers: [1, 22, 3] });
  expect(readGoVersion('go1.24rc1')).toEqual({ text: '1.24rc1', numbers: [1, 24, 0] });
  expect(readGoVersion('go1.25.0-X:nodwarf5')).toMatchObject({ numbers: [1, 25, 0] });
  expect(readGoVersion('devel go1.26-0a1b2c3 Tue Oct 6')).toEqual({ devel: '1.26-0a1b2c3' });
  for (const unreadable of [undefined, '', 'go', 'gopher', '1.22.3', 'devel +abc']) expect(readGoVersion(unreadable)).toEqual({ devel: undefined });

  expect(goOlder(readGoVersion('go1.20.14'), '1.21')).toBe(true);
  expect(goOlder(readGoVersion('go1.21rc2'), '1.21')).toBe(false);
  expect(goOlder(readGoVersion('go1.9.7'), '1.19')).toBe(true);
  expect(goOlder(readGoVersion('go1.21.0'), '1.21.1')).toBe(true);
  // A development build and a version that cannot be read count as newer than every release.
  expect(goOlder(readGoVersion('devel go1.26-0a1b2c3'), '1.99')).toBe(false);
  expect(goOlder(readGoVersion('nonsense'), '1.99')).toBe(false);
  expect(goOlder(readGoVersion('go1.20'), 'not a version')).toBe(false);

  expect(goVersionLabel('go1.22.3')).toBe('1.22.3');
  expect(goVersionLabel('go1.24rc1')).toBe('1.24rc1');
  expect(goVersionLabel('devel go1.26-0a1b2c3 Tue Oct 6')).toBe('1.26-0a1b2c3');
  expect(goVersionLabel('nonsense')).toBe('(unknown)');
  expect(goVersionLabel(undefined)).toBe('(unknown)');
});

test('the listing of the sdk folder names where each Go would be', () => {
  const sdk = path.join(directory, 'sdk');
  expect(sdkGoPrograms(sdk, ['go1.23.4', 'go1.24rc1', 'gotip', 'notes'])).toEqual([
    { label: 'Go 1.23.4', program: path.join(sdk, 'go1.23.4', 'bin', go) },
    { label: 'Go 1.24rc1', program: path.join(sdk, 'go1.24rc1', 'bin', go) },
    { label: 'Go tip', program: path.join(sdk, 'gotip', 'bin', go) },
    { label: 'notes', program: path.join(sdk, 'notes', 'bin', go) }]);
  // Only the first `go` of a name is rewritten.
  expect(goLabel('go1.22.0-gogo')).toBe('Go 1.22.0-gogo');
  // What is not a listing, and names that are not one folder of the sdk folder.
  for (const listing of [undefined, null, 'go1.23.4', { 0: 'go1.23.4' }, 7]) expect(sdkGoPrograms(sdk, listing)).toEqual([]);
  expect(sdkGoPrograms(sdk, [7, null, '', '.', '..', '../go1.23.4', 'a/b', 'x'.repeat(300), { name: 'go1.23.4' }])).toEqual([]);
  expect(sdkGoPrograms(sdk, Array.from({ length: 2000 }, (_, index) => `go1.${index}`))).toHaveLength(500);
});

test('only an sdk folder that holds a go program is an installed Go', async () => {
  const home = path.join(directory, 'home'), sdk = goSdkFolder(home);
  expect(sdk).toBe(path.join(home, 'sdk'));
  expect(goSdkFolder()).toBe(path.join(os.homedir(), 'sdk'));
  // No sdk folder yet.
  expect(await installedGoVersions(home)).toEqual([]);

  await mkdir(path.join(sdk, 'go1.23.4', 'bin'), { recursive: true }); await writeFile(path.join(sdk, 'go1.23.4', 'bin', go), '');
  await mkdir(path.join(sdk, 'go1.22.9'), { recursive: true });                                   // downloaded half: no bin/go
  await mkdir(path.join(sdk, 'go1.21.0', 'bin', go), { recursive: true });                        // `go` is a folder
  await writeFile(path.join(sdk, 'go1.20.tar.gz'), '');                                           // a file beside the folders
  expect(await installedGoVersions(home)).toEqual([{ label: 'Go 1.23.4', program: path.join(sdk, 'go1.23.4', 'bin', go) }]);

  // The same with a disk that is given: the order of the listing is kept, and a failing question is a "no".
  const asked: string[] = [];
  const files: GoSdkFiles = {
    readdir: async folder => { asked.push(folder); return ['go1.21.13', 'go1.23.4', 'broken']; },
    isFile: async file => { if (file.includes('broken')) throw new Error('EACCES'); return true; } };
  expect(await installedGoVersions(home, files)).toEqual([
    { label: 'Go 1.21.13', program: path.join(sdk, 'go1.21.13', 'bin', go) }, { label: 'Go 1.23.4', program: path.join(sdk, 'go1.23.4', 'bin', go) }]);
  expect(asked).toEqual([sdk]);
  expect(await installedGoVersions(home, { readdir: async () => { throw new Error('ENOENT'); }, isFile: async () => true })).toEqual([]);
  expect(await installedGoVersions(home, { readdir: async () => 'go1.23.4', isFile: async () => true })).toEqual([]);
});

// Written by hand after the format https://go.dev/dl/?mode=json is documented to answer with (an
// array of releases, each with `version`, `stable` and `files`). It was not fetched: the checksums
// and sizes are made up, and the versions are examples.
const downloadList = JSON.stringify([
  { version: 'go1.25.3', stable: true, files: [
    { filename: 'go1.25.3.src.tar.gz', os: '', arch: '', version: 'go1.25.3', sha256: '0000000000000000000000000000000000000000000000000000000000000001', size: 30000000, kind: 'source' },
    { filename: 'go1.25.3.linux-amd64.tar.gz', os: 'linux', arch: 'amd64', version: 'go1.25.3', sha256: '0000000000000000000000000000000000000000000000000000000000000002', size: 80000000, kind: 'archive' }] },
  { version: 'go1.24.9', stable: true, files: [] },
  { version: 'go1.26rc1', stable: false, files: [] }]);

test('the download list becomes rows, and what is not a release is left out', () => {
  expect(downloadableGoVersions(JSON.parse(downloadList))).toEqual([
    { label: 'Go 1.25.3', version: 'go1.25.3', importPath: 'golang.org/dl/go1.25.3', stable: true },
    { label: 'Go 1.24.9', version: 'go1.24.9', importPath: 'golang.org/dl/go1.24.9', stable: true },
    { label: 'Go 1.26rc1', version: 'go1.26rc1', importPath: 'golang.org/dl/go1.26rc1', stable: false }]);
  for (const answer of [undefined, null, '', 'go1.25.3', 7, {}, { version: 'go1.25.3' }]) expect(downloadableGoVersions(answer)).toEqual([]);
  // Entries that are no release, and names that would be more than a name in a command line.
  expect(downloadableGoVersions([null, 7, 'go1.25.3', [], {}, { version: 1.25 }, { version: '' }, { version: '1.25.3' }, { version: 'go' }, { version: 'gopls' },
    { version: 'go1.25.3@latest' }, { version: 'go1.25.3 -exec=sh' }, { version: 'go1.25.3/../../x' }, { version: `go1.${'9'.repeat(80)}` },
    { version: 'go1.25.3', stable: 'yes' }])).toEqual([{ label: 'Go 1.25.3', version: 'go1.25.3', importPath: 'golang.org/dl/go1.25.3', stable: false }]);
  expect(downloadableGoVersions(Array.from({ length: 2000 }, (_, index) => ({ version: `go1.${index}`, stable: true })))).toHaveLength(500);
});

test('a row appears once: the Go in use, then the sdk folder, then what can be downloaded', () => {
  const sdk = path.join(directory, 'sdk');
  const current = currentGoChoice({ GOROOT: path.join(sdk, 'go1.25.3'), GOVERSION: 'go1.25.3' });
  expect(current).toEqual({ label: '1.25.3', program: path.join(sdk, 'go1.25.3', 'bin', go) });
  expect(currentGoChoice({ GOROOT: '', GOVERSION: 'go1.25.3' })).toBeUndefined();
  expect(currentGoChoice(undefined)).toBeUndefined();
  expect(currentGoChoice({ GOROOT: '/usr/lib/golang', GOVERSION: '' })?.label).toBe('(unknown)');

  const installed = sdkGoPrograms(sdk, ['go1.25.3', 'go1.24.9', 'go1.24.9']);
  const choices = goChoices(current, installed, downloadableGoVersions(JSON.parse(downloadList)));
  // The Go in use is also the sdk folder's go1.25.3: the same file, so one row. go1.24.9 is listed twice: one row.
  expect(choices.local).toEqual([current, { label: 'Go 1.24.9', program: path.join(sdk, 'go1.24.9', 'bin', go) }]);
  // Go 1.24.9 is installed, so it is not offered for download. Go 1.25.3 is: the Go in use is labelled without "Go ".
  expect(choices.downloadable.map(option => option.version)).toEqual(['go1.25.3', 'go1.26rc1']);

  // A Go in use that is somewhere else is its own row; nothing installed and nothing listed gives empty groups.
  const system = currentGoChoice({ GOROOT: '/usr/lib/golang', GOVERSION: 'go1.24.9' });
  expect(goChoices(system, installed, []).local.map(option => option.label)).toEqual(['1.24.9', 'Go 1.25.3', 'Go 1.24.9']);
  expect(goChoices(undefined, [], [])).toEqual({ local: [], downloadable: [] });
});

test('choosing the Go already in use changes nothing', () => {
  const inUse = { executable: '/home/a/sdk/go1.24rc1/bin/go', GOVERSION: 'go1.24rc1' };
  expect(isCurrentGo({ label: 'anything', program: '/home/a/sdk/go1.24rc1/bin/go' }, inUse)).toBe(true);
  // The label is compared with the three numbers of the version in use.
  expect(isCurrentGo({ label: 'Go 1.24.0', program: '/elsewhere/go' }, inUse)).toBe(true);
  expect(isCurrentGo({ label: 'Go 1.24rc1', program: '/elsewhere/go' }, inUse)).toBe(false);
  expect(isCurrentGo({ label: 'Go 1.23.4', program: '/home/a/sdk/go1.23.4/bin/go' }, inUse)).toBe(false);
  expect(isCurrentGo({ label: 'Go 1.23.4', program: '/home/a/sdk/go1.23.4/bin/go' }, { executable: '/usr/bin/go', GOVERSION: 'go1.23.4' })).toBe(true);
  // No Go in use: any choice is a change.
  expect(isCurrentGo({ label: 'Go 1.23.4', program: '/home/a/sdk/go1.23.4/bin/go' }, undefined)).toBe(false);
});

test('switching is refused without a project, with go.goroot, and with GOROOT in the environment', () => {
  expect(canChooseGo({ project: '/work/app', settings: {}, env: {} })).toEqual({ ok: true });
  expect(canChooseGo({ project: '/work/app', env: { PATH: '/usr/bin' } })).toEqual({ ok: true });
  expect(canChooseGo({ env: {} })).toEqual({ ok: false, reason: goSwitchRefusals.noProject });
  expect(canChooseGo({ project: '', env: {} })).toEqual({ ok: false, reason: goSwitchRefusals.noProject });
  // The setting in either way of writing it.
  expect(canChooseGo({ project: '/work/app', settings: { 'go.goroot': '/opt/go' }, env: {} })).toEqual({ ok: false, reason: goSwitchRefusals.setting });
  expect(canChooseGo({ project: '/work/app', settings: { go: { goroot: '/opt/go' } }, env: {} })).toEqual({ ok: false, reason: goSwitchRefusals.setting });
  // The setting's default is null, and an empty one names no Go.
  expect(canChooseGo({ project: '/work/app', settings: { 'go.goroot': null }, env: {} })).toEqual({ ok: true });
  expect(canChooseGo({ project: '/work/app', settings: { 'go.goroot': '' }, env: { GOROOT: '' } })).toEqual({ ok: true });
  expect(canChooseGo({ project: '/work/app', settings: {}, env: { GOROOT: '/opt/go' } })).toEqual({ ok: false, reason: goSwitchRefusals.environment });
  // The order of the extension: the first reason that applies is the one given.
  expect(canChooseGo({ settings: { 'go.goroot': '/opt/go' }, env: { GOROOT: '/opt/go' } })).toEqual({ ok: false, reason: goSwitchRefusals.noProject });
  expect(canChooseGo({ project: '/work/app', settings: { 'go.goroot': '/opt/go' }, env: { GOROOT: '/opt/go' } })).toEqual({ ok: false, reason: goSwitchRefusals.setting });
  expect(goSwitchRefusedMessage('/opt/go', goSwitchRefusals.environment)).toBe('GOROOT: /opt/go. Switching Go version when process.env["GOROOT"] is set is unsupported.');
});

test('a release is downloaded with three commands', () => {
  expect(goDownloadTool('go1.25.3')).toEqual({ name: 'go1.25.3', importPath: 'golang.org/dl/go1.25.3', version: 'latest' });
  const wrapper = path.join(directory, 'bin', 'go1.25.3');
  expect(goDownloadCommands('go1.25.3', '/usr/bin/go', wrapper)).toEqual({
    install: { program: '/usr/bin/go', args: ['install', '-v', 'golang.org/dl/go1.25.3@latest'] },
    download: { program: wrapper, args: ['download'] },
    root: { program: wrapper, args: ['env', 'GOROOT'] } });
  // By name when no files are given.
  expect(goDownloadCommands('go1.26rc1')).toMatchObject({ install: { program: 'go' }, download: { program: process.platform === 'win32' ? 'go1.26rc1.exe' : 'go1.26rc1' } });
  for (const name of ['', '1.25.3', 'gopls', 'go1.25.3@latest', 'go1.25.3 download', '../go1.25.3', 'go1.25.3;rm']) {
    expect(goDownloadTool(name)).toBeUndefined();
    expect(goDownloadCommands(name)).toBeUndefined();
    expect(downloadedGo(name, '/home/a/sdk/go1.25.3\n')).toBeUndefined();
  }

  // What `go1.25.3 env GOROOT` printed is the folder of the new Go.
  const root = path.join(directory, 'sdk', 'go1.25.3');
  expect(downloadedGo('go1.25.3', `${root}\n`)).toEqual({ label: 'Go 1.25.3', program: path.join(root, 'bin', go) });
  expect(downloadedGo('go1.25.3', '')).toBeUndefined();
  expect(downloadedGo('go1.25.3', 'sdk/go1.25.3')).toBeUndefined();
});

test('the chosen Go is first on PATH and nowhere else in it', () => {
  const bin = path.join(directory, 'sdk', 'go1.25.3', 'bin'), join = (...folders: string[]) => folders.join(path.delimiter);
  const env = { PATH: join('/usr/local/bin', bin, '/usr/bin'), HOME: '/home/a' };
  expect(withGoFirst(env, bin)).toEqual({ PATH: join(bin, '/usr/local/bin', '/usr/bin'), HOME: '/home/a' });
  expect(env.PATH).toBe(join('/usr/local/bin', bin, '/usr/bin'));
  expect(withGoFirst({ PATH: join(bin, '/usr/bin') }, bin).PATH).toBe(join(bin, '/usr/bin'));
  // Applied twice it is the same, and an environment without PATH gets one.
  expect(withGoFirst(withGoFirst(env, bin), bin)).toEqual(withGoFirst(env, bin));
  expect(withGoFirst({}, bin)).toEqual({ PATH: bin });
  expect(withGoFirst({ PATH: '' }, bin)).toEqual({ PATH: bin });
  // No folder: nothing changes.
  expect(withGoFirst(env, '')).toEqual(env);
});

const upstream = fileURLToPath(new URL('../../../../../vendor/vscode-go', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'extension', 'package.json')))('the copied rules are the ones vendor/vscode-go states', () => {
  const source = (file: string) => readFileSync(path.join(upstream, 'extension', 'src', file), 'utf8');
  const status = source('goEnvironmentStatus.ts');

  // When the extension refuses, in which order and with which words.
  const refusal = /function canChooseGoEnvironment\(\) \{[\s\S]*?\n\}/.exec(status)?.[0] ?? '';
  expect([...refusal.matchAll(/if \((.+)\) \{\n\t\treturn \{ ok: false, reason: '([^']+)' \};/g)].map(match => match.slice(1))).toEqual([
    ['!vscode.workspace.name', goSwitchRefusals.noProject],
    ["getGoConfig().get('goroot')", goSwitchRefusals.setting],
    ["process.env['GOROOT']", goSwitchRefusals.environment]]);
  expect(status).toContain('vscode.window.showInformationMessage(`GOROOT: ${getCurrentGoRoot()}. ${reason}`);');

  // The list: its fixed rows, its groups, and when a row is added.
  expect(status).toContain(`const CLEAR_SELECTION = '$(clear-all) ${goChoiceText.clear}';`);
  expect(status).toContain(`const CHOOSE_FROM_FILE_BROWSER = '$(folder) ${goChoiceText.browse}';`);
  expect(status).toContain(`description: '${goChoiceText.browseDetail}'`);
  expect(status).toContain(`options.push({ kind: vscode.QuickPickItemKind.Separator, label: '${goChoiceText.local}' });`);
  expect(status).toContain(`options.push({ kind: vscode.QuickPickItemKind.Separator, label: '${goChoiceText.downloadable}' });`);
  expect(status).toContain('if (!seenDescriptions.has(option.description) && !seenLabels.has(option.label)) {');
  expect(status).toContain('this.description = available ? binpath : `download ${binpath}`;');
  expect(status.indexOf('addOption(local, defaultOption);')).toBeGreaterThan(0);
  expect(status.indexOf('goSDKOptions.forEach((option) => addOption(local, option));')).toBeGreaterThan(status.indexOf('addOption(local, defaultOption);'));

  // Installed versions: the sdk folder, the program asked for, the label.
  expect(status).toContain("const sdkPath = path.join(os.homedir(), 'sdk');");
  expect(status).toContain("const binpath = path.join(sdkPath, dir, 'bin', correctBinname('go'));");
  expect(status).toContain('if ((await stat(binpath)).isFile()) {');
  expect(status).toContain("return new GoEnvironmentOption(binpath, dir.replace('go', 'Go '));");
  expect(status).toContain("return new GoEnvironmentOption(path.join(goroot, 'bin', correctBinname('go')), formatGoVersion(version));");
  expect(status).toContain("return '(unknown)';");

  // Downloadable versions: the page, the fields read, the import path and the label.
  expect(status).toContain(`const response = await fetch('${goDownloadList}');`);
  expect(/interface GoVersionWebResult \{\n\tversion: string;\n\tstable: boolean;\n\}/.test(status)).toBe(true);
  expect(status).toContain(`const dlPath = \`${goDownloadImportPath}\${result.version}\`;`);
  expect(status).toContain("const label = result.version.replace('go', 'Go ');");

  // The download: installed without a version, which ends at @latest, then the two runs of the new program.
  const download = /async function downloadGo\([\s\S]*?\n\}/.exec(status)?.[0] ?? '';
  expect(download).toContain("const newExecutableName = goOption.binpath.split('/').splice(-1)[0];");
  expect(/installTool\(\{\n\t+name: newExecutableName,\n\t+importPath: goOption\.binpath,\n\t+modulePath: goOption\.binpath,\n\t+description: newExecutableName,\n\t+isImportant: false\n\t+\}\);/.test(download)).toBe(true);
  expect(source('goTools.ts')).toContain("return importPath + '@latest';");
  expect(source('goInstallTools.ts')).toContain("await execFile(goBinary, ['install', '-v', importPath], opts);");
  expect(download).toContain("await execFile(goXExecutable, ['download']);");
  expect(download).toContain("const { stdout } = await execFile(goXExecutable, ['env', 'GOROOT'], {");
  expect(download).toContain('env: toolInstallationEnvironment()');
  expect(download).toContain("const binpath = path.join(sdkPath, 'bin', correctBinname('go'));");
  expect(download).toContain('const newOption = new GoEnvironmentOption(binpath, goOption.label);');

  // The Go already in use, and PATH.
  expect(status).toContain("if (!!go && (go.binaryPath === o.binpath || 'Go ' + go.format() === o.label)) {");
  expect(status).toContain('pathVars = pathVars.filter((p) => p !== newGoRuntimeBase);');
  expect(status).toContain('pathVars.unshift(newGoRuntimeBase);');
  expect(source('goInstallTools.ts')).toContain("addGoRuntimeBaseToPATH(path.join(getCurrentGoRoot(), 'bin'));");

  // util.ts: how a version is read and compared.
  const util = source('util.ts');
  expect(util).toContain('const matchesRelease = /^go version go(\\d\\.\\d+\\S*)\\s+/.exec(version);');
  expect(util).toContain('const matchesDevel = /^go version devel go(\\d\\.\\d+\\S*)\\s+/.exec(version);');
  expect(util).toContain('if (this.isDevel || !this.sv) {\n\t\t\treturn false;');
  expect(util).toContain('return `devel ${this.devVersion}`;');

  // What the person is told about where versions come from.
  const guide = readFileSync(path.join(upstream, 'docs', 'ui.md'), 'utf8');
  expect(guide).toContain('any version of Go that exists in your $HOME/sdk directory or on <https://golang.org/dl>');
  expect(guide).toContain('the binary will be automatically installed in $HOME/sdk');
});
