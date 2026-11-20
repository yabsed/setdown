import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goplsPins, minimumGoForInstall, type GoEnvironment, type RunGo } from './go-tools';
import { delveProcessors, goFormatTool, goTool, goToolPins, goToolTable, goToolVersion, installTableTool, missingGoTool, requiredGoTools, sharedProgramName, type GoTool } from './go-tool-table';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-go-tool-table-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const named = (tool: string) => process.platform === 'win32' ? `${tool}.exe` : tool;
const row = (name: string): GoTool => { const tool = goTool(name); if (!tool) throw new Error(`no ${name} in the table`); return tool; };
const names = (tools: GoTool[]) => tools.map(tool => tool.name);
const answered = (values: Partial<GoEnvironment> = {}): GoEnvironment => ({ executable: path.join(directory, 'go', 'bin', named('go')), source: 'PATH', GOPATH: '', GOROOT: '', GOPROXY: '', GOBIN: '', GOMODCACHE: '', GOVERSION: 'go1.25.3', ...values });
type Call = { file: string; args: string[]; options: Parameters<RunGo>[2] };
/** A `go install` that is never executed: it records how it was called and leaves a program in GOBIN
 * under the name Go would give it, the last part of the import path. */
function installer(): { calls: Call[]; run: RunGo } {
  const calls: Call[] = [];
  return { calls, run: async (file, args, options) => {
    calls.push({ file, args, options });
    const bin = options.env.GOBIN ?? '', program = path.join(bin, named(path.basename((args.at(-1) ?? '').split('@')[0])));
    await mkdir(bin, { recursive: true }); await writeFile(program, `built from ${args.at(-1)}`); await chmod(program, 0o755);
    return { stdout: '' };
  } };
}

test('a row is found by the tool name, with or without a version', () => {
  expect(goTool('staticcheck')?.importPath).toBe('honnef.co/go/tools/cmd/staticcheck');
  expect(goTool('staticcheck@v0.4.7')).toBe(goTool('staticcheck'));
  expect(goTool('golangci-lint-v2')?.importPath).toBe('github.com/golangci/golangci-lint/v2/cmd/golangci-lint');
  // gopls is not in this table, and neither is a tool the extension does not know.
  for (const name of ['gopls', 'gofmt', 'customFormatter', '', '@latest', 'Staticcheck']) expect(goTool(name)).toBeUndefined();
  expect(new Set(names([...goToolTable])).size).toBe(goToolTable.length);
});

test('dlv and vscgo are in the table and marked never to be installed', () => {
  expect(names(goToolTable.filter(tool => tool.neverInstalled))).toEqual(['dlv', 'vscgo']);
  // The reason is a sentence a person can be shown.
  for (const tool of goToolTable) if (tool.neverInstalled) expect(tool.neverInstalled).toMatch(/^\S.+ Setdown .+\.$/);
});

test('an old Go gets the last version of a tool it can build', () => {
  const versions = (name: string, ...go: string[]) => go.map(version => goToolVersion(row(name), version));
  expect(versions('staticcheck', 'go1.18.10', 'go1.19', 'go1.20.14', 'go1.21.0', 'go1.25.3')).toEqual(['v0.3.3', 'v0.4.7', 'v0.4.7', 'latest', 'latest']);
  expect(versions('gofumpt', 'go1.18', 'go1.19.1', 'go1.20', 'go1.21.9', 'go1.22.0', 'go1.23.1', 'go1.24.2', 'go1.25.0')).toEqual(['v0.4.0', 'v0.5.0', 'v0.6.0', 'v0.6.0', 'v0.7.0', 'v0.8.0', 'v0.9.0', 'v0.10.0']);
  expect(versions('golangci-lint', 'go1.19.5', 'go1.20.1', 'go1.21.0')).toEqual(['v1.53.3', 'v1.55.2', 'latest']);
  expect(versions('golangci-lint-v2', 'go1.25.3', 'go1.26.0')).toEqual(['v2.12.2', 'v2.15.0']);
  expect(versions('dlv', 'go1.18', 'go1.20', 'go1.22')).toEqual(['v1.20.2', 'v1.22.1', 'latest']);
  // No pinned rows: the table's version, or the newest.
  expect(versions('revive', 'go1.16', 'go1.25.3')).toEqual(['v1.15.0', 'v1.15.0']);
  expect(versions('goimports', 'go1.16', 'go1.25.3')).toEqual(['latest', 'latest']);
  // A release candidate counts as its release. A development build and an unreadable version count as newer than every release.
  expect(versions('golangci-lint-v2', 'go1.26rc1', 'devel go1.27-0a1b2c3', 'nonsense', '')).toEqual(['v2.15.0', 'v2.15.0', 'v2.15.0', 'v2.15.0']);
  expect(goToolVersion(row('golangci-lint-v2'), undefined)).toBe('v2.15.0');
  // A tool that happens to be named like something every object has gets no rows from there.
  expect(goToolVersion({ ...row('goimports'), name: 'constructor' }, 'go1.10')).toBe('latest');
});

test('the tools a configuration needs, with gopls in use', () => {
  // Nothing written: what the extension always wants, and Delve where it runs. gotests is replaced by gopls.
  expect(names(requiredGoTools({}, 'x64'))).toEqual(['impl', 'goplay', 'dlv']);
  expect(names(requiredGoTools(undefined, 'arm64'))).toEqual(['impl', 'goplay', 'dlv']);
  expect(names(requiredGoTools({}, 'ia32'))).toEqual(['impl', 'goplay']);
  expect(names(requiredGoTools({}, 'arm'))).toEqual(['impl', 'goplay']);
  expect(names(requiredGoTools({})).slice(0, 2)).toEqual(['impl', 'goplay']);

  // The linter and the formatter a person named, in either way of writing a setting.
  expect(names(requiredGoTools({ 'go.lintTool': 'staticcheck' }, 'ia32'))).toEqual(['impl', 'goplay', 'staticcheck']);
  expect(names(requiredGoTools({ go: { lintTool: 'golangci-lint-v2', formatTool: 'gofumpt' } }, 'ia32'))).toEqual(['impl', 'goplay', 'gofumpt', 'golangci-lint-v2']);
  expect(names(requiredGoTools({ 'go.formatTool': 'goimports', 'go.lintTool': 'revive' }, 'x64'))).toEqual(['impl', 'goplay', 'dlv', 'goimports', 'revive']);
  // Formatters and linters the table does not have are passed over; gopls formats when the setting says `default`.
  for (const formatTool of ['default', 'gofmt', 'goformat', 'custom', '', 7, null, ['gofumpt']]) expect(names(requiredGoTools({ 'go.formatTool': formatTool }, 'ia32'))).toEqual(['impl', 'goplay']);
  for (const lintTool of ['', 'my-linter', 'gopls', 7, null, { name: 'revive' }]) expect(names(requiredGoTools({ 'go.lintTool': lintTool }, 'ia32'))).toEqual(['impl', 'goplay']);
  // A tool named twice is needed once, and one gopls replaces is not needed however it is named.
  expect(names(requiredGoTools({ 'go.lintTool': 'impl' }, 'ia32'))).toEqual(['impl', 'goplay']);
  expect(names(requiredGoTools({ 'go.lintTool': 'gotests' }, 'ia32'))).toEqual(['impl', 'goplay']);

  expect(goFormatTool({})).toBe('');
  expect(goFormatTool({ 'go.formatTool': 'default' })).toBe('');
  expect(goFormatTool({ 'go.formatTool': 'custom' })).toBe('customFormatter');
  expect(goFormatTool({ 'go.formatTool': 'gofmt' })).toBe('gofmt');
});

test('what a person is told about a missing tool', () => {
  expect(missingGoTool('staticcheck', 'go1.25.3')).toEqual({ name: 'staticcheck', tool: row('staticcheck'), command: 'go install -v honnef.co/go/tools/cmd/staticcheck@latest',
    message: 'The "staticcheck" command is not available. Run "go install -v honnef.co/go/tools/cmd/staticcheck@latest" to install.' });
  // The version named is the one the project's Go can build.
  expect(missingGoTool('staticcheck', 'go1.20.14').command).toBe('go install -v honnef.co/go/tools/cmd/staticcheck@v0.4.7');
  expect(missingGoTool('golangci-lint-v2', 'go1.26.0').command).toBe('go install -v github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0');
  expect(missingGoTool('revive@v1.15.0', undefined).command).toBe('go install -v github.com/mgechev/revive@v1.15.0');

  // The project's Go is older than the tool asks for: nothing is offered.
  expect(missingGoTool('golangci-lint', 'go1.19.5')).toEqual({ name: 'golangci-lint', tool: row('golangci-lint'), message: 'You are using go1.19.5, but golangci-lint requires at least go1.20.0.' });
  expect(missingGoTool('golangci-lint-v2', 'go1.25.3').message).toBe('You are using go1.25.3, but golangci-lint-v2 requires at least go1.26.0.');
  expect(missingGoTool('golangci-lint-v2', 'go1.26rc1').command).toBeDefined();
  expect(missingGoTool('golint', 'go1.8.7').message).toBe('You are using go1.8.7, but golint requires at least go1.9.0.');
  expect(missingGoTool('golangci-lint-v2', 'devel go1.27-0a1b2c3').command).toBeDefined();

  // A tool the table does not know is only reported, and one Setdown never installs says why.
  expect(missingGoTool('my-linter', 'go1.25.3', '/usr/bin:/bin')).toEqual({ name: 'my-linter', message: 'my-linter is not found. Please make sure it is installed and available in the PATH /usr/bin:/bin' });
  expect(missingGoTool('my-linter', 'go1.25.3')).toEqual({ name: 'my-linter', message: 'my-linter is not found. Please make sure it is installed and available in the PATH' });
  expect(missingGoTool('dlv', 'go1.25.3')).toEqual({ name: 'dlv', tool: row('dlv'), message: 'dlv is not installed by Setdown. Delve is the Go debugger, and Setdown has no debugger.' });
  expect(missingGoTool('vscgo', 'go1.25.3').command).toBeUndefined();
});

test('a table tool is installed with the install of go-tools, at the version for the Go that installs', async () => {
  const destination = path.join(directory, 'tools', 'bin'), { calls, run } = installer();
  const file = await installTableTool({ tool: row('staticcheck'), go: answered(), env: { PATH: '/usr/bin', GOFLAGS: '-mod=vendor' }, destination, cwd: directory, run });
  expect(file).toBe(path.join(destination, named('staticcheck')));
  expect(calls).toHaveLength(1);
  expect(calls[0].file).toBe(answered().executable);
  expect(calls[0].args).toEqual(['install', '-v', 'honnef.co/go/tools/cmd/staticcheck@latest']);
  expect(calls[0].options.cwd).toBe(directory);
  // The install environment of go-tools: the program lands in the destination and the person's build flags are taken out.
  expect(calls[0].options.env).toMatchObject({ GOBIN: destination, GOTOOLCHAIN: 'auto' });
  expect(calls[0].options.env.GOFLAGS).toBeUndefined();

  // A table version, and a pinned one for the Go that installs.
  await installTableTool({ tool: row('revive'), go: answered(), env: {}, destination, run });
  await installTableTool({ tool: row('gofumpt'), go: answered({ GOVERSION: 'go1.22.5' }), env: {}, destination, run });
  expect(calls.slice(1).map(call => call.args.at(-1))).toEqual(['github.com/mgechev/revive@v1.15.0', 'mvdan.cc/gofumpt@v0.7.0']);
});

test('a tool named -v2 is built in a temporary folder and copied out under its own name', async () => {
  expect(sharedProgramName('golangci-lint-v2')).toBe('golangci-lint');
  expect(sharedProgramName('tool-v10')).toBe('tool');
  for (const name of ['golangci-lint', 'gopls', 'tool-v', 'tool-v2x', '-v2']) expect(sharedProgramName(name)).toBeUndefined();

  const destination = path.join(directory, 'tools', 'bin'), { calls, run } = installer();
  // The first major version is already there under the name both are built with.
  await mkdir(destination, { recursive: true }); await writeFile(path.join(destination, named('golangci-lint')), 'the v1 program');
  const file = await installTableTool({ tool: row('golangci-lint-v2'), go: answered({ GOVERSION: 'go1.26.0' }), env: {}, destination, run });
  expect(file).toBe(path.join(destination, named('golangci-lint-v2')));
  expect(calls[0].args).toEqual(['install', '-v', 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0']);
  expect(calls[0].options.env.GOBIN).toBe(path.join(destination, 'tmp'));
  expect(await readFile(file, 'utf8')).toBe('built from github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0');
  expect(await readFile(path.join(destination, named('golangci-lint')), 'utf8')).toBe('the v1 program');
  expect(existsSync(path.join(destination, 'tmp'))).toBe(false);

  // An install that fails leaves no temporary folder behind and no program.
  const failing: RunGo = async (_file, _args, options) => { await mkdir(options.env.GOBIN ?? '', { recursive: true }); throw new Error('exit status 1'); };
  await rm(file);
  await expect(installTableTool({ tool: row('golangci-lint-v2'), go: answered({ GOVERSION: 'go1.26.0' }), env: {}, destination, run: failing })).rejects.toThrow(/golangci-lint was not installed: go install -v .*@v2\.15\.0 failed\. exit status 1/);
  expect(existsSync(path.join(destination, 'tmp'))).toBe(false);
  expect(existsSync(file)).toBe(false);
});

test('nothing is installed for a row marked never, or with a Go too old to install', async () => {
  const destination = path.join(directory, 'tools', 'bin'), { calls, run } = installer();
  await expect(installTableTool({ tool: row('dlv'), go: answered(), env: {}, destination, run })).rejects.toThrow('dlv was not installed: Delve is the Go debugger, and Setdown has no debugger.');
  await expect(installTableTool({ tool: row('vscgo'), go: answered(), env: {}, destination, run })).rejects.toThrow(/^vscgo was not installed: vscgo is the telemetry helper/);
  // The refusal of go-tools names the version this Go would build, for installing by hand.
  await expect(installTableTool({ tool: row('staticcheck'), go: answered({ GOVERSION: 'go1.20.14' }), env: {}, destination, run }))
    .rejects.toThrow(`Go ${minimumGoForInstall} or newer. With this Go it is installed by hand: go install -v honnef.co/go/tools/cmd/staticcheck@v0.4.7`);
  await expect(installTableTool({ tool: row('golangci-lint-v2'), go: answered({ GOVERSION: '' }), env: {}, destination, run })).rejects.toThrow(/states no version that can be read/);
  expect(calls).toEqual([]);
  expect(existsSync(destination)).toBe(false);
});

const upstream = fileURLToPath(new URL('../../../../../vendor/vscode-go/extension', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the table and its rules are the ones vendor/vscode-go states', () => {
  const source = (file: string) => readFileSync(path.join(upstream, 'src', file), 'utf8');

  // goToolsInformation.ts: every entry, field by field, in order. gopls is the one entry kept elsewhere.
  const information = source('goToolsInformation.ts');
  const entries = [...information.matchAll(/\t\[\n\t\t'([\w-]+)',\n\t\t\{\n([\s\S]*?)\n\t\t\}\n\t\]/g)].map(([, key, body]) => ({ key, body }));
  const text = (body: string, name: string) => new RegExp(`^\\t\\t\\t${name}: '([^']*)'`, 'm').exec(body)?.[1];
  const flag = (body: string, name: string) => new RegExp(`^\\t\\t\\t${name}: true\\b`, 'm').test(body);
  const stated = entries.filter(entry => entry.key !== 'gopls').map(({ body }) => {
    const defaultVersion = text(body, 'defaultVersion'), minimumGo = /^\t\t\tminimumGoVersion: semver\.coerce\('([\d.]+)'\)/m.exec(body)?.[1];
    return { name: text(body, 'name'), importPath: text(body, 'importPath'), modulePath: text(body, 'modulePath'), replacedByGopls: flag(body, 'replacedByGopls'), important: flag(body, 'isImportant'),
      description: text(body, 'description'), ...defaultVersion ? { defaultVersion } : {}, ...minimumGo ? { minimumGo } : {} };
  });
  expect(stated).toEqual(goToolTable.map(({ neverInstalled: _never, ...tool }) => tool));
  expect(entries.map(entry => entry.key)).toEqual([...names(goToolTable.slice(0, -2)), 'gopls', 'dlv', 'vscgo']);
  for (const { key, body } of entries) {
    expect(text(body, 'name')).toBe(key);
    // A field the table here has no place for would be a rule that was not carried over.
    for (const line of body.split('\n')) expect(line).toMatch(/^\t\t\t(name|importPath|modulePath|replacedByGopls|isImportant|description|defaultVersion|minimumGoVersion|usePrereleaseInPreviewMode|latestVersion|latestVersionTimestamp): /);
  }
  expect(information.match(/^\t\[$/gm)).toHaveLength(entries.length);

  // goTools.ts: every pinned row of every tool, and what the function ends at.
  const tools = source('goTools.ts');
  const version = tools.slice(tools.indexOf('export function getImportPathWithVersion('), tools.indexOf('export function containsTool('));
  const pinned = [...version.matchAll(/\tif \(tool\.name === '([\w-]+)'\) \{\n([\s\S]*?)\n\t\}/g)].map(([, name, rows]) => {
    const pins = [...rows.matchAll(/^\t\tif \(goVersion\.lt\('([\d.]+)'\)\) return importPath \+ '@(v[\d.]+)';/gm)].map(([, below, pin]) => ({ below, version: pin }));
    expect(rows.split('\n')).toHaveLength(pins.length);
    return [name, pins] as const;
  });
  expect(pinned).toEqual([['gopls', goplsPins], ...Object.entries(goToolPins)]);
  expect(version).toContain("if (tool.defaultVersion) {\n\t\treturn importPath + '@' + tool.defaultVersion;\n\t}\n\treturn importPath + '@latest';");
  expect(tools).toContain("const [n] = name.split('@');");

  // goTools.ts `getRequiredTools`: the first list, Delve's processors, the two settings, and what gopls replaces.
  const required = tools.slice(tools.indexOf('export function getRequiredTools('));
  expect(required).toContain("const toolNames = new Set<string>(['gotests', 'impl', 'goplay']);");
  expect(required).toContain(`if (process.arch.match(/${delveProcessors.source}/)) {\n\t\ttoolNames.add('dlv');`);
  expect(required).toContain('toolNames.add(getFormatTool(goConfig));');
  expect(required).toContain("const lintToolName = goConfig.get<string>('lintTool');\n\tif (lintToolName) {\n\t\ttoolNames.add(lintToolName);");
  expect(required).toContain('if (!tool) {\n\t\t\tcontinue;');
  expect(required).toContain('if (useLanguageServer && tool.replacedByGopls) {\n\t\t\tcontinue;');
  const format = source('language/legacy/goFormat.ts');
  expect(format).toContain("if (formatTool === undefined || formatTool === 'default') {\n\t\treturn '';");
  expect(format).toContain("if (formatTool === 'custom') {\n\t\treturn 'customFormatter';");

  // package.json: the settings' defaults, and every linter that can be chosen is a row called a linter.
  const properties = (JSON.parse(readFileSync(path.join(upstream, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> } } }).contributes.configuration.properties;
  expect(properties['go.formatTool'].default).toBe('default');
  expect(properties['go.useLanguageServer'].default).toBe(true);
  expect(Object.hasOwn(properties['go.lintTool'], 'default')).toBe(false);
  expect([...properties['go.lintTool'].enum ?? []].sort()).toEqual(names(goToolTable.filter(tool => tool.description === 'Linter')).sort());
  for (const formatter of names(goToolTable.filter(tool => tool.description === 'Formatter'))) expect(properties['go.formatTool'].enum).toContain(formatter);

  // goInstallTools.ts: the words about a missing tool, the Go each version is chosen for, and the `-v2` copy.
  const install = source('goInstallTools.ts');
  expect(install).toContain('`${toolName} is not found. Please make sure it is installed and available in the PATH ${getEnvPath()}`');
  expect(install).toContain('if (tool.minimumGoVersion && goVersion.lt(tool.minimumGoVersion.format())) {');
  expect(install).toContain('`You are using go${goVersion.format()}, but ${');
  expect(install).toContain('} requires at least go${tool.minimumGoVersion.format()}.`');
  expect(install).toContain('const cmd = `go install -v ${getImportPathWithVersion(tool, undefined, goVersion)}`;');
  expect(install).toContain('`The "${tool.name}" command is not available. Run "${cmd}" to install.`');
  expect(install).toContain('const importPath = getImportPathWithVersion(tool, version, goVersionForInstall);');
  expect(install).toContain("const isUpgradedMajorVersion = tool.name.match('-v\\\\d+$');");
  expect(install).toContain("envForTools['GOBIN'] = path.join(installingPath, 'tmp');");
  expect(install).toContain("const toolName = tool.name.match('^(?<tool>.+)-v\\\\d+$')?.groups?.tool;");
  expect(install).toContain("path.join(installingPath, 'tmp', correctBinname(toolName)),\n\t\t\t\tpath.join(installingPath, correctBinname(tool.name))");
  expect(install).toContain("fs.rmdirSync(path.join(installingPath, 'tmp'), { recursive: true });");
  // Why vscgo is never installed here: the extension builds it into its own folder, for its telemetry.
  expect(install).toContain("const progPath = path.join(extensionPath, 'bin', correctBinname('vscgo'));");
  expect(source('goTelemetry.ts')).toContain('r.setTool(vscgo);');
});
