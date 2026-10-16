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
test('offers project Python without launching or selecting it, and persists an explicit per-notebook choice', async () => {
  const file = path.join(state.root, 'project', 'test.ipynb'), python = path.join(path.dirname(file), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, 'not an executable program');
  const service = new PythonEnvironments(), initial = await service.list(file);
  expect(initial.candidates).toContainEqual(expect.objectContaining({ path: python, source: 'Project' }));
  expect(initial.selected).toBe(path.join(state.root, 'system-python'));
  await service.select(file, python); service.dispose();
  const reopened = new PythonEnvironments(); expect((await reopened.resolve(file)).python).toBe(python);
  expect((await reopened.list(path.join(state.root, 'other.ipynb'))).selected).toBe(path.join(state.root, 'system-python'));
  await rm(python); await expect(reopened.resolve(file)).rejects.toThrow(/missing/); reopened.dispose();
});
