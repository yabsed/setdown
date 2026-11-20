import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
const state = vi.hoisted(() => ({ directory: '', listed: undefined as undefined | { selected?: string; selectionSource?: string; selectionNeeded?: boolean; candidates: { path: string; source: string; name: string }[] } }));
vi.mock('electron', () => ({ app: { getPath: () => path.join(state.directory, 'settings') } }));
vi.mock('../notebook/python-environments', () => ({ notebookPython: { searchPaths: async () => ({ paths: [] }), list: async () => state.listed ?? ({ selected: process.execPath, candidates: [{ path: process.execPath, source: 'Host', name: 'Host Python' }] }) } }));
import { AnalysisContextService } from './analysis-context';
import { analysisPreferences } from './analysis-preferences';
import { builtinLanguageServers } from './catalog/profiles';
import { ServerSession } from './server-session';
import { configurationSection } from './server-session';
const definition = (id: string) => builtinLanguageServers.find(d => d.id === id)!;
const sessions: ServerSession[] = [];
beforeEach(async () => { state.directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-context-')); });
afterEach(async () => { state.listed = undefined; await Promise.all(sessions.splice(0).map(session => session.stop())); await rm(state.directory, { recursive: true, force: true }); });

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

// What Setdown finds itself is the mocked list above; what Zed's search finds is given to the service.
const interpreter = async (...parts: string[]) => { const file = path.join(state.directory, ...parts); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, ''); return file; };
const pythonPath = (plan: { profile: { configuration: Record<string, unknown> } }) => configurationSection(plan.profile.configuration, 'python.pythonPath');

test('Python uses the one environment made for the project that only Zed\'s search finds, and offers every other one', async () => {
  const root = path.join(state.directory, 'app'); await mkdir(root);
  const poetry = await interpreter('cache/pypoetry/virtualenvs/app-x-py3.12/bin/python'), conda = await interpreter('miniconda3/bin/python'), other = await interpreter('cache/pypoetry/virtualenvs/other-y-py3.12/bin/python');
  const search = vi.fn(async () => [
    { path: poetry, name: 'Python 3.12.3 (app-x-py3.12; Poetry)', kind: 'Poetry', project: root, prefix: path.dirname(path.dirname(poetry)) },
    { path: other, name: 'Python 3.12.3 (other-y-py3.12; Poetry)', kind: 'Poetry', project: path.join(state.directory, 'other'), prefix: path.dirname(path.dirname(other)) },
    { path: conda, name: 'Python 3.11.4 (base; Conda)', kind: 'Conda', prefix: path.dirname(path.dirname(conda)) },
    // The host interpreter again, under the other name it has in the same folder.
    { path: path.join(path.dirname(process.execPath), 'python3.12'), name: 'Python 3.12 (global)', kind: 'LinuxGlobal', prefix: path.dirname(path.dirname(process.execPath)) },
  ]);
  const service = new AnalysisContextService(search);
  const plan = await service.resolve(root, 'fixture', definition('pyright'));
  expect(pythonPath(plan)).toBe(poetry);
  expect(plan.context.environment).toBe('usable');
  expect(plan.context.selectionSource).toBe('automatic');
  expect(plan.context.choices.map(choice => [choice.name, choice.source])).toEqual([['Host Python', 'Host'], ['Python 3.12.3 (app-x-py3.12; Poetry)', 'Poetry'],
    ['Python 3.12.3 (other-y-py3.12; Poetry)', 'Poetry'], ['Python 3.11.4 (base; Conda)', 'Conda']]);
  expect(plan.context.choices.find(choice => choice.id === plan.context.selected)).toMatchObject({ path: poetry, available: true });
  expect(plan.context.inherited).toMatchObject({ path: poetry, source: 'Poetry environment' });
  // The environment in use is watched; the ones only offered are not.
  expect(plan.inputs).toContain(poetry);
  expect(plan.inputs).not.toContain(conda);
  expect(plan.inputs).not.toContain(other);
  // One search serves every Python tool of the folder, until the folder's analysis is asked again.
  expect(pythonPath(await service.resolve(root, 'fixture', definition('basedpyright')))).toBe(poetry);
  expect(search).toHaveBeenCalledTimes(1);
  await service.resolve(root, 'fixture', definition('pyright'), {}, true);
  expect(search).toHaveBeenCalledTimes(2);
  service.invalidate(root); await service.resolve(root, 'fixture', definition('pyright'));
  expect(search).toHaveBeenCalledTimes(3);
  expect(search).toHaveBeenLastCalledWith(root);
  // The person's own choice and the connection's setting stand above it.
  const settings = { python: { pythonPath: conda } };
  const configured = await service.resolve(root, 'fixture', definition('pyright'), { settings });
  expect(pythonPath(configured)).toBe(conda);
  expect(configured.context.selectionSource).toBe('connection');
  analysisPreferences.set(root, 'python', other); state.listed = { selected: other, selectionSource: 'Project selection', candidates: [{ path: other, source: 'Project selection', name: 'other' }] };
  const chosen = await service.resolve(root, 'fixture', definition('pyright'));
  expect(pythonPath(chosen)).toBe(other);
  expect(chosen.context.selectionSource).toBe('project');
  expect(chosen.context.issues).toEqual([]);
});

test('Python asks when the project has several environments of its own, counting each environment once', async () => {
  const root = path.join(state.directory, 'app'); await mkdir(root);
  const local = await interpreter('app/.venv/bin/python'), pixi = await interpreter('app/.pixi/envs/default/bin/python'), poetry = await interpreter('cache/pypoetry/virtualenvs/app-x-py3.12/bin/python');
  const host = { path: process.execPath, source: 'PATH', name: 'Host Python' };
  const found = { pixi: { path: pixi, name: 'Python 3.12 (default; pixi)', kind: 'Pixi', prefix: path.dirname(path.dirname(pixi)) }, poetry: { path: poetry, name: 'Python 3.12 (app-x; Poetry)', kind: 'Poetry', project: root },
    // The project's `.venv` as Zed reports it: the same folder under another program name.
    local: { path: path.join(path.dirname(local), 'python3.12'), name: 'Python 3.12 (.venv)', kind: 'Venv', prefix: path.dirname(path.dirname(local)) } };
  let answer: unknown[] = [found.local];
  const service = new AnalysisContextService(async () => answer as never);
  const resolve = () => service.resolve(root, 'fixture', definition('pyright'), {}, true);
  // Setdown's own find and Zed's are one environment: it is used, it has one row, and nothing is asked.
  state.listed = { selected: local, selectionSource: 'Project environment', selectionNeeded: false, candidates: [{ path: local, source: 'Project', name: '.venv' }, host] };
  const one = await resolve();
  expect(pythonPath(one)).toBe(local);
  expect(one.context.issues).toEqual([]);
  expect(one.context.choices.map(choice => choice.path)).toEqual([local, process.execPath]);
  // A second environment of the project that only Zed's search finds: asked, as two folders in the project always were.
  answer = [found.local, found.poetry];
  const two = await resolve();
  // Several environments and none chosen is an inference, not a fault the tool reported: it
  // changes no status and waits beside the first import the tool cannot find.
  expect(two.context.hints?.map(hint => hint.code)).toEqual(['python-project-environment']);
  expect(two.context.issues).toEqual([]);
  expect(two.context.environment).toBe('usable');
  expect(two.context.selected).toBeUndefined();
  expect(pythonPath(two)).toBeNull();
  expect(two.context.choices.map(choice => choice.path)).toEqual([local, process.execPath, poetry]);
  // Two that only Zed's search finds.
  state.listed = { selected: process.execPath, selectionSource: 'Host environment', selectionNeeded: false, candidates: [host] };
  answer = [found.pixi, found.poetry];
  expect((await resolve()).context.hints?.map(hint => hint.code)).toContain('python-project-environment');
  // Reported twice, an environment is still one.
  answer = [found.pixi, { ...found.pixi, path: path.join(path.dirname(pixi), 'python3') }];
  const twice = await resolve();
  expect(pythonPath(twice)).toBe(pixi);
  expect(twice.context.issues).toEqual([]);
  expect(twice.context.inherited?.source).toBe('Pixi environment');
  // One the person registered elsewhere (a Jupyter kernel) is Setdown's row, and Zed's search says whose it is.
  state.listed = { selected: process.execPath, selectionSource: 'Host environment', selectionNeeded: false, candidates: [host, { path: poetry, source: 'Jupyter kernel', name: 'app' }] };
  answer = [{ ...found.poetry, path: path.join(path.dirname(poetry), 'python3.12'), prefix: path.dirname(path.dirname(poetry)) }];
  const registered = await resolve();
  expect(pythonPath(registered)).toBe(poetry);
  expect(registered.context.choices.map(choice => [choice.path, choice.source])).toEqual([[process.execPath, 'PATH'], [poetry, 'Jupyter kernel']]);
  // Setdown's two folders stay a question whatever Zed's search adds.
  state.listed = { selected: undefined, selectionSource: 'Host environment', selectionNeeded: true, candidates: [{ path: local, source: 'Project', name: '.venv' }, { path: path.join(root, 'venv/bin/python'), source: 'Project', name: 'venv' }] };
  answer = [found.poetry];
  expect((await resolve()).context.hints?.map(hint => hint.code)).toContain('python-project-environment');
  // The person's choice ends the question.
  analysisPreferences.set(root, 'python', pixi); state.listed = { selected: pixi, selectionSource: 'Project selection', selectionNeeded: false, candidates: [{ path: pixi, source: 'Project selection', name: 'default' }] };
  answer = [found.pixi, found.poetry];
  const chosen = await resolve();
  expect(pythonPath(chosen)).toBe(pixi);
  expect(chosen.context.issues).toEqual([]);
});

test('Python keeps what Setdown finds itself when Zed\'s search fails, finds nothing of the project, or is not there', async () => {
  const root = path.join(state.directory, 'app'); await mkdir(root);
  const conda = await interpreter('miniconda3/bin/python'), pyenv = await interpreter('pyenv/versions/app/bin/python');
  const failing = new AnalysisContextService(async () => { throw Error('Zed lists no environments for Python'); });
  const failed = await failing.resolve(root, 'fixture', definition('pyright'));
  expect(pythonPath(failed)).toBe(process.execPath);
  expect(failed.context.issues).toEqual([]);
  const without = await new AnalysisContextService().resolve(root, 'fixture', definition('pyright'));
  expect(without.context.choices).toEqual(failed.context.choices);
  // Environments of the whole computer and of other projects are offered, and change nothing.
  const environments = [{ path: conda, name: 'Python 3.11.4 (base; Conda)', kind: 'Conda', prefix: path.dirname(path.dirname(conda)) }, { path: pyenv, name: 'Python 3.12.3 (app; Pyenv)', kind: 'PyenvVirtualEnv', environment: 'app' }];
  const service = new AnalysisContextService(async () => environments);
  const offered = await service.resolve(root, 'fixture', definition('pyright'));
  expect(pythonPath(offered)).toBe(process.execPath);
  expect(offered.context.choices.map(choice => choice.source)).toEqual(['Host', 'Conda', 'pyenv']);
  // The project's `.venv` file names one of them: that one is the project's.
  await writeFile(path.join(root, '.venv'), 'app\n');
  const declared = await service.resolve(root, 'fixture', definition('pyright'), {}, true);
  expect(pythonPath(declared)).toBe(pyenv);
  expect(declared.context.inherited?.source).toBe('pyenv environment');
  // A notebook's own interpreter is not Zed's to find.
  const search = vi.fn(async () => environments);
  const notebook = await new AnalysisContextService(search).resolve(root, 'fixture', definition('pyright'), {}, false, conda);
  expect(pythonPath(notebook)).toBe(conda);
  expect(search).not.toHaveBeenCalled();
});

test('clangd selects a unique build database, only hints at competing or absent builds, and applies an external selection to argv', async () => {
  const root = state.directory, service = new AnalysisContextService();
  // No configuration file at all: clangd answers with its defaults (and reads `.clangd` from the
  // folders above the project, which Setdown does not look at). Nothing is wrong until it says so.
  const bare = await service.resolve(root, 'fixture', definition('clangd'));
  expect(bare.context.environment).toBe('usable');
  expect(bare.context.issues).toEqual([]);
  expect(bare.context.hints?.map(hint => hint.code)).toEqual(['compilation-unknown']);
  for (const name of ['build', 'builddir', 'external']) await mkdir(path.join(root, name));
  await writeFile(path.join(root, 'build/compile_commands.json'), '[]');
  const initial = await service.resolve(root, 'fixture', definition('clangd'), {}, true);
  expect(initial.args).toContain(`--compile-commands-dir=${path.join(root, 'build')}`);
  expect(initial.context.hints).toBeUndefined();
  await writeFile(path.join(root, 'builddir/compile_commands.json'), '[]');
  const ambiguous = await service.resolve(root, 'fixture', definition('clangd'), {}, true);
  expect(ambiguous.context.hints?.map(hint => hint.code)).toEqual(['compilation-choice']);
  expect(ambiguous.context.environment).toBe('usable');
  expect(ambiguous.context.unselected).toBe('None · clangd defaults');
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
