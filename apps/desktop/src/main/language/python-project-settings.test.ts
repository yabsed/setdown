import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPythonProjectSettings, isPythonSettingsFile, pythonProjectSettings, pythonSettingsContext, withLibraryStubs } from './python-project-settings';
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
  expect(configurationSection(configuration, 'basedpyright.analysis.extraPaths')).toEqual(project.extraPaths);
  expect(configurationSection(configuration, 'basedpyright.analysis.typeCheckingMode')).toBe('off');
  expect(configurationSection(configuration, 'basedpyright')).toEqual({ analysis: configurationSection(configuration, 'basedpyright.analysis') });
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
  expect(configurationSection(applyPythonProjectSettings(configuration, project, 'pyright'), 'python.analysis.extraPaths')).toEqual(['/explicit']);
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
  expect(configurationSection(applyPythonProjectSettings({ python: { analysis: { typeCheckingMode: 'off' } } }, pythonProjectSettings(root), 'pyright'), 'python.analysis'))
    .toEqual({ typeCheckingMode: 'off' });
});


test('identical explicit and project paths retain the explicit connection provenance', () => {
  const root = fixture('{"python.analysis.extraPaths":["src"]}');
  const project = pythonProjectSettings(root), config = { 'python.analysis.extraPaths': project.extraPaths };
  const applied = applyPythonProjectSettings(config, project, 'pyright');
  expect(pythonSettingsContext(project, applied, 'pyright')).toContainEqual(['Analysis path source', 'Language connection settings']);
  const inherited = applyPythonProjectSettings({}, project, 'pyright');
  expect(pythonSettingsContext(project, inherited, 'pyright')).toContainEqual(['Analysis path source', project.source!]);
});

test('workspace checking overrides product defaults, explicit choices win, and native config stays server-owned', () => {
  const root = fixture('{"python.analysis.typeCheckingMode":"strict"}'), project = pythonProjectSettings(root);
  const config = { python: { analysis: { typeCheckingMode: 'basic' } } };
  expect(configurationSection(applyPythonProjectSettings(config, project, 'pyright', false), 'python.analysis.typeCheckingMode')).toBe('strict');
  expect(configurationSection(applyPythonProjectSettings(config, project, 'pyright', true), 'python.analysis.typeCheckingMode')).toBe('basic');
  expect(configurationSection(applyPythonProjectSettings(config, project, 'pyright', false, 'off'), 'python.analysis.typeCheckingMode')).toBe('off');
  expect(configurationSection(applyPythonProjectSettings({}, { errors: [] }, 'basedpyright'), 'basedpyright.analysis.typeCheckingMode')).toBe('basic');
});

test('off keeps the warnings Pyright and Pylance report in off, without replacing explicit severities', () => {
  const baseline = { reportMissingImports: 'warning', reportMissingModuleSource: 'warning', reportInvalidTypeForm: 'warning', reportUndefinedVariable: 'warning' };
  const applied = applyPythonProjectSettings({}, { errors: [] }, 'basedpyright', true, 'off');
  expect(configurationSection(applied, 'basedpyright.analysis.diagnosticSeverityOverrides')).toEqual(baseline);
  expect(configurationSection(applied, 'basedpyright')).toEqual({ analysis: { typeCheckingMode: 'off', diagnosticSeverityOverrides: baseline } });
  const explicit = { basedpyright: { analysis: { typeCheckingMode: 'off', diagnosticSeverityOverrides: { reportUndefinedVariable: 'error', reportUnusedImport: 'warning' } } } };
  expect(configurationSection(applyPythonProjectSettings(explicit, { errors: [] }, 'basedpyright'), 'basedpyright.analysis.diagnosticSeverityOverrides'))
    .toEqual({ ...baseline, reportUndefinedVariable: 'error', reportUnusedImport: 'warning' });
  // Pyright's own off preset already reports them, and other levels report them as errors.
  expect(configurationSection(applyPythonProjectSettings({}, { errors: [] }, 'pyright', true, 'off'), 'python.analysis')).toEqual({ typeCheckingMode: 'off' });
  expect(configurationSection(applyPythonProjectSettings({}, { errors: [] }, 'basedpyright'), 'basedpyright.analysis')).toEqual({ typeCheckingMode: 'basic' });
});

test('bundled library stubs follow the analysis paths that the project and the user already chose', () => {
  const project = applyPythonProjectSettings({}, { extraPaths: ['/project/src'], source: 'settings', errors: [] }, 'basedpyright');
  const applied = withLibraryStubs(project, 'basedpyright', ['/bundled/pandas', '/project/src']);
  expect(configurationSection(applied, 'basedpyright.analysis.extraPaths')).toEqual(['/project/src', '/bundled/pandas']);
  expect(configurationSection(applied, 'basedpyright')).toEqual({ analysis: configurationSection(applied, 'basedpyright.analysis') });
  expect(configurationSection(applied, 'basedpyright.analysis.typeCheckingMode')).toBe('basic');
  // A flat connection setting has precedence in workspace/configuration, so it is kept aligned.
  const flat = withLibraryStubs({ 'python.analysis.extraPaths': ['lib'] }, 'pyright', ['/bundled/pandas']);
  expect(flat['python.analysis.extraPaths']).toEqual(['lib', '/bundled/pandas']);
  expect(configurationSection(flat, 'python')).toEqual({ analysis: { extraPaths: ['lib', '/bundled/pandas'] } });
  expect(withLibraryStubs(project, 'basedpyright', [])).toBe(project);
});
