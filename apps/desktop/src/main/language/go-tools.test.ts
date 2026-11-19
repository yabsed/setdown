import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearedForInstall, findGo, findGoTool, goDefaultPlaces, goEnvNames, goEnvironment, goplsDefaultVersion, goplsImportPath, goplsPins, goplsVersion,
  installGoTool, minimumGoForInstall, toolInstallationEnvironment, type GoEnvironment, type RunGo } from './go-tools';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-go-tools-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const named = (tool: string) => process.platform === 'win32' ? `${tool}.exe` : tool;
const folder = (...parts: string[]) => path.join(directory, ...parts);
/** A program as `go install` leaves it. `mode` 0o644 is a file that may not be run. */
async function program(inFolder: string, tool = 'gopls', mode = 0o755): Promise<string> {
  const file = path.join(inFolder, named(tool));
  await mkdir(inFolder, { recursive: true }); await writeFile(file, '#!/bin/sh\nexit 1\n'); await chmod(file, mode);
  return file;
}
/** What `goEnvironment` returns for a computer whose Go states only what a test names. */
const answered = (values: Partial<GoEnvironment> = {}): GoEnvironment => ({ executable: folder('go', 'bin', named('go')), source: 'PATH', GOPATH: '', GOROOT: '', GOPROXY: '', GOBIN: '', GOMODCACHE: '', GOVERSION: 'go1.22.3', ...values });
type Call = { file: string; args: string[]; options: Parameters<RunGo>[2] };
/** A `go` that is never executed: it records how it was called and answers with what the test gives. */
function recorded(answer: (call: Call) => string | Promise<string> = () => ''): { calls: Call[]; run: RunGo } {
  const calls: Call[] = [];
  return { calls, run: async (file, args, options) => { calls.push({ file, args, options }); return { stdout: await answer({ file, args, options }) }; } };
}

test('an installed tool is found in GOBIN, then GOPATH, then GOROOT, then PATH', async () => {
  const gobin = await program(folder('gobin')), gopath = await program(folder('gopath', 'bin')), goroot = await program(folder('goroot', 'bin')), onPath = await program(folder('usr', 'bin'));
  const env = { GOBIN: folder('gobin'), GOPATH: folder('gopath'), GOROOT: folder('goroot'), PATH: [folder('empty'), folder('usr', 'bin')].join(path.delimiter) };
  expect(await findGoTool('gopls', env)).toEqual({ path: gobin, source: 'GOBIN' });
  await rm(gobin); expect(await findGoTool('gopls', env)).toEqual({ path: gopath, source: 'GOPATH' });
  await rm(gopath); expect(await findGoTool('gopls', env)).toEqual({ path: goroot, source: 'GOROOT' });
  await rm(goroot); expect(await findGoTool('gopls', env)).toEqual({ path: onPath, source: 'PATH' });
  await rm(onPath); expect(await findGoTool('gopls', env)).toBeUndefined();
  // Another tool of the same folders is not gopls.
  await program(folder('gobin'), 'dlv'); expect(await findGoTool('gopls', env)).toBeUndefined();
  expect(await findGoTool('dlv', env)).toMatchObject({ source: 'GOBIN' });
});

test('what Go answered fills in for the environment, and GOPATH may be several folders', async () => {
  const second = await program(folder('work', 'bin')), installed = await program(folder('home', 'go', 'bin')), sdk = await program(folder('sdk', 'bin'));
  // No GOBIN and no GOPATH in the environment: the ones `go env` states are looked in.
  const go = answered({ GOBIN: folder('home', 'go', 'bin'), GOPATH: [folder('first'), folder('work')].join(path.delimiter), GOROOT: folder('sdk') });
  expect(await findGoTool('gopls', { PATH: '' }, go)).toEqual({ path: installed, source: 'GOBIN' });
  expect(await findGoTool('gopls', { PATH: '' }, { ...go, GOBIN: '' })).toEqual({ path: second, source: 'GOPATH' });
  // The environment's own GOBIN and GOPATH are used in place of Go's answer, not beside it.
  expect(await findGoTool('gopls', { PATH: '', GOBIN: folder('first'), GOPATH: folder('first') }, go)).toEqual({ path: sdk, source: 'GOROOT' });
  // GOROOT is the one Go states, before the environment's.
  const stale = await program(folder('stale', 'bin'));
  expect(await findGoTool('gopls', { PATH: '', GOROOT: folder('stale') }, answered({ GOROOT: folder('sdk') }))).toEqual({ path: sdk, source: 'GOROOT' });
  expect(await findGoTool('gopls', { PATH: '', GOROOT: folder('stale') }, answered())).toEqual({ path: stale, source: 'GOROOT' });
  expect(await findGoTool('gopls', { PATH: '', GOROOT: folder('stale') })).toEqual({ path: stale, source: 'GOROOT' });
});

test('only a file that may be run, under a full path, is a program', async () => {
  // A folder that has the tool's name, a GOPATH that is a file, and PATH entries that are not full paths.
  await mkdir(folder('gobin', named('gopls')), { recursive: true }); await writeFile(folder('gopath'), '');
  const onPath = await program(folder('usr', 'bin'));
  const env = { GOBIN: folder('gobin'), GOPATH: folder('gopath'), PATH: ['', 'relative', folder('usr', 'bin')].join(path.delimiter) };
  expect(await findGoTool('gopls', env)).toEqual({ path: onPath, source: 'PATH' });
  if (process.platform === 'win32') return;
  await chmod(onPath, 0o644); expect(await findGoTool('gopls', env)).toBeUndefined();
  // The folders are tried in the order written, and a file that may not be run does not end the search.
  await program(folder('first'), 'gopls', 0o644); const later = await program(folder('later'));
  expect(await findGoTool('gopls', { PATH: [folder('first'), folder('later')].join(path.delimiter) })).toEqual({ path: later, source: 'PATH' });
});

test('go itself is found in GOBIN, then GOROOT, then PATH, then where the installers put it', async () => {
  const gobin = await program(folder('gobin'), 'go'), goroot = await program(folder('goroot', 'bin'), 'go'), onPath = await program(folder('usr', 'bin'), 'go'), usual = await program(folder('usr', 'local', 'go', 'bin'), 'go');
  // GOPATH is not a place for `go`.
  await program(folder('gopath', 'bin'), 'go');
  const env = { GOBIN: folder('gobin'), GOPATH: folder('gopath'), GOROOT: folder('goroot'), PATH: folder('usr', 'bin') };
  const places = [folder('missing', named('go')), usual];
  expect(await findGo(env, places)).toEqual({ path: gobin, source: 'GOBIN' });
  await rm(gobin); expect(await findGo(env, places)).toEqual({ path: goroot, source: 'GOROOT' });
  await rm(goroot); expect(await findGo(env, places)).toEqual({ path: onPath, source: 'PATH' });
  await rm(onPath); expect(await findGo(env, places)).toEqual({ path: usual, source: 'default' });
  await rm(usual); expect(await findGo(env, places)).toBeUndefined();
});

test('Go is asked once, and its answer is read without being executed in a test', async () => {
  const go = await program(folder('usr', 'bin'), 'go');
  const stated = { GOBIN: '', GOMODCACHE: '/home/person/go/pkg/mod', GOPATH: ' /home/person/go\n', GOPROXY: 'https://proxy.golang.org,direct', GOROOT: '/usr/lib/golang', GOVERSION: 'go1.22.3' };
  const asked = recorded(() => JSON.stringify(stated));
  const env = { PATH: folder('usr', 'bin'), GOFLAGS: '-mod=mod -json -count=1', HOME: folder('home') };
  expect(await goEnvironment(env, asked.run, { places: [] })).toEqual({ ...stated, GOPATH: '/home/person/go', executable: go, source: 'PATH' });
  expect(asked.calls).toHaveLength(1);
  expect([asked.calls[0].file, asked.calls[0].args]).toEqual([go, ['env', '-json', 'GOPATH', 'GOROOT', 'GOPROXY', 'GOBIN', 'GOMODCACHE', 'GOVERSION']]);
  // The environment is the given one, without the flag that would change what `go` prints, and is not changed in place.
  expect(asked.calls[0].options.env).toEqual({ ...env, GOFLAGS: '-mod=mod -count=1' });
  expect(env.GOFLAGS).toBe('-mod=mod -json -count=1');
  expect(asked.calls[0].options.timeout).toBeGreaterThan(0);
  expect(asked.calls[0].options.cwd).toBeUndefined();
  // The Go that installs is asked as the local one; the Go of a project is asked in the project's folder.
  await goEnvironment(env, asked.run, { places: [], toolchain: 'local', cwd: folder('project') });
  expect(asked.calls[1].options).toMatchObject({ cwd: folder('project'), env: { GOTOOLCHAIN: 'local' } });
  // A value Go did not state is empty.
  expect(await goEnvironment(env, recorded(() => '{"GOROOT":"/sdk","GOBIN":7}').run, { places: [] })).toEqual(answered({ executable: go, GOROOT: '/sdk', GOVERSION: '' }));
});

test('there is no Go to speak of when it is missing or does not answer', async () => {
  const none = recorded(() => '{}');
  expect(await goEnvironment({ PATH: folder('usr', 'bin') }, none.run, { places: [] })).toBeUndefined();
  expect(none.calls).toEqual([]);
  await program(folder('usr', 'bin'), 'go');
  const env = { PATH: folder('usr', 'bin') };
  expect(await goEnvironment(env, async () => { throw new Error('spawn EACCES'); }, { places: [] })).toBeUndefined();
  for (const output of ['', 'go: unknown flag -json', '[]', 'null']) expect(await goEnvironment(env, recorded(() => output).run, { places: [] })).toBeUndefined();
});

test('an old Go gets the last gopls it can build', () => {
  const versions = (...stated: (string | undefined)[]) => stated.map(goplsVersion);
  expect(versions('go1.18', 'go1.18.10', 'go1.17.13')).toEqual(['v0.14.2', 'v0.14.2', 'v0.14.2']);
  // 1.9 is older than 1.19: the numbers are compared, not the text.
  expect(versions('go1.9.7', 'go1.2')).toEqual(['v0.14.2', 'v0.14.2']);
  expect(versions('go1.19', 'go1.19.13', 'go1.20', 'go1.20.14')).toEqual(['v0.15.3', 'v0.15.3', 'v0.15.3', 'v0.15.3']);
  expect(versions('go1.21', 'go1.21.0', 'go1.21.13', 'go1.22.3', 'go1.27.4-X:nodwarf5')).toEqual(['latest', 'latest', 'latest', 'latest', 'latest']);
  // A release candidate or beta counts as its release, on both sides of a limit.
  expect(versions('go1.19rc2', 'go1.21rc2', 'go1.21beta1', 'go1.20rc1')).toEqual(['v0.15.3', 'latest', 'latest', 'v0.15.3']);
  // A development build, and a version that cannot be read, are taken to be new.
  expect(versions('devel go1.18-cd294f55ca Mon Apr 1 20:28:41 2024 +0000', '', undefined, 'unknown', '1.18')).toEqual(['latest', 'latest', 'latest', 'latest', 'latest']);
  expect(goplsDefaultVersion).toBe('latest');
});

test('a tool is installed for this computer, with Go at its defaults', () => {
  const env = { PATH: '/usr/bin', HOME: '/home/person', GOOS: 'windows', GOARCH: 'arm64', GOROOT: '/old/sdk', GOFLAGS: '-mod=vendor', GOENV: '/etc/go.env', GO111MODULE: 'off',
    GOTOOLCHAIN: 'local', GOPRIVATE: 'example.com', https_proxy: 'http://proxy:3128' };
  const go = answered({ GOPATH: '/home/person/go', GOBIN: '/home/person/bin', GOMODCACHE: '/cache/mod', GOPROXY: 'https://corp.example/proxy', GOROOT: '/usr/lib/golang' });
  const result = toolInstallationEnvironment(env, go);
  expect(result).toEqual({ PATH: '/usr/bin', HOME: '/home/person', GOPRIVATE: 'example.com', https_proxy: 'http://proxy:3128',
    GOTOOLCHAIN: 'auto', GOPATH: '/home/person/go', GOBIN: '/home/person/bin', GOMODCACHE: '/cache/mod', GOPROXY: 'https://corp.example/proxy' });
  for (const name of clearedForInstall) expect(name in result).toBe(false);
  // A new object each time; the given environment keeps what it had.
  expect(env).toMatchObject({ GOOS: 'windows', GOROOT: '/old/sdk', GOTOOLCHAIN: 'local' });
  expect(toolInstallationEnvironment(env, go)).not.toBe(result);
  // What the environment sets is not replaced by Go's answer.
  const own = { GOPATH: '/own/go', GOBIN: '/own/bin', GOMODCACHE: '/own/mod', GOPROXY: 'direct' };
  expect(toolInstallationEnvironment(own, go)).toEqual({ ...own, GOTOOLCHAIN: 'auto' });
  // GOPATH is always written, GOBIN and the others only when someone states them.
  expect(toolInstallationEnvironment({}, answered())).toEqual({ GOPATH: '', GOTOOLCHAIN: 'auto' });
});

test('a project on a newer Go has its tool built with that Go', () => {
  const toolchain = (installing: string, project?: string) => toolInstallationEnvironment({}, answered({ GOVERSION: installing }), project).GOTOOLCHAIN;
  expect(toolchain('go1.22.3', 'go1.23.4')).toBe('go1.23.4+auto');
  expect(toolchain('go1.22.3', 'go1.22.4')).toBe('go1.22.4+auto');
  // The project's version is written as Go states it, release candidate included.
  expect(toolchain('go1.23.4', 'go1.24rc1')).toBe('go1.24rc1+auto');
  // The same or an older Go, or no project, leaves the choice to Go.
  expect([toolchain('go1.22.3', 'go1.22.3'), toolchain('go1.22.3', 'go1.21.13'), toolchain('go1.22.3'), toolchain('go1.22rc1', 'go1.22')]).toEqual(['auto', 'auto', 'auto', 'auto']);
  // A development build on either side, or a version that cannot be read, changes nothing.
  expect([toolchain('go1.22.3', 'devel go1.26-cd294f55ca Mon Apr 1 20:28:41 2024 +0000'), toolchain('devel go1.20-41f485b9a7 Mon Jan 31 13:43:52 2022 +0000', 'go1.23.4'),
    toolchain('go1.22.3', '1.23.4'), toolchain('', 'go1.23.4')]).toEqual(['auto', 'auto', 'auto', 'auto']);
});

test('gopls is installed with `go install -v` into the given folder', async () => {
  const destination = folder('packages', 'gopls', 'bin');
  const go = answered({ GOPATH: '/home/person/go', GOBIN: '/home/person/go/bin' });
  // `go install` puts the program in GOBIN.
  const install = recorded(async call => { await program(call.options.env.GOBIN ?? '', path.basename(call.args[2].split('@')[0])); return ''; });
  const stop = new AbortController();
  const env = { PATH: '/usr/bin', GOFLAGS: '-mod=vendor', GOOS: 'plan9', GOBIN: '/somewhere/else' };
  const installed = await installGoTool({ go, env, destination, projectGoVersion: 'go1.23.4', cwd: folder('project'), run: install.run, signal: stop.signal });
  expect(installed).toBe(path.join(destination, named('gopls')));
  expect(install.calls).toHaveLength(1);
  expect([install.calls[0].file, install.calls[0].args]).toEqual([go.executable, ['install', '-v', 'golang.org/x/tools/gopls@latest']]);
  expect(install.calls[0].options.env).toEqual({ PATH: '/usr/bin', GOPATH: '/home/person/go', GOBIN: destination, GOTOOLCHAIN: 'go1.23.4+auto' });
  expect(install.calls[0].options).toMatchObject({ cwd: folder('project'), signal: stop.signal });
  expect(install.calls[0].options.timeout).toBeGreaterThan(60_000);
  // Another tool states its own path and version.
  const other = await installGoTool({ go, env, destination, tool: { name: 'dlv', importPath: 'github.com/go-delve/delve/cmd/dlv', version: 'v1.22.1' }, run: install.run });
  expect(other).toBe(path.join(destination, named('dlv')));
  expect(install.calls[1].args).toEqual(['install', '-v', 'github.com/go-delve/delve/cmd/dlv@v1.22.1']);
  expect(install.calls[1].options.env.GOTOOLCHAIN).toBe('auto');
  // A development build of Go is taken to be new enough.
  await installGoTool({ go: answered({ GOVERSION: 'devel go1.20-41f485b9a7 Mon Jan 31 13:43:52 2022 +0000' }), env, destination, run: install.run });
  expect(install.calls[2].args).toEqual(['install', '-v', 'golang.org/x/tools/gopls@latest']);
});

test('nothing is installed with a Go that is too old, and a failed install says why', async () => {
  const destination = folder('bin'), env = { PATH: '/usr/bin' };
  const never = recorded();
  const old = installGoTool({ go: answered({ GOVERSION: 'go1.20.14' }), env, destination, run: never.run });
  // The refusal names the limit, the Go that was found, and the gopls that Go can build by hand.
  await expect(old).rejects.toThrow(`Go ${minimumGoForInstall} or newer`);
  await expect(old).rejects.toThrow('is 1.20.14');
  await expect(old).rejects.toThrow('go install -v golang.org/x/tools/gopls@v0.15.3');
  await expect(installGoTool({ go: answered({ GOVERSION: 'go1.18.10' }), env, destination, run: never.run })).rejects.toThrow('golang.org/x/tools/gopls@v0.14.2');
  await expect(installGoTool({ go: answered({ GOVERSION: '' }), env, destination, run: never.run })).rejects.toThrow('states no version');
  expect(never.calls).toEqual([]);
  // The limit itself, and its release candidate, install.
  const install = recorded(async call => { await program(call.options.env.GOBIN ?? ''); return ''; });
  for (const version of ['go1.21.0', 'go1.21rc2']) await installGoTool({ go: answered({ GOVERSION: version }), env, destination, run: install.run });
  expect(install.calls.map(call => call.args[2])).toEqual(['golang.org/x/tools/gopls@latest', 'golang.org/x/tools/gopls@latest']);
  await rm(destination, { recursive: true });
  // What `go` printed is in the error, and so is the case where it printed nothing and left nothing.
  const failed = installGoTool({ go: answered(), env, destination, run: async () => { throw new Error('Command failed: go install\ngo: golang.org/x/tools/gopls@latest: dial tcp: no route to host'); } });
  await expect(failed).rejects.toThrow('no route to host');
  await expect(failed).rejects.toThrow('go install -v golang.org/x/tools/gopls@latest failed');
  await expect(installGoTool({ go: answered(), env, destination, run: never.run })).rejects.toThrow('is not there');
  // A person who stops the install gets the stop back, not an install failure, and `go` is not started after it.
  const stop = new AbortController(); stop.abort();
  await expect(installGoTool({ go: answered(), env, destination, run: never.run, signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(never.calls).toHaveLength(1);
  const during = new AbortController();
  const stopped = installGoTool({ go: answered(), env, destination, signal: during.signal, run: async () => { during.abort(); throw during.signal.reason; } });
  await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
});

// What was copied from the VS Code Go extension is compared with the copy in `vendor`, so a
// newer submodule that changes a version, a limit or a list fails here and not in someone's project.
const upstream = fileURLToPath(new URL('../../../../../vendor/vscode-go/extension', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the copied rules are the ones vendor/vscode-go states', () => {
  const source = (file: string) => readFileSync(path.join(upstream, 'src', file), 'utf8');
  const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map(match => match.slice(1));

  // goTools.ts: the gopls rows of `getImportPathWithVersion`, every one of them, and what the function ends at.
  const tools = source('goTools.ts');
  const rows = /if \(tool\.name === 'gopls'\) \{\n([\s\S]*?)\n\t\}/.exec(tools)?.[1] ?? '';
  expect(all(rows, /^\t\tif \(goVersion\.lt\('([\d.]+)'\)\) return importPath \+ '@(v[\d.]+)';/gm).map(([below, version]) => ({ below, version }))).toEqual(goplsPins);
  expect(rows.split('\n')).toHaveLength(goplsPins.length);
  expect(tools).toContain("return importPath + '@' + tool.defaultVersion;");
  expect(tools).toContain(`return importPath + '@${goplsDefaultVersion}';`);

  // goToolsInformation.ts: the gopls entry.
  const entry = /\[\n\t\t'gopls',\n\t\t\{\n([\s\S]*?)\n\t\t\}/.exec(source('goToolsInformation.ts'))?.[1] ?? '';
  expect(/^\t\t\timportPath: '([^']+)',$/m.exec(entry)?.[1]).toBe(goplsImportPath);
  expect(/defaultVersion: '([^']+)'/.exec(entry)?.[1] ?? 'latest').toBe(goplsDefaultVersion);

  // goInstallTools.ts: the oldest Go that installs, the project's Go as the toolchain, the command, and the `go env` question.
  const install = source('goInstallTools.ts');
  expect(/^const MINIMUM_GO_VERSION = '([^']+)';$/m.exec(install)?.[1]).toBe(minimumGoForInstall);
  expect(install).toContain('if (goForInstall.lt(MINIMUM_GO_VERSION)) {');
  expect(install).toContain("envForTools['GOTOOLCHAIN'] = `go${version}+auto`;");
  expect(install).toContain("await execFile(goBinary, ['install', '-v', importPath], opts);");
  const question = /\['env', '-json', ([^\]]+)\]/.exec(install)?.[1] ?? '';
  expect([...all(question, /'(\w+)'/g).flat(), 'GOVERSION']).toEqual(goEnvNames);

  // goEnv.ts: what `toolInstallationEnvironment` sets and takes out.
  const environment = /export function toolInstallationEnvironment\(\)[\s\S]*?\n\}/.exec(source('goEnv.ts'))?.[0] ?? '';
  expect(all(environment, /delete env\['(\w+)'\];/g).flat()).toEqual(clearedForInstall);
  expect(all(environment, /env\['(\w+)'\] = ([^;]+);/g)).toEqual([['GOBIN', "''"], ['GOPATH', 'toolsGopath'], ['GOTOOLCHAIN', "'auto'"]]);

  // pathUtils.ts: where `go` is looked for last, and the order of the search.
  const paths = source('utils/pathUtils.ts');
  const places = /defaultPathsForGo =\s+process\.platform === 'win32'\s+\? \[([^\]]+)\]\s+: \[([^\]]+)\];/.exec(paths) ?? [];
  const listed = (text = '') => all(text, /'([^']+)'/g).flat().map(file => file.replaceAll('\\\\', '\\'));
  expect({ win32: listed(places[1]), other: listed(places[2]) }).toEqual(goDefaultPlaces);
  const search = paths.slice(paths.indexOf('export function getBinPathWithPreferredGopathGorootWithExplanation'), paths.indexOf('let currentGoRoot'));
  expect(all(search, /return \{ binPath: \w+, why: (?:binname === toolName \? '(\w+)'|found\('(\w+)'\)|'(default)')/g).map(why => why.find(Boolean))).toEqual(['gobin', 'gopath', 'goroot', 'path', 'default']);
  expect(all(search, /getBinPathFromEnvVar\(binname, ([^;]+), (true|false)\);/g)).toEqual([["process.env['GOBIN']", 'false'], ['preferred', 'true'], ['preferredGoroot || getCurrentGoRoot()', 'true'], ['getEnvPath()', 'false']]);

  // util.ts: the folders the search is given, and how a version is read from what Go prints.
  const util = source('util.ts');
  expect(util).toContain("tool === 'go' ? [] : [getToolsGopath(), getCurrentGoPath()],");
  expect(util).toContain('const matchesRelease = /^go version go(\\d\\.\\d+\\S*)\\s+/.exec(version);');
  expect(util).toContain('const matchesDevel = /^go version devel go(\\d\\.\\d+\\S*)\\s+/.exec(version);');
});
