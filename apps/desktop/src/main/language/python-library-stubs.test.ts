import { afterEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { libraryStubs } from './python-library-stubs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function layout(files: string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-library-stubs-')); roots.push(root);
  for (const file of files) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), ''); }
  return root;
}
function bundled(): string {
  const root = layout([]);
  writeFileSync(path.join(root, 'stubs.json'), JSON.stringify({
    pandas: { distribution: 'pandas-stubs', version: '3.1.0', paths: ['pandas'] },
    scipy: { distribution: 'scipy-stubs', version: '1.18.1.1', paths: ['scipy'], python: '3.12', numpy: { '2.0': 'numpy-typing-compat/2.0', '2.4': 'numpy-typing-compat/2.4' } },
  }));
  return root;
}

test('bundled stubs apply only to an installed library that has no type information of its own', () => {
  const shipped = bundled(), project = layout([]);
  const untyped = layout(['site/pandas/__init__.py']);
  expect(libraryStubs(project, { version: '3.9', paths: [path.join(untyped, 'site')] }, shipped)).toEqual({ paths: [path.join(shipped, 'pandas')],
    evidence: ['Library types (pandas): pandas-stubs 3.1.0 bundled with Setdown, because the installed library publishes none'] });
  // A library that is not installed is not described at all: its import stays unresolved.
  expect(libraryStubs(project, { paths: [layout(['site/numpy/__init__.py'])] }, shipped)).toEqual({ paths: [], evidence: [] });
  expect(libraryStubs(project, { paths: [path.join(untyped, 'site')] }, path.join(shipped, 'missing'))).toEqual({ paths: [], evidence: [] });
});

test('types from the library, the environment or the project win over bundled stubs', () => {
  const shipped = bundled(), project = layout([]);
  const typed = layout(['site/pandas/__init__.py', 'site/pandas/py.typed']);
  expect(libraryStubs(project, { paths: [path.join(typed, 'site')] }, shipped)).toEqual({ paths: [], evidence: ['Library types (pandas): published by the installed library'] });
  const stubbed = layout(['site/pandas/__init__.py', 'user/pandas-stubs/__init__.pyi']);
  expect(libraryStubs(project, { paths: [path.join(stubbed, 'site'), path.join(stubbed, 'user')] }, shipped))
    .toEqual({ paths: [], evidence: ['Library types (pandas): pandas-stubs installed in the selected environment'] });
  const own = layout(['typings/pandas/__init__.pyi']), untyped = layout(['site/pandas/__init__.py']);
  expect(libraryStubs(own, { paths: [path.join(untyped, 'site')] }, shipped)).toEqual({ paths: [], evidence: ['Library types (pandas): this project’s typings folder'] });
});

test('stubs that depend on the NumPy and Python versions follow the selected environment', () => {
  const shipped = bundled(), project = layout([]);
  const current = path.join(layout(['site/scipy/__init__.py', 'site/numpy/__init__.py', 'site/numpy-2.4.0.dist-info/METADATA']), 'site');
  expect(libraryStubs(project, { version: '3.13', paths: [current] }, shipped)).toEqual({
    paths: [path.join(shipped, 'scipy'), path.join(shipped, 'numpy-typing-compat/2.4')],
    evidence: ['Library types (scipy): scipy-stubs 1.18.1.1 bundled with Setdown, because the installed library publishes none'] });
  expect(libraryStubs(project, { version: '3.10', paths: [current] }, shipped)).toEqual({ paths: [], evidence: [
    'Library types (scipy): inferred from the library’s source code; scipy-stubs 1.18.1.1 bundled with Setdown needs Python 3.12 or newer; the selected environment is 3.10'] });
  const older = path.join(layout(['site/scipy/__init__.py', 'site/numpy-1.26.4.dist-info/METADATA']), 'site');
  expect(libraryStubs(project, { version: '3.12', paths: [older] }, shipped)).toEqual({ paths: [], evidence: [
    'Library types (scipy): inferred from the library’s source code; scipy-stubs 1.18.1.1 bundled with Setdown needs NumPy 2.0–2.4; the selected environment has NumPy 1.26'] });
});
