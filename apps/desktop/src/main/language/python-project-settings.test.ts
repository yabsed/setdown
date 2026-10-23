import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPythonProjectSettings, isPythonSettingsFile, pythonProjectSettings, pythonSettingsContext } from './python-project-settings';
import { configurationSection } from './server-session';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(text: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-python-settings-')); roots.push(root);
  mkdirSync(path.join(root, '.vscode'));
  writeFileSync(path.join(root, '.vscode/settings.json'), text);
  return root;
}
test('JSONC compatibility paths preserve order and expand only the owning workspace', () => {
  const root = fixture('{ // comment\n "python.analysis.extraPaths": ["./src", "${workspaceFolder}/lib", "./src",], }');
  const project = pythonProjectSettings(root);
  expect(project.extraPaths).toEqual([path.join(root, 'src'), path.join(root, 'lib')]);
  const configuration = applyPythonProjectSettings({ basedpyright: { analysis: { typeCheckingMode: 'off' } } }, project, 'basedpyright');
  expect(configurationSection(configuration, 'basedpyright.analysis')).toEqual({ typeCheckingMode: 'off', extraPaths: project.extraPaths });
  expect(configurationSection(configuration, 'basedpyright')).toEqual({ analysis: { typeCheckingMode: 'off', extraPaths: project.extraPaths } });
  expect(project.errors).toEqual([]);
});
test('basedpyright paths take precedence, including an explicit empty list', () => {
  const root = fixture('{ "basedpyright": {"analysis": {"extraPaths": []}}, "python.analysis.extraPaths": ["src"] }');
  expect(pythonProjectSettings(root).extraPaths).toEqual([]);
});
test('explicit connection paths and native execution environments are not flattened or replaced', () => {
  const root = fixture('{"python.analysis.extraPaths":["compat"]}');
  const native = '{"executionEnvironments":[{"root":"a","extraPaths":["a/src"]},{"root":"b","extraPaths":["b/src"]}]}';
  writeFileSync(path.join(root, 'pyrightconfig.json'), native);
  const project = pythonProjectSettings(root);
  const configuration = { 'python.analysis.extraPaths': ['/explicit'] };
  expect(applyPythonProjectSettings(configuration, project, 'pyright')).toBe(configuration);
  expect(project.projectConfiguration).toBe(path.join(root, 'pyrightconfig.json'));
  expect(pythonSettingsContext(project, configuration, 'pyright')).toContainEqual(['Analysis path source', 'Language connection settings']);
});
test('a nested repository cannot borrow the outer workspace configuration', () => {
  const root = fixture('{"python.analysis.extraPaths":["outer"]}');
  const nested = path.join(root, 'nested'); mkdirSync(nested); writeFileSync(path.join(nested, '.git'), 'gitdir: elsewhere');
  expect(pythonProjectSettings(nested).extraPaths).toBeUndefined();
  expect(isPythonSettingsFile(nested, path.join(root, '.vscode/settings.json'))).toBe(false);
});
test.each(['{"python.analysis.extraPaths":false}', '{broken', '{"python.analysis.extraPaths":["${env:HOME}/src"]}'])('invalid settings are visible and never become analysis paths: %s', text => {
  const settings = pythonProjectSettings(fixture(text));
  expect(settings.extraPaths).toBeUndefined(); expect(settings.errors).toHaveLength(1);
});
test('removing compatibility paths clears their previous value', () => {
  const root = fixture('{"python.analysis.extraPaths":["src"]}');
  expect(pythonProjectSettings(root).extraPaths).toHaveLength(1);
  writeFileSync(path.join(root, '.vscode/settings.json'), '{}');
  expect(pythonProjectSettings(root).extraPaths).toBeUndefined();
  expect(applyPythonProjectSettings({ python: { analysis: { typeCheckingMode: 'off' } } }, pythonProjectSettings(root), 'pyright'))
    .toEqual({ python: { analysis: { typeCheckingMode: 'off' } } });
});


test('identical explicit and project paths retain the explicit connection provenance', () => {
  const root = fixture('{"python.analysis.extraPaths":["src"]}');
  const project = pythonProjectSettings(root), config = { 'python.analysis.extraPaths': project.extraPaths };
  const applied = applyPythonProjectSettings(config, project, 'pyright');
  expect(pythonSettingsContext(project, applied, 'pyright')).toContainEqual(['Analysis path source', 'Language connection settings']);
  const inherited = applyPythonProjectSettings({}, project, 'pyright');
  expect(pythonSettingsContext(project, inherited, 'pyright')).toContainEqual(['Analysis path source', project.source!]);
});
