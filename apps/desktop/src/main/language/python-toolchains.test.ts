import { expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { belongsToProject, declaredPython, foundPythons, globalPythonKinds, pythonPrefix, pythonSource, type FoundPython } from './python-toolchains';

const root = path.resolve('/work/app'), home = path.resolve('/home/person');
const python = (file: string, more: Partial<FoundPython> = {}): FoundPython => ({ path: file, name: path.basename(file), ...more });

test('the host answer is read as Zed lists it, and anything that is not an interpreter at an absolute path is left out', () => {
  // The shape `toolchains` answers: Zed's `Toolchain` with PET's own record as `data`.
  const answer = { toolchains: [
    { name: 'Python 3.13.11 (uv)', path: `${root}/.venv/bin/python`, data: { kind: 'Uv', project: null, prefix: `${root}/.venv`, name: null, executable: `${root}/.venv/bin/python`, version: '3.13.11' } },
    { name: 'Python 3.12.3 (app-9TtSrW0h-py3.12; Poetry)', path: `${home}/.cache/pypoetry/virtualenvs/app-9TtSrW0h-py3.12/bin/python`, data: { kind: 'Poetry', project: root, prefix: `${home}/.cache/pypoetry/virtualenvs/app-9TtSrW0h-py3.12`, name: 'app-9TtSrW0h-py3.12' } },
    { name: 'Python 3.11.4 (base; Conda)', path: `${home}/miniconda3/bin/python`, data: { kind: 'Conda', prefix: `${home}/miniconda3`, name: 'base' } },
    { path: `${home}/bin/python3` },
    { name: 'relative', path: 'bin/python', data: { kind: 'Venv' } }, { name: 'no path' }, null, 'text',
    { name: 'odd', path: `${home}/odd/bin/python`, data: { kind: 7, project: 'relative', prefix: ['x'] } },
  ] };
  expect(foundPythons(answer)).toEqual([
    { name: 'Python 3.13.11 (uv)', path: `${root}/.venv/bin/python`, kind: 'Uv', project: undefined, prefix: `${root}/.venv`, environment: undefined },
    { name: 'Python 3.12.3 (app-9TtSrW0h-py3.12; Poetry)', path: `${home}/.cache/pypoetry/virtualenvs/app-9TtSrW0h-py3.12/bin/python`, kind: 'Poetry', project: root, prefix: `${home}/.cache/pypoetry/virtualenvs/app-9TtSrW0h-py3.12`, environment: 'app-9TtSrW0h-py3.12' },
    { name: 'Python 3.11.4 (base; Conda)', path: `${home}/miniconda3/bin/python`, kind: 'Conda', project: undefined, prefix: `${home}/miniconda3`, environment: 'base' },
    { name: 'python3', path: `${home}/bin/python3`, kind: undefined, project: undefined, prefix: undefined, environment: undefined },
    { name: 'odd', path: `${home}/odd/bin/python`, kind: undefined, project: undefined, prefix: undefined, environment: undefined },
  ]);
  for (const nothing of [undefined, null, 'text', {}, { toolchains: 'x' }, { toolchains: {} }]) expect(foundPythons(nothing)).toEqual([]);
  expect(foundPythons({ toolchains: Array.from({ length: 500 }, (_, index) => ({ path: `${home}/${index}/bin/python` })) })).toHaveLength(200);
});

test('an environment belongs to the project when it was made for it or lies in it; an interpreter of the whole computer never does', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'setdown-python-toolchains-')), root = path.join(folder, 'app');
  // A virtualenv has an activation script or a `pyvenv.cfg`; an installation of Python has neither.
  const made = (prefix: string, marker?: 'activate' | 'activate.fish' | 'pyvenv.cfg') => {
    mkdirSync(path.join(prefix, 'bin'), { recursive: true }); writeFileSync(path.join(prefix, 'bin/python'), '');
    if (marker) writeFileSync(marker === 'pyvenv.cfg' ? path.join(prefix, marker) : path.join(prefix, 'bin', marker), '');
    return path.join(prefix, 'bin/python');
  };
  try {
    const own: [string, FoundPython][] = [
      ['Poetry keeps it in its cache and records the project', python(`${home}/.cache/pypoetry/virtualenvs/app-x-py3.12/bin/python`, { kind: 'Poetry', project: root })],
      ['Pipenv records a folder inside the project', python(`${home}/.local/share/virtualenvs/api-x/bin/python`, { kind: 'Pipenv', project: `${root}/services/api` })],
      ['Hatch records the project', python(`${home}/.local/share/hatch/env/virtual/app/x/app/bin/python`, { kind: 'Hatch', project: root, environment: 'default' })],
      ['a virtualenv under another name', python(made(`${root}/env312`, 'activate'), { kind: 'Venv', prefix: `${root}/env312` })],
      ['a virtualenv made without scripts', python(made(`${root}/bare`, 'pyvenv.cfg'), { kind: 'Venv' })],
      ['a virtualenv with only another shell\'s script', python(made(`${root}/fish`, 'activate.fish'), { kind: 'VirtualEnv', prefix: `${root}/fish` })],
      ['a virtualenv of a kind PET does not say', python(made(`${root}/tools/py`, 'activate'))],
      ['Pixi', python(made(`${root}/.pixi/envs/default`), { kind: 'Pixi', prefix: `${root}/.pixi/envs/default`, environment: 'default' })],
      ['Conda made with --prefix has no name', python(made(`${root}/conda-env`), { kind: 'Conda', prefix: `${root}/conda-env` })],
    ];
    for (const [why, found] of own) expect(belongsToProject(found, root, undefined), why).toBe(true);
    const other: [string, FoundPython][] = [
      ['Poetry environment of another project', python(`${home}/.cache/pypoetry/virtualenvs/other-x-py3.12/bin/python`, { kind: 'Poetry', project: `${home}/other` })],
      ['Poetry environment of the folder above', python(`${home}/.cache/pypoetry/virtualenvs/work-x-py3.12/bin/python`, { kind: 'Poetry', project: path.dirname(root) })],
      ['a folder whose name only starts the same', python(made(`${root}-old/.venv`, 'activate'), { kind: 'Venv', prefix: `${root}-old/.venv` })],
      ['pyenv environment not named by the project', python(`${home}/.pyenv/versions/app/bin/python`, { kind: 'PyenvVirtualEnv', environment: 'app' })],
      ['the system interpreter', python('/usr/bin/python3', { kind: 'LinuxGlobal', prefix: '/usr' })],
      // With the home folder open, what is installed in it for the whole computer is not the project's.
      ['a Conda installation inside the open folder', python(made(`${root}/miniconda3`, 'activate'), { kind: 'Conda', prefix: `${root}/miniconda3`, environment: 'base' })],
      ['a named Conda environment inside the open folder', python(made(`${root}/miniconda3/envs/science`), { kind: 'Conda', prefix: `${root}/miniconda3/envs/science`, environment: 'science' })],
      ['a Python that uv installed inside the open folder', python(made(`${root}/.local/share/uv/python/cpython-3.12.13-linux-x86_64-gnu`), { kind: 'Uv', prefix: `${root}/.local/share/uv/python/cpython-3.12.13-linux-x86_64-gnu` })],
      ...globalPythonKinds.map(kind => [`${kind} lying inside the project`, python(made(`${root}/.pyenv/versions/3.12.3`, 'activate'), { kind, prefix: `${root}/.pyenv/versions/3.12.3` })] as [string, FoundPython]),
    ];
    for (const [why, found] of other) expect(belongsToProject(found, root, undefined), why).toBe(false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a `.venv` file names the project\'s environment; a `.venv` folder names nothing', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'setdown-python-toolchains-'));
  try {
    const pyenv = python(`${home}/.pyenv/versions/app/bin/python`, { kind: 'PyenvVirtualEnv', environment: 'app' });
    expect(declaredPython(folder)).toBeUndefined();
    expect(belongsToProject(pyenv, folder)).toBe(false);
    writeFileSync(path.join(folder, '.venv'), '  app \nsecond line\n');
    expect(declaredPython(folder)).toBe('app');
    expect(belongsToProject(pyenv, folder)).toBe(true);
    expect(belongsToProject({ ...pyenv, environment: 'other' }, folder)).toBe(false);
    // Named by the project, it is the project's even where its kind is an interpreter of the whole computer.
    expect(belongsToProject(python(`${home}/.pyenv/versions/app/bin/python`, { kind: 'Pyenv', environment: 'app' }), folder)).toBe(true);
    writeFileSync(path.join(folder, '.venv'), '\n');
    expect(declaredPython(folder)).toBeUndefined();
    rmSync(path.join(folder, '.venv')); mkdirSync(path.join(folder, '.venv'));
    expect(declaredPython(folder)).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('an environment is named by its folder, and the panel says where it came from', () => {
  expect(pythonPrefix({ path: `${root}/.venv/bin/python` })).toBe(`${root}/.venv`);
  expect(pythonPrefix({ path: `${root}/.venv/bin/python3.12` })).toBe(`${root}/.venv`);
  expect(pythonPrefix({ path: `${home}/miniconda3/python.exe`, prefix: `${home}/miniconda3` })).toBe(`${home}/miniconda3`);
  expect(['Poetry', 'Pipenv', 'Hatch', 'Pixi', 'Conda', 'PyenvVirtualEnv', 'Pyenv', 'Uv', 'UvWorkspace', 'Venv', 'LinuxGlobal', undefined, 'Later'].map(kind => pythonSource(python('/x/bin/python', { kind }))))
    .toEqual(['Poetry', 'Pipenv', 'Hatch', 'Pixi', 'Conda', 'pyenv', 'pyenv', 'uv', 'uv', 'venv', 'This computer', 'Python environment', 'Python environment']);
});

// What was taken from Zed is compared with the copy in `vendor`, so a Zed update that
// changes the rule fails here instead of leaving Setdown with the old one.
const upstream = path.resolve(__dirname, '../../../../../vendor/zed/crates/languages/src/python.rs');
test.skipIf(!existsSync(upstream))('the kinds are the ones vendor/zed states', () => {
  const source = readFileSync(upstream, 'utf8');
  const body = (name: string) => { const start = source.indexOf(`fn ${name}(`); expect(start, name).toBeGreaterThan(-1); return source.slice(start, source.indexOf('\n}\n', start)); };
  const kinds = (text: string) => [...text.matchAll(/PythonEnvironmentKind::(\w+)/g)].map(match => match[1]);
  expect(kinds(body('is_python_env_global'))).toEqual(globalPythonKinds);
  // Every kind Zed names in its picker has a name in Setdown's panel.
  const named = kinds(body('python_env_kind_display'));
  expect(named.length).toBeGreaterThan(15);
  for (const kind of named) expect(pythonSource(python('/x/bin/python', { kind })), kind).not.toBe('Python environment');
  // The two things `belongsToProject` reads Zed's order from.
  expect(source).toContain('lhs.project.clone().or_else(|| get_venv_parent_dir(lhs))');
  expect(body('get_venv_parent_dir')).toContain('.filter(|p| is_virtualenv_dir(p))?');
  expect(source).toContain('async_fs::File::open(worktree_root.join(".venv"))');
  // The record the host passes on is PET's own, with its fields at the top (`kind`, `project`, `prefix`, `name`).
  expect(source).toMatch(/#\[serde\(flatten\)\]\s+environment: PythonEnvironment,/);
  expect(source).toContain('as_json: serde_json::to_value(data).ok()?,');
});
