import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';

export type PythonProjectSettings = {
  extraPaths?: string[];
  source?: string;
  projectConfiguration?: string;
  errors: string[];
};

function section(settings: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(settings, key)) return settings[key];
  let value: unknown = settings;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Metadata only, scoped to the selected analysis root. Never evaluates Python,
 * crawls parent repositories, or flattens Pyright executionEnvironments. */
export function pythonProjectSettings(root: string): PythonProjectSettings {
  const file = path.join(root, '.vscode', 'settings.json');
  const result: PythonProjectSettings = { errors: [] };
  result.projectConfiguration = ['pyrightconfig.json', 'pyproject.toml']
    .map(name => path.join(root, name)).find(candidate => existsSync(candidate));
  if (!existsSync(file)) return result;
  try {
    if (statSync(file).size > 1024 * 1024) throw Error('Settings exceed 1 MiB.');
    const errors: ParseError[] = [];
    const settings = parse(readFileSync(file, 'utf8'), errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Invalid JSONC settings.');
    const key = section(settings, 'basedpyright.analysis.extraPaths') !== undefined
      ? 'basedpyright.analysis.extraPaths' : 'python.analysis.extraPaths';
    const entries = section(settings, key);
    if (entries === undefined) return result;
    result.source = `${file} → ${key}`;
    if (!Array.isArray(entries) || entries.length > 256 || entries.some(value => typeof value !== 'string' || value.includes('\0')))
      throw Error(`${key} must be an array of at most 256 paths.`);
    const expanded = entries.map(value => value.replaceAll('${workspaceFolder}', root));
    if (expanded.some(value => /\$\{[^}]*\}/.test(value))) throw Error('Only ${workspaceFolder} is supported in analysis paths.');
    result.extraPaths = [...new Set(expanded.map(value => path.resolve(root, value)))];
  } catch (error) { result.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
  return result;
}

/** Explicit connection settings win. Native pyrightconfig/pyproject precedence
 * is left to the language server; these are client defaults, not merged configs. */
const appliedSources = new WeakMap<object, string>();
export function applyPythonProjectSettings(configuration: Record<string, unknown>, project: PythonProjectSettings,
  server: 'pyright' | 'basedpyright'): Record<string, unknown> {
  const name = server === 'basedpyright' ? 'basedpyright' : 'python';
  const key = `${name}.analysis.extraPaths`;
  if (project.extraPaths === undefined || section(configuration, key) !== undefined) return configuration;
  // Flat sections are supported by workspace/configuration too; use the most
  // specific key so nested defaults and the compatibility value cannot diverge.
  const value = structuredClone(configuration);
  const analysis = section(value, `${name}.analysis`);
  value[`${name}.analysis`] = { ...(analysis && typeof analysis === 'object' ? analysis : {}), extraPaths: project.extraPaths };
  const outer = value[name];
  value[name] = { ...(outer && typeof outer === 'object' ? outer : {}), analysis: value[`${name}.analysis`] };
  if (project.source) appliedSources.set(value, project.source);
  return value;
}

export function pythonSettingsContext(project: PythonProjectSettings, configuration: Record<string, unknown>, server: 'pyright' | 'basedpyright'): [string, string][] {
  const key = `${server === 'basedpyright' ? 'basedpyright' : 'python'}.analysis.extraPaths`;
  const configured = section(configuration, key);
  return [
    ['Analysis paths', `${JSON.stringify(configured ?? [])} (client configuration; project configuration may override)`],
    ['Analysis path source', appliedSources.get(configuration) ?? (configured !== undefined ? 'Language connection settings' : 'Server defaults')],
    ['Project analysis configuration', project.projectConfiguration
      ? `${project.projectConfiguration} (detected; interpreted by server, including executionEnvironments)` : 'No pyrightconfig.json or pyproject.toml at analysis root'],
    ...project.errors.map(message => ['Settings warning', message] as [string, string]),
  ];
}

export function isPythonSettingsFile(root: string, file: string): boolean {
  return ['.vscode/settings.json', 'pyrightconfig.json', 'pyproject.toml']
    .some(name => path.resolve(root, name) === path.resolve(file));
}
