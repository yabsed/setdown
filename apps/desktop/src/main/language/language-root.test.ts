import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { builtinLanguageServers } from './catalog/profiles';
import { languageRoot } from './language-root';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-analysis-root-')); directories.push(root);
  const write = (file: string, text = '') => { const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, text); return target; };
  const resolve = (file: string, server: string, folder?: string, override?: string) => languageRoot(path.join(root, file), builtinLanguageServers.find(d => d.id === server)!, folder && path.join(root, folder), override && path.join(root, override));
  return { root, write, resolve };
}
test('Python files use the same nested project for standalone, project and containing-folder opens', () => {
  const f = fixture(); f.write('.git'); f.write('pyproject.toml'); f.write('vendor/module/.git', 'gitdir: ../../.git/modules/module');
  f.write('vendor/module/pyproject.toml', '[project]\nname="module"'); f.write('vendor/module/module/one.py');
  for (const folder of [undefined, '.', 'vendor/module', 'vendor/module/module'])
    expect(f.resolve('vendor/module/module/one.py', 'pyright', folder)).toEqual({ path: path.join(f.root, 'vendor/module'), reason: 'Project marker: pyproject.toml' });
});
test('a submodule without markers never borrows its parent configuration; an explicit root is scoped to its descendants', () => {
  const f = fixture(); f.write('pyproject.toml'); f.write('vendor/child/.git'); f.write('vendor/child/src/main.py'); f.write('other/main.py');
  expect(f.resolve('vendor/child/src/main.py', 'pyright', '.').path).toBe(path.join(f.root, 'vendor/child'));
  expect(f.resolve('vendor/child/src/main.py', 'pyright', '.', '.').reason).toMatch(/User-selected/);
  expect(f.resolve('other/main.py', 'pyright', '.', 'vendor/child').path).toBe(f.root);
});
test('TypeScript keeps nested packages and their configurations separate', () => {
  const f = fixture(); f.write('package.json', '{"workspaces":["packages/*"]}'); f.write('tsconfig.json', '{}');
  f.write('packages/a/package.json', '{}'); f.write('packages/a/tsconfig.json', '{}'); f.write('packages/a/src/main.ts');
  expect(f.resolve('packages/a/src/main.ts', 'typescript-language-server', '.').path).toBe(path.join(f.root, 'packages/a'));
});
test('Cargo workspace members, exclusions, nested workspaces and explicit package.workspace select their own analysis roots', () => {
  const f = fixture(); f.write('.git');
  f.write('Cargo.toml', '[workspace]\nmembers=["crates/*"]\nexclude=["crates/excluded"]');
  for (const crate of ['member', 'excluded', 'nested']) { f.write(`crates/${crate}/Cargo.toml`, '[package]\nname="fixture"'); f.write(`crates/${crate}/src/lib.rs`); }
  expect(f.resolve('crates/member/src/lib.rs', 'rust-analyzer').path).toBe(f.root);
  expect(f.resolve('crates/excluded/src/lib.rs', 'rust-analyzer').path).toBe(path.join(f.root, 'crates/excluded'));
  f.write('crates/nested/Cargo.toml', '[workspace]\nmembers=[]');
  expect(f.resolve('crates/nested/src/lib.rs', 'rust-analyzer').path).toBe(path.join(f.root, 'crates/nested'));
  f.write('separate/Cargo.toml', '[package]\nworkspace=".."'); f.write('separate/src/lib.rs');
  expect(f.resolve('separate/src/lib.rs', 'rust-analyzer').path).toBe(f.root);
});
