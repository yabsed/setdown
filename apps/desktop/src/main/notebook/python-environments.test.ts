import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => path.join(state.root, 'config') } }));
vi.mock('../language/server-discovery', async () => {
  const fs = await import('node:fs/promises');
  return { executableFile: async (file: string) => fs.access(file).then(() => true, () => false), ServerDiscovery: class {
    environment = { peek: () => ({ env: { PATH: '/system' } }) };
    async find() { return { candidates: [{ path: path.join(state.root, 'system-python') }], selected: { path: path.join(state.root, 'system-python') }, environment: this.environment.peek() }; }
    dispose() {}
  } };
});
import { PythonEnvironments } from './python-environments';
beforeEach(async () => { state.root = await mkdtemp(path.join(os.tmpdir(), 'setdown-python-env-')); await writeFile(path.join(state.root, 'system-python'), ''); });
afterEach(async () => { await rm(state.root, { recursive: true, force: true }); });
test('automatically selects a unique local Python without launching it and persists explicit choices', async () => {
  const file = path.join(state.root, 'project', 'test.ipynb'), python = path.join(path.dirname(file), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, 'not an executable program');
  const service = new PythonEnvironments(), initial = await service.list(file);
  expect(initial.candidates).toContainEqual(expect.objectContaining({ path: python, source: 'Project' }));
  expect(initial.selected).toBe(python);
  expect(initial.selectionSource).toBe('Project environment');
  await service.select(file, python); service.dispose();
  const reopened = new PythonEnvironments(); expect((await reopened.resolve(file)).python).toBe(python);
  expect((await reopened.list(path.join(state.root, 'other.ipynb'))).selected).toBe(path.join(state.root, 'system-python'));
  await rm(python); await expect(reopened.resolve(file)).rejects.toThrow(/missing/); reopened.dispose();
});

test('ordinary Python and notebooks share the project choice while a notebook override remains authoritative', async () => {
  const { analysisPreferences } = await import('../language/analysis-preferences');
  const root = path.join(state.root, 'project'), file = path.join(root, 'notes.ipynb'), projectPython = path.join(state.root, 'project-python');
  await writeFile(projectPython, ''); analysisPreferences.set(root, 'python', projectPython);
  const service = new PythonEnvironments();
  expect((await service.resolve(file)).python).toBe(projectPython);
  expect((await service.list(path.join(root, 'main.py'), root)).selected).toBe(projectPython);
  expect((await service.list(path.join(root, 'main.py'), root, true)).selected).toBe(path.join(state.root, 'system-python'));
  await service.select(file, path.join(state.root, 'system-python'));
  expect((await service.resolve(file)).python).toBe(path.join(state.root, 'system-python'));
  expect((await service.list(path.join(root, 'main.py'), root)).selected).toBe(projectPython);
  service.dispose();
});

test('competing local environments require a choice and do not silently select the host', async () => {
  const root = path.join(state.root, 'ambiguous'), file = path.join(root, 'notes.ipynb');
  for (const name of ['.venv', 'venv']) {
    const python = path.join(root, name, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, '');
  }
  const service = new PythonEnvironments();
  expect(await service.list(file)).toMatchObject({ selected: undefined, selectionNeeded: true });
  await expect(service.resolve(file)).rejects.toThrow(/Multiple/);
  await service.select(file, path.join(state.root, 'system-python'));
  expect((await service.resolve(file)).python).toBe(path.join(state.root, 'system-python'));
  service.dispose();
});

test('an inner Git repository never inherits an outer local environment', async () => {
  const root = path.join(state.root, 'outer'), python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, '');
  const inner = path.join(root, 'inner'); await mkdir(inner); await writeFile(path.join(inner, '.git'), 'gitdir: submodule');
  const service = new PythonEnvironments();
  expect((await service.list(path.join(inner, 'notes.ipynb'))).selected).toBe(path.join(state.root, 'system-python'));
  service.dispose();
});

test.skipIf(process.platform === 'win32')('the selected interpreter reports its version and existing search paths once, and a failing one reports none', async () => {
  const { chmod } = await import('node:fs/promises');
  const site = path.join(state.root, 'site-packages'), calls = path.join(state.root, 'calls'), python = path.join(state.root, 'python');
  await mkdir(site);
  // Stands in for an interpreter: answers the query and records that it was asked.
  await writeFile(python, `#!/bin/sh\necho x >> '${calls}'\nprintf '%s' '${JSON.stringify({ version: '3.13', paths: [site, 'relative', 7] })}'\n`);
  await chmod(python, 0o755);
  const service = new PythonEnvironments();
  expect(await service.searchPaths(python)).toEqual({ version: '3.13', paths: [site] });
  expect(await service.searchPaths(python)).toEqual({ version: '3.13', paths: [site] });
  expect((await (await import('node:fs/promises')).readFile(calls, 'utf8')).trim().split('\n')).toHaveLength(1);
  expect(await service.searchPaths(path.join(state.root, 'missing-python'))).toEqual({ paths: [] });
  const broken = path.join(state.root, 'broken'); await writeFile(broken, '#!/bin/sh\necho not json\n'); await chmod(broken, 0o755);
  expect(await service.searchPaths(broken)).toEqual({ paths: [] });
  service.dispose();
});
