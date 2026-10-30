import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => path.join(state.root, 'settings') } }));
import { AnalysisPreparation } from './analysis-preparation';
import { ServerDiscovery } from './server-discovery';
import { ServerEnvironment } from './server-environment';
let discovery: ServerDiscovery;
const preparation = new AnalysisPreparation();
beforeEach(async () => { state.root = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-preparation-')); discovery = new ServerDiscovery(new ServerEnvironment({ ...process.env, SETDOWN_LSP_INHERIT_ENV: '1' })); });
afterEach(async () => { preparation.dispose(); discovery.dispose(); await rm(state.root, { recursive: true, force: true }); });

test.each(['cmake', 'meson'] as const)('explicit %s configuration creates a compilation database in the app cache and can run again', async kind => {
  const root = path.join(state.root, 'source'); await mkdir(root);
  await writeFile(path.join(root, 'main.cpp'), 'int main() { return BUILD_VALUE; }\n');
  await writeFile(path.join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(fixture LANGUAGES CXX)\nadd_executable(fixture main.cpp)\ntarget_compile_definitions(fixture PRIVATE BUILD_VALUE=42)\n');
  await writeFile(path.join(root, 'meson.build'), "project('fixture', 'cpp')\nexecutable('fixture', 'main.cpp', cpp_args: ['-DBUILD_VALUE=42'])\n");
  const first = await preparation.run(1, root, kind, discovery);
  expect(JSON.parse(await readFile(first.database, 'utf8'))).toEqual(expect.arrayContaining([expect.objectContaining({ file: expect.stringContaining('main.cpp') })]));
  expect(await readFile(first.database, 'utf8')).toContain('BUILD_VALUE=42');
  expect(first.database.startsWith(path.join(state.root, 'settings'))).toBe(true);
  const next = await preparation.run(1, root, kind, discovery); expect(next.database).toBe(first.database);
}, 45_000);

test('cancellation kills an in-flight configure process and the same project cannot start a duplicate job', async () => {
  const executable = path.join(state.root, 'configure-fixture'), started = path.join(state.root, 'started');
  await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(started)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`); await chmod(executable, 0o755);
  vi.spyOn(discovery, 'find').mockResolvedValue({ candidates: [], selected: { id: 'fixture', path: executable, source: 'explicit' }, environment: { env: process.env, source: 'inherited' }, searched: [] });
  const running = preparation.run(1, state.root, 'cmake', discovery);
  const rejected = expect(running).rejects.toThrow(/cancelled/);
  await expect(preparation.run(1, state.root, 'cmake', discovery)).rejects.toThrow(/already/);
  await expect(preparation.run(2, state.root, 'cmake', discovery)).rejects.toThrow(/already/);
  await expect.poll(() => readFile(started, 'utf8').catch(() => ''), { timeout: 5000 }).not.toBe('');
  const pid = Number(await readFile(started, 'utf8'));
  preparation.cancel(2, state.root); // Another window cannot cancel the owner’s job.
  expect(() => process.kill(pid, 0)).not.toThrow();
  preparation.cancel(1, state.root); await rejected;
  expect(() => process.kill(pid, 0)).toThrow();
});
