import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => path.join(state.directory, 'settings') } }));
vi.mock('../notebook/python-environments', () => ({ notebookPython: { searchPaths: async () => ({ paths: [] }), list: async () => ({ selected: process.execPath, candidates: [{ path: process.execPath, source: 'Host', name: 'Host Python' }] }) } }));
import { AnalysisContextService } from './analysis-context';
import { analysisPreferences } from './analysis-preferences';
import { builtinLanguageServers } from './catalog/profiles';
import { ServerSession } from './server-session';
import { configurationSection } from './server-session';
const definition = (id: string) => builtinLanguageServers.find(d => d.id === id)!;
const sessions: ServerSession[] = [];
beforeEach(async () => { state.directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-context-')); });
afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.stop())); await rm(state.directory, { recursive: true, force: true }); });

test('Python preserves explicit connection settings and native project configuration; a missing saved selection never silently falls back', async () => {
  const service = new AnalysisContextService(), root = state.directory;
  const settings = { python: { pythonPath: process.execPath, analysis: { typeCheckingMode: 'strict', extraPaths: ['/explicit'] } } };
  await writeFile(path.join(root, 'pyrightconfig.json'), JSON.stringify({ executionEnvironments: [{ root: 'a', extraPaths: ['a/lib'] }, { root: 'b', extraPaths: ['b/lib'] }] }));
  const initial = await service.resolve(root, 'fixture', definition('pyright'), { settings });
  expect(configurationSection(initial.profile.configuration, 'python.pythonPath')).toBe(process.execPath);
  expect(configurationSection(initial.profile.configuration, 'python.analysis')).toEqual(settings.python.analysis);
  expect(initial.context.evidence.join('\n')).toContain('executionEnvironments');
  expect(initial.context.selectionSource).toBe('connection');
  const scoped = initial.configuration({ python: { pythonPath: '/nested/python', analysis: { extraPaths: ['/nested'] } } });
  expect(configurationSection(scoped, 'python.pythonPath')).toBe('/nested/python');
  expect(configurationSection(scoped, 'python.analysis.extraPaths')).toEqual(['/nested']);
  const missing = path.join(root, '.venv/bin/python'); analysisPreferences.set(root, 'python', missing);
  const selected = await service.resolve(root, 'fixture', definition('pyright'), { settings });
  expect(selected.context.environment).toBe('action-needed');
  expect(selected.context.issues[0].code).toBe('python-missing');
  expect(selected.context.selectionSource).toBe('project');
  expect(selected.context.inherited?.path).toBe(process.execPath);
  expect(selected.context.inherited?.source).toBe('Connection settings');
  expect(configurationSection(selected.profile.configuration, 'python.pythonPath')).toBe(missing);
  expect(configurationSection(selected.configuration({ python: { pythonPath: '/nested/python' } }), 'python.pythonPath')).toBe(missing);
  expect(selected.context.id).not.toBe(initial.context.id);
  analysisPreferences.set(root, 'python', undefined);
  const fallback = await service.resolve(root, 'fixture', definition('pyright'), { settings });
  expect(configurationSection(fallback.profile.configuration, 'python.pythonPath')).toBe(selected.context.inherited?.path);
  analysisPreferences.set(root, 'python', missing);
  expect(analysisPreferences.pythonFor(path.join(root, 'nested/notes.ipynb'))).toBe(missing);
});

test('clangd selects a unique build database, requires a choice for competing builds, and applies an external selection to argv', async () => {
  const root = state.directory, service = new AnalysisContextService();
  for (const name of ['build', 'builddir', 'external']) await mkdir(path.join(root, name));
  await writeFile(path.join(root, 'build/compile_commands.json'), '[]');
  const initial = await service.resolve(root, 'fixture', definition('clangd'));
  expect(initial.args).toContain(`--compile-commands-dir=${path.join(root, 'build')}`);
  await writeFile(path.join(root, 'builddir/compile_commands.json'), '[]');
  const ambiguous = await service.resolve(root, 'fixture', definition('clangd'), {}, true);
  expect(ambiguous.context.issues[0].code).toBe('compilation-choice');
  expect(ambiguous.args.some(arg => arg.startsWith('--compile-commands-dir'))).toBe(false);
  const database = path.join(root, 'external/compile_commands.json'); await writeFile(database, '[]');
  analysisPreferences.set(root, 'compilation', database);
  const selected = await service.resolve(root, 'fixture', definition('clangd'), { args: ['--compile-commands-dir', '/previous', '--background-index'] });
  expect(selected.args).toEqual(['--background-index', `--compile-commands-dir=${path.dirname(database)}`]);
  await rm(database);
  const missing = await service.resolve(root, 'fixture', definition('clangd'), {}, true);
  expect(missing.context.environment).toBe('action-needed');
  expect(missing.args).toContain(`--compile-commands-dir=${path.dirname(database)}`);
});

test('the actual clangd process receives an external database with include paths, defines and language standard', async () => {
  const root = path.join(state.directory, 'project'), build = path.join(state.directory, 'external-build'), includes = path.join(state.directory, 'includes');
  for (const folder of [root, build, includes]) await mkdir(folder);
  const file = path.join(root, 'main.cpp'), uri = pathToFileURL(file).href;
  const source = '#include "environment.hpp"\nconstexpr int result = ENV_VALUE;\nstatic_assert(result == 42);\n';
  await writeFile(file, source); await writeFile(path.join(includes, 'environment.hpp'), '#ifndef ENV_VALUE\n#error missing define\n#endif\n');
  const database = path.join(build, 'compile_commands.json');
  await writeFile(database, JSON.stringify([{ directory: root, file, arguments: ['clang++', '-std=c++20', `-I${includes}`, '-DENV_VALUE=42', '-c', file] }]));
  analysisPreferences.set(root, 'compilation', database);
  const service = new AnalysisContextService(), clangd = definition('clangd');
  const plan = await service.resolve(root, 'fixture', clangd);
  const published: PublishDiagnosticsParams[] = [], failures: string[] = [];
  const server = new ServerSession(service.launch(plan, { executable: process.env.SETDOWN_CLANGD_PATH || 'clangd', args: clangd.launch.args }, clangd), root,
    params => published.push(params), failure => failures.push(failure), plan.profile);
  sessions.push(server); await server.ready;
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 7, text: source } });
  await expect.poll(() => published.find(p => p.uri === uri && p.version === 7)?.diagnostics, { timeout: 15_000 }).toEqual([]);
  expect(failures).toEqual([]);
}, 25_000);

test('TypeScript uses an installed project SDK automatically; explicit choices win and a missing choice is preserved', async () => {
  const root = state.directory, service = new AnalysisContextService(), server = definition('typescript-language-server');
  const sdkPath = (plan: Awaited<ReturnType<AnalysisContextService['resolve']>>) => configurationSection(plan.profile.initializationOptions!, 'tsserver.path');
  // A repository boundary keeps discovery inside the fixture, whatever lies above the temporary directory.
  await mkdir(path.join(root, '.git'));
  const without = await service.resolve(root, 'fixture', server);
  const bundled = without.context.choices.find(c => c.source === 'Bundled')!.path;
  expect(sdkPath(without)).toBe(bundled);
  expect(without.context.selectionSource).toBe('automatic');

  const sdk = path.join(root, 'node_modules/typescript/lib/tsserver.js');
  await mkdir(path.dirname(sdk), { recursive: true }); await writeFile(sdk, 'throw Error("discovery must never execute this file")');
  await writeFile(path.join(path.dirname(sdk), '../package.json'), '{"version":"9.9.9-fixture"}');
  const automatic = await service.resolve(root, 'fixture', server, {}, true);
  expect(sdkPath(automatic)).toBe(sdk);
  expect(automatic.context.selectionSource).toBe('automatic');
  expect(automatic.context.choices.find(c => c.id === automatic.context.selected)).toMatchObject({ path: sdk, source: 'Project', name: 'Project TypeScript 9.9.9-fixture' });
  expect(automatic.context.environment).toBe('usable');
  expect(automatic.context.id).not.toBe(without.context.id);

  const configured = path.join(root, 'configured/tsserver.js');
  await mkdir(path.dirname(configured)); await writeFile(configured, '');
  const connection = await service.resolve(root, 'fixture', server, { initializationOptions: { tsserver: { path: configured } } });
  expect(sdkPath(connection)).toBe(configured);
  expect(connection.context.selectionSource).toBe('connection');

  analysisPreferences.set(root, 'typescript', 'bundled');
  const keptBundled = await service.resolve(root, 'fixture', server);
  expect(sdkPath(keptBundled)).toBe(bundled);
  expect(keptBundled.context.selectionSource).toBe('project');
  expect(keptBundled.context.inherited?.path).toBe(sdk);

  analysisPreferences.set(root, 'typescript', sdk);
  await rm(sdk); const missing = await service.resolve(root, 'fixture', server, {}, true);
  expect(missing.context.environment).toBe('action-needed');
  expect(missing.context.issues[0].code).toBe('typescript-sdk-missing');
  expect(sdkPath(missing)).toBe(sdk);
});
