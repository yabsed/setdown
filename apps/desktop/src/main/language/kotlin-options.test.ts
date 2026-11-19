import { expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kotlinInitializationOptions, kotlinOptionSettings, kotlinProjectTypes } from './kotlin-options';

const validProject = { type: 'maven', path: 'file:///proj/pom.xml' };
/** The options and problems for `intellij.projects` alone, as the extension's own test reads them. */
const projects = (value: unknown) => { const { options, problems } = kotlinInitializationOptions({ 'intellij.projects': value }, []); return { value: options.projects, problems }; };

test('nothing set is sent as no build tools and no projects, with no JDK key at all', () => {
  for (const settings of [undefined, null, {}, 'text', [], { intellij: {} }, { intellij: { jdkForSymbolResolution: null, buildTool: null, projects: null } },
    { 'intellij.jdkForSymbolResolution': null, 'intellij.buildTool': null, 'intellij.projects': null }, { kotlin: { hints: true } }]) {
    const { options, problems } = kotlinInitializationOptions(settings, ['file:///a', 'file:///b']);
    expect(options).toStrictEqual({ buildTools: {}, projects: [] });
    expect(JSON.stringify(options)).toBe('{"buildTools":{},"projects":[]}');
    expect(problems).toEqual([]);
  }
});

test('the settings are read as dotted keys and as nested objects', () => {
  const sent = { defaultSdk: '/usr/lib/jvm/java-21', buildTools: { 'file:///a': 'gradle', 'file:///b': 'gradle' }, projects: [validProject] };
  expect(kotlinInitializationOptions({ 'intellij.jdkForSymbolResolution': '/usr/lib/jvm/java-21', 'intellij.buildTool': 'gradle', 'intellij.projects': [validProject] }, ['file:///a', 'file:///b']))
    .toStrictEqual({ options: sent, problems: [] });
  expect(kotlinInitializationOptions({ intellij: { jdkForSymbolResolution: '/usr/lib/jvm/java-21', buildTool: 'gradle', projects: [validProject] } }, ['file:///a', 'file:///b']))
    .toStrictEqual({ options: sent, problems: [] });
  // The dotted key is the one VS Code writes, so it is read first; a setting it does not name is still read from the nested object.
  expect(kotlinInitializationOptions({ 'intellij.buildTool': 'maven', intellij: { buildTool: 'gradle', jdkForSymbolResolution: '/jdk' } }, ['file:///a']).options)
    .toStrictEqual({ defaultSdk: '/jdk', buildTools: { 'file:///a': 'maven' }, projects: [] });
  // The older names are not read, and neither is another tool's group.
  expect(kotlinInitializationOptions({ 'kotlinLSP.buildTool': 'gradle', kotlinLSP: { projects: [validProject] }, java: { buildTool: 'gradle' } }, ['file:///a']).options).toStrictEqual({ buildTools: {}, projects: [] });
});

// initializationSettings.test.ts, `sanitizeOptionalString`
test('a JDK path is passed through, and a value that is not text is dropped', () => {
  expect(kotlinInitializationOptions({ 'intellij.jdkForSymbolResolution': '/jdk' }, []).options.defaultSdk).toBe('/jdk');
  expect(kotlinInitializationOptions({ 'intellij.jdkForSymbolResolution': { path: '/jdk' } }, []))
    .toStrictEqual({ options: { buildTools: {}, projects: [] }, problems: ['`intellij.jdkForSymbolResolution` must be a string'] });
  // The extension sends what was written, an empty path included.
  expect(kotlinInitializationOptions({ 'intellij.jdkForSymbolResolution': '' }, []).options).toStrictEqual({ defaultSdk: '', buildTools: {}, projects: [] });
});

// initializationSettings.test.ts, `sanitizeBuildTools`
test('a build tool is sent for each project folder, and one that is not text for none', () => {
  expect(kotlinInitializationOptions({ 'intellij.buildTool': 'gradle' }, ['file:///a'])).toStrictEqual({ options: { buildTools: { 'file:///a': 'gradle' }, projects: [] }, problems: [] });
  expect(kotlinInitializationOptions({ 'intellij.buildTool': undefined }, ['file:///b']).options.buildTools).toStrictEqual({});
  expect(kotlinInitializationOptions({ 'intellij.buildTool': 42 }, ['file:///a', 'file:///b']))
    .toStrictEqual({ options: { buildTools: {}, projects: [] }, problems: ['`intellij.buildTool` for file:///a must be a string', '`intellij.buildTool` for file:///b must be a string'] });
  // `""` turns project import off, which is not the same as leaving the choice to the server.
  expect(kotlinInitializationOptions({ intellij: { buildTool: '' } }, ['file:///a']).options.buildTools).toStrictEqual({ 'file:///a': '' });
  // Without a project folder there is nothing to say it for, and nothing to report.
  expect(kotlinInitializationOptions({ 'intellij.buildTool': 42 }, [])).toStrictEqual({ options: { buildTools: {}, projects: [] }, problems: [] });
});

// initializationSettings.test.ts, `sanitizeConfiguredProjects`
test('valid projects are kept untouched, including build-tool specific fields', () => {
  const bazel = { type: 'bazel', path: 'file:///proj', 'project-path': '.bazelproject' };
  const maven = { ...validProject, env: { M2: '/m2' }, 'java-home': '/jdk' };
  const result = projects([bazel, maven]);
  expect(result).toStrictEqual({ value: [bazel, maven], problems: [] });
  expect((result.value as unknown[])[0]).toBe(bazel);
});

test('an empty project entry is dropped and the rest kept', () => {
  expect(projects([{}, validProject])).toStrictEqual({ value: [validProject], problems: ['`intellij.projects` entry #0 requires "type" to be specified as a non-empty string'] });
});

test('project entries with a blank or non-string required field are dropped', () => {
  expect(projects([{ type: 'maven', path: '   ' }, { type: 42, path: 'file:///proj' }, 'file:///proj', null])).toStrictEqual({ value: [], problems: [
    '`intellij.projects` entry #0 requires "path" to be specified as a non-empty string',
    '`intellij.projects` entry #1 requires "type" to be specified as a non-empty string',
    '`intellij.projects` entry #2 must be an object',
    '`intellij.projects` entry #3 must be an object'] });
});

test('project entries of an unsupported type are dropped', () => {
  expect(projects([{ type: 'unknown', path: 'file:///proj' }, { type: 'subproject', path: 'file:///proj/nested' }]))
    .toStrictEqual({ value: [{ type: 'subproject', path: 'file:///proj/nested' }], problems: ['`intellij.projects` entry #0 has an unsupported "type": "unknown"'] });
  expect(projects(kotlinProjectTypes.map(type => ({ type, path: 'file:///proj' }))).problems).toEqual([]);
});

test('project entries whose optional fields have the wrong shape are dropped', () => {
  expect(projects([{ ...validProject, 'java-home': ['/jdk'] }, { ...validProject, env: { M2: 2 } }, { ...validProject, 'system-properties': 'a=b' }, { ...validProject, 'project-path': null }])).toStrictEqual({ value: [], problems: [
    '`intellij.projects` entry #0 "java-home" must be a string',
    '`intellij.projects` entry #1 "env" must be an object with string values',
    '`intellij.projects` entry #2 "system-properties" must be an object with string values',
    '`intellij.projects` entry #3 "project-path" must be a string'] });
});

test('project entries whose profiles or flags have the wrong shape are dropped', () => {
  const complete = { ...validProject, profiles: ['dev'], offline: true, downloadAdditionalArtifacts: false, skipGenerateSources: true };
  expect(projects([{ ...validProject, profiles: 'dev' }, { ...validProject, profiles: ['dev', 1] }, { ...validProject, offline: 'yes' }, { ...validProject, downloadAdditionalArtifacts: 1 },
    { ...validProject, skipGenerateSources: 'yes' }, complete])).toStrictEqual({ value: [complete], problems: [
    '`intellij.projects` entry #0 "profiles" must be an array of strings',
    '`intellij.projects` entry #1 "profiles" must be an array of strings',
    '`intellij.projects` entry #2 "offline" must be a boolean',
    '`intellij.projects` entry #3 "downloadAdditionalArtifacts" must be a boolean',
    '`intellij.projects` entry #4 "skipGenerateSources" must be a boolean'] });
});

test('projects that are not a list are reported and not forwarded', () => {
  expect(projects(validProject)).toStrictEqual({ value: [], problems: ['`intellij.projects` must be an array'] });
  expect(projects(undefined)).toStrictEqual({ value: [], problems: [] });
  expect(projects(null)).toStrictEqual({ value: [], problems: [] });
});

test('one bad value costs only itself, and the problems come in the order the extension reports them', () => {
  expect(kotlinInitializationOptions({ intellij: { jdkForSymbolResolution: 21, buildTool: ['gradle'], projects: [validProject, { type: 'ant', path: 'file:///proj' }] } }, ['file:///a'])).toStrictEqual({
    options: { buildTools: {}, projects: [validProject] },
    problems: ['`intellij.jdkForSymbolResolution` must be a string', '`intellij.buildTool` for file:///a must be a string', '`intellij.projects` entry #1 has an unsupported "type": "ant"'] });
});

// What was copied from the VS Code Kotlin extension is compared with the copy in `vendor`,
// so a newer submodule that changes it fails here and not in someone's project.
const upstream = fileURLToPath(new URL('../../../../../vendor/kotlin-lsp', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'vscode-extension-core/src/lspClient.ts')))('the copied names, project types and wording are the ones vendor/kotlin-lsp states', () => {
  const source = (file: string) => readFileSync(path.join(upstream, file), 'utf8');
  const client = source('vscode-extension-core/src/lspClient.ts'), rules = source('vscode-extension-core/src/initializationSettings.ts');
  const properties = (JSON.parse(source('kotlin-vscode/package.json')).contributes.configuration as { properties: Record<string, { default?: unknown; items?: { properties: { type: { enum: string[] } } } }> }[])
    .reduce<Record<string, { default?: unknown; items?: { properties: { type: { enum: string[] } } } }>>((all, category) => ({ ...all, ...category.properties }), {});

  // The three settings, and the option each one becomes.
  const constant = (name: string) => new RegExp(`const ${name} = '([^']+)';`).exec(client)?.[1];
  expect([constant('OPT_DEFAULT_WORKSPACE_SDK'), constant('OPT_BUILD_TOOL'), constant('OPT_PROJECTS')]).toEqual([kotlinOptionSettings.sdk, kotlinOptionSettings.buildTool, kotlinOptionSettings.projects]);
  for (const option of ['defaultSdk: defaultSdk.value,', 'buildTools: buildTools.value,', 'projects: projects.value,']) expect(client).toContain(option);
  expect(client).toContain('folders.map((folder) => [folder.uri.toString(), configOption(OPT_BUILD_TOOL, folder.uri)])');
  // What a person who set nothing has: no JDK and no build tool (so neither is sent), and an empty list of projects.
  expect(Object.values(kotlinOptionSettings).map(name => properties[name]?.default)).toEqual([null, null, []]);

  // Every type the settings editor offers is accepted, and the list is the server's.
  const types = /const PROJECT_TYPES = new Set\(\[([^\]]+)\]\)/.exec(rules)?.[1].match(/'[^']+'/g)?.map(type => type.slice(1, -1));
  expect(kotlinProjectTypes).toEqual(types);
  expect(kotlinProjectTypes).toEqual([...properties[kotlinOptionSettings.projects].items!.properties.type.enum, 'subproject']);
  const fields = (name: string) => new RegExp(`const ${name} = \\[([^\\]]+)\\] as const`).exec(rules)?.[1].match(/'[^']+'/g)?.map(field => field.slice(1, -1));
  expect([fields('REQUIRED_STRING_FIELDS'), fields('OPTIONAL_STRING_FIELDS'), fields('OPTIONAL_STRING_MAP_FIELDS'), fields('OPTIONAL_BOOLEAN_FIELDS')])
    .toEqual([['type', 'path'], ['java-home', 'project-path'], ['env', 'system-properties'], ['downloadAdditionalArtifacts', 'offline', 'skipGenerateSources']]);

  // The words a person reads.
  for (const words of ["'must be an object'", 'requires "${field}" to be specified as a non-empty string', 'has an unsupported "type": "${type}"', '"${field}" must be a string',
    '"${field}" must be an object with string values', '"${field}" must be a boolean', '"profiles" must be an array of strings', "'must be an array'", "'must be a string'",
    'for ${uri} must be a string', 'entry #${index} ${rejection.reason}', 'message: `\\`${setting}\\` ${reason}`']) expect(rules).toContain(words);
});
