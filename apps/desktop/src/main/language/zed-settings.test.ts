import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bindings from './catalog/zed-profiles.json';
import { ServerRegistry } from './server-registry';
import { plainLanguages, projectFolder, setdownChoices, setdownDefaults, zedLanguage, zedNames } from './zed-settings';

// What Zed 1.29 reports without any extension: a sample of its own servers and languages.
const servers = ['json-language-server', 'yaml-language-server', 'vscode-css-language-server', 'gopls', 'rust-analyzer', 'clangd', 'pyright', 'typescript-language-server', 'vtsls', 'eslint'];
const languages = ['JSON', 'JSONC', 'YAML', 'CSS', 'Go', 'Go Mod', 'Go Work', 'Rust', 'C', 'C++', 'Python', 'JavaScript', 'TypeScript', 'TSX', 'Markdown'];
const extension = (id: string) => (bindings.bindings as { id: string; server: string; extension: string }[]).find(binding => binding.id === id);
const names = zedNames(servers, id => extension(id)?.server);

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'setdown-zed-names-')); roots.push(home);
  const registry = new ServerRegistry(home);
  const definition = (id: string) => { try { return registry.definition(id); } catch { return undefined; } };
  return { home, registry, definition };
}

test('each supported language names its one tool by Zed\'s own names, and nothing installs a formatter', async () => {
  const { definition } = await fixture();
  const defaults = setdownDefaults(names, definition, { pyright: { path: '/app/node', arguments: ['/app/pyright.js', '--stdio'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    'typescript-language-server': { path: '/app/node', arguments: ['/app/tsserver.js', '--stdio'] } }) as { formatter: string; languages: Record<string, unknown>; lsp: Record<string, Record<string, unknown>> };
  expect(defaults.formatter).toBe('language_server');
  expect(defaults.languages).toMatchObject({
    JSON: { language_servers: ['json-language-server'] }, JSONC: { language_servers: ['json-language-server'] }, YAML: { language_servers: ['yaml-language-server'] },
    // Zed has these three languages only with an extension; Setdown's tool for them is a server Zed ships.
    SCSS: { language_servers: ['vscode-css-language-server'] }, LESS: { language_servers: ['vscode-css-language-server'] }, 'Docker Compose': { language_servers: ['yaml-language-server'] },
    HTML: { language_servers: ['vscode-html-language-server'] }, Kotlin: { language_servers: ['kotlin-lsp'] }, Go: { language_servers: ['gopls'] }, TSX: { language_servers: ['typescript-language-server'] },
  });
  expect(defaults.lsp.pyright).toEqual({ binary: { path: '/app/node', arguments: ['/app/pyright.js', '--stdio'], env: { ELECTRON_RUN_AS_NODE: '1' } } });
  expect(defaults.lsp['typescript-language-server']).toMatchObject({ binary: { path: '/app/node' }, initialization_options: { disableAutomaticTypingAcquisition: true } });
  // A server from an extension is told only what is set here; the HTML server needs CSS settings to check a page's styles.
  expect(defaults.lsp['vscode-html-language-server']).toEqual({ settings: definition('html-lsp')!.settings });
  expect((defaults.lsp['vscode-html-language-server'].settings as { css: unknown }).css).toMatchObject({ lint: {} });
  // Servers Zed ships keep the settings Zed gives them.
  for (const server of ['vscode-css-language-server', 'gopls']) expect(defaults.lsp[server]).toBeUndefined();
  // Zed has the schemas of package.json and tsconfig.json itself; the JSON server is told Setdown's others.
  const schemas = (defaults.lsp['json-language-server'].settings as { json: { schemas: { fileMatch: string[]; url: string }[] } }).json.schemas;
  expect(schemas.flatMap(schema => schema.fileMatch)).toEqual(expect.arrayContaining(['tsconfig.*.json', 'jsconfig.json', '.prettierrc.json', '.eslintrc.json', '.babelrc']));
  expect(schemas.flatMap(schema => schema.fileMatch)).not.toEqual(expect.arrayContaining(['package.json']));
  expect(schemas.flatMap(schema => schema.fileMatch)).not.toEqual(expect.arrayContaining(['tsconfig.json']));
  expect(Object.keys(defaults.lsp['json-language-server'])).toEqual(['settings']);
});

test('a language Zed lacks is described to the host unless the tool\'s own extension brings it', async () => {
  const { definition } = await fixture();
  const plain = plainLanguages(languages, definition, id => extension(id)?.extension);
  expect(plain.map(language => language.name).sort()).toEqual(['Docker Compose', 'LESS', 'SCSS']);
  expect(plain.find(language => language.name === 'SCSS')!.suffixes).toEqual(['scss']);
  expect(plain.find(language => language.name === 'LESS')!.suffixes).toEqual(['less']);
  expect(plain.find(language => language.name === 'Docker Compose')!.suffixes).toEqual(expect.arrayContaining(['compose.yaml', 'docker-compose.yml']));
  expect(plainLanguages([...languages, 'SCSS', 'LESS', 'Docker Compose'], definition, id => extension(id)?.extension)).toEqual([]);
});

test('a document\'s language is named for Zed, and a dialect only where it is written in its base language', () => {
  expect(zedLanguage('scss')).toBe('SCSS');
  expect(zedLanguage('dockercompose')).toBe('Docker Compose');
  expect(zedLanguage('github-action')).toBe('YAML');
  expect(zedLanguage('json-ld')).toBe('JSON');
  // A Go template is not Go: opened as Go, every line of it would be marked.
  expect(zedLanguage('gotmpl')).toBeUndefined();
  expect(zedLanguage('fortran')).toBeUndefined();
});

test('what a person chose in Language Support becomes Zed settings, and nothing else does', async () => {
  const { home, registry, definition } = await fixture();
  const defaults = setdownDefaults(names, definition, {});
  expect(setdownChoices(registry, names, defaults)).toEqual({ languages: {}, lsp: {} });
  registry.configure('gopls', { settings: { gopls: { staticcheck: true } }, initializationOptions: { usePlaceholders: true } });
  registry.configure('rust-analyzer', { args: ['--log-file', '/tmp/ra.log'] });
  const program = path.join(home, 'clangd'); await writeFile(program, '#!/bin/sh\n', { mode: 0o755 });
  await registry.chooseExecutable('clangd', program);
  registry.selectAnalysis('python', 'basedpyright');
  const choices = setdownChoices(registry, zedNames([...servers, 'basedpyright'], id => extension(id)?.server), defaults) as { languages: Record<string, unknown>; lsp: Record<string, Record<string, unknown>> };
  expect(choices.lsp.gopls).toEqual({ settings: { gopls: { staticcheck: true } }, initialization_options: { usePlaceholders: true } });
  expect(choices.lsp['rust-analyzer']).toEqual({ binary: { arguments: ['--log-file', '/tmp/ra.log'] } });
  expect(choices.lsp.clangd).toEqual({ binary: { path: program, arguments: definition('clangd')!.launch.args } });
  expect(choices.languages).toEqual({ Python: { language_servers: ['basedpyright'] } });
});

test('the folder Zed opens is the window\'s folder, else the repository, else the project file\'s folder, else the file alone', async () => {
  const { home, definition } = await fixture();
  const go = definition('gopls')!;
  await mkdir(path.join(home, 'repo/.git'), { recursive: true }); await writeFile(path.join(home, 'repo/.git/HEAD'), 'ref: refs/heads/main\n');
  await mkdir(path.join(home, 'repo/service'), { recursive: true });
  await mkdir(path.join(home, 'module'), { recursive: true }); await writeFile(path.join(home, 'module/go.mod'), 'module example\n');
  const inRepo = path.join(home, 'repo/service/main.go');
  expect(projectFolder(inRepo, go, path.join(home, 'repo/service'))).toEqual({ path: path.join(home, 'repo/service'), reason: 'Open folder' });
  expect(projectFolder(inRepo, go, path.join(home, 'elsewhere'))).toEqual({ path: path.join(home, 'repo'), reason: 'Repository boundary (.git)' });
  expect(projectFolder(inRepo, go, undefined, path.join(home, 'repo/service'))).toMatchObject({ path: path.join(home, 'repo/service'), reason: 'User-selected analysis root' });
  expect(projectFolder(path.join(home, 'module/main.go'), go)).toMatchObject({ path: path.join(home, 'module') });
  expect(projectFolder(path.join(home, 'loose/main.go'), go)).toEqual({ path: path.join(home, 'loose'), reason: 'Single file', single: true });
});

test('what Setdown found out for a tool is part of its own layer, under everything a person writes', async () => {
  const { registry, definition } = await fixture();
  const plain = setdownDefaults(names, definition, {}) as { lsp: Record<string, Record<string, unknown>> };
  // Without a schema downloader the JSON server keeps downloading by itself, as it did.
  expect(plain.lsp['json-language-server']?.initialization_options).toBeUndefined();
  expect(plain.lsp.gopls).toBeUndefined();
  const defaults = setdownDefaults(names, definition, { 'typescript-language-server': { path: '/app/node', arguments: ['/app/tsserver.js', '--stdio'] } }, { schemaDownloads: true,
    programs: { gopls: { path: '/home/person/go/bin/gopls', arguments: ['-mode=stdio'], env: { PATH: '/usr/local/go/bin:/usr/bin' } }, 'typescript-language-server': { env: { EXTRA: '1' } }, 'no-such-tool': { path: '/nowhere' } },
    options: { 'kotlin-lsp': { buildTools: {}, projects: [] }, 'typescript-language-server': { locale: 'ko' }, gopls: {} } }) as { lsp: Record<string, Record<string, unknown>> };
  expect(defaults.lsp['json-language-server'].initialization_options).toEqual({ handledSchemaProtocols: ['file'] });
  // Zed's own schema list for the server stays beside it.
  expect(defaults.lsp['json-language-server'].settings).toEqual(plain.lsp['json-language-server'].settings);
  expect(defaults.lsp.gopls).toEqual({ binary: { path: '/home/person/go/bin/gopls', arguments: ['-mode=stdio'], env: { PATH: '/usr/local/go/bin:/usr/bin' } } });
  expect(defaults.lsp['kotlin-lsp'].initialization_options).toEqual({ buildTools: {}, projects: [] });
  // A bundled program keeps its path, and the options of the tool's extension keep their defaults.
  expect(defaults.lsp['typescript-language-server']).toEqual({ binary: { path: '/app/node', arguments: ['/app/tsserver.js', '--stdio'], env: { EXTRA: '1' } },
    initialization_options: { maxTsServerMemory: 3072, disableAutomaticTypingAcquisition: true, locale: 'ko' } });
  expect(Object.keys(defaults.lsp)).not.toContain('no-such-tool');
  // A person's settings for the tool become the startup options its extension would send.
  registry.configure('typescript-language-server', { settings: { typescript: { tsserver: { maxTsServerMemory: 8192 }, disableAutomaticTypeAcquisition: false } } });
  expect((setdownChoices(registry, names, defaults).lsp as Record<string, { initialization_options: unknown }>)['typescript-language-server'].initialization_options)
    .toEqual({ maxTsServerMemory: 8192, disableAutomaticTypingAcquisition: false });
});
