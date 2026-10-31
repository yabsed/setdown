import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parse } from 'jsonc-parser';
import type { AnalysisChoice, AnalysisContext } from '../../core/document/analysis-context';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { notebookPython } from '../notebook/python-environments';
import { analysisPreferences } from './analysis-preferences';
import type { Options } from './server-registry';
import type { ServerLaunch } from './server-session';
import { serverProfile, type ServerProfile } from './server-definitions';
import { applyPythonProjectSettings, pythonProjectSettings, pythonSettingsContext } from './python-project-settings';

function json(file: string): Record<string, any> | undefined {
  try { if (statSync(file).size <= 1024 * 1024) return parse(readFileSync(file, 'utf8')); } catch { /* Optional metadata. */ }
}
function fileExists(file: string): boolean { try { return statSync(file).isFile(); } catch { return false; } }
function section(value: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(value, key)) return value[key];
  return key.split('.').reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, value);
}
function setPython(configuration: Record<string, unknown>, python: string) {
  const outer = configuration.python;
  return { ...configuration, python: { ...(outer && typeof outer === 'object' ? outer : {}), pythonPath: python }, 'python.pythonPath': python };
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export type AnalysisPlan = { context: AnalysisContext; profile: ServerProfile; args: string[]; inputs: string[]; configuration(settings: Record<string, unknown>): Record<string, unknown> };

/** Builder's context → tooling → launch boundary, using Setdown's existing LSP transport.
 * Discovery reads metadata only. A project SDK/interpreter is used after explicit selection.
 * The plan used to explain the environment is also the plan used to start its server. */
export class AnalysisContextService {
  private readonly cache = new Map<string, { expires: number; result: Promise<AnalysisPlan> }>();
  invalidate(root?: string): void {
    for (const key of this.cache.keys()) if (!root || key.startsWith(root + '\0')) this.cache.delete(key);
  }
  async resolve(root: string, reason: string, definition: LanguageServerDefinition, options: Options = {}, refresh = false): Promise<AnalysisPlan> {
    const preferences = analysisPreferences.get(root);
    const key = root + '\0' + digest([definition, options, preferences]);
    const existing = this.cache.get(key);
    if (!refresh && existing && existing.expires > Date.now()) return existing.result;
    const result = this.build(root, reason, definition, options);
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expires: Date.now() + 30_000, result });
    try { return await result; } catch (error) { this.cache.delete(key); throw error; }
  }
  private async build(root: string, reason: string, definition: LanguageServerDefinition, options: Options): Promise<AnalysisPlan> {
    const preferences = analysisPreferences.get(root), profile = serverProfile(definition, options);
    const context: AnalysisContext = { id: '', root, rootReason: reason, environment: 'usable', choices: [], evidence: [], issues: [] };
    let configuration = (settings: Record<string, unknown>): Record<string, unknown> => settings;
    const inputs = new Set<string>(), args = [...(options.args ?? definition.launch.args)];
    const issue = (code: string, message: string, required = false) => { context.issues.push({ code, message }); if (required || context.environment !== 'action-needed') context.environment = required ? 'action-needed' : 'partial'; };
    const choice = (file: string, source: string, name = path.basename(file), available = fileExists(file)): AnalysisChoice => {
      const item = { id: digest(file), path: file, source, name, available };
      if (!context.choices.some(c => c.id === item.id)) context.choices.push(item);
      inputs.add(file); return item;
    };
    if (definition.languages.some(l => l.languageId === 'python')) {
      context.kind = 'python'; context.label = 'Python environment';
      const project = pythonProjectSettings(root), server = /basedpyright/.test(definition.id) ? 'basedpyright' : 'pyright';
      profile.configuration = applyPythonProjectSettings(profile.configuration, project, server);
      for (const [key, value] of pythonSettingsContext(project, profile.configuration, server)) context.evidence.push(`${key}: ${value}`);
      for (const name of ['pyrightconfig.json', 'pyproject.toml', '.vscode/settings.json', '.venv', 'venv']) inputs.add(path.join(root, name));
      const environments = await notebookPython.list(path.join(root, '__setdown_analysis__.py'), root);
      for (const candidate of environments.candidates) choice(candidate.path, candidate.source, candidate.name, true);
      const configured = section(profile.configuration, 'python.pythonPath');
      const inherited = (typeof configured === 'string' && configured ? path.resolve(root, configured) : undefined) ?? environments.selected;
      context.selectionSource = preferences.python ? 'project' : configured ? 'connection' : 'automatic';
      if (inherited) context.inherited = choice(inherited, configured ? 'Connection settings' : 'Automatic selection');
      const selected = preferences.python ?? inherited;
      if (selected) {
        const item = choice(selected, preferences.python ? 'Project selection' : configured ? 'Connection settings' : 'Host environment');
        context.selected = item.id;
        if (!item.available) issue('python-missing', `The selected Python environment is missing: ${selected}. Choose an environment to restore imports.`, true);
        // Retain even a missing explicit choice; never silently substitute a different interpreter.
        profile.configuration = setPython(profile.configuration, selected);
      } else issue('python-unknown', 'Choose a Python environment so imports can use the project dependencies.', true);
      configuration = settings => {
        const scoped = applyPythonProjectSettings(settings, project, server);
        return selected && (preferences.python || section(scoped, 'python.pythonPath') === undefined) ? setPython(scoped, selected) : scoped;
      };
      if (!preferences.python && !configured && environments.candidates.some(c => c.source === 'Project'))
        issue('python-project-environment', 'A project virtual environment is available. Select it to use its installed packages.', true);
      for (const message of project.errors) issue('python-settings', message);
    } else if (definition.id === 'typescript-language-server') {
      context.kind = 'typescript'; context.label = 'TypeScript SDK';
      const bundled = require.resolve('typescript/lib/tsserver.js').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
      const bundledVersion = json(path.join(path.dirname(bundled), '..', 'package.json'))?.version;
      const bundledChoice = choice(bundled, 'Bundled', `Bundled TypeScript${bundledVersion ? ` ${bundledVersion}` : ''}`);
      let directory = root;
      for (let depth = 0; depth < 64; depth++) {
        const sdk = path.join(directory, 'node_modules/typescript/lib/tsserver.js');
        inputs.add(path.join(directory, 'node_modules/typescript/package.json'));
        if (fileExists(sdk)) { const version = json(path.join(path.dirname(sdk), '..', 'package.json'))?.version; choice(sdk, 'Project', `Project TypeScript${version ? ` ${version}` : ''}`); break; }
        if (existsSync(path.join(directory, '.git')) || path.dirname(directory) === directory) break;
        directory = path.dirname(directory);
      }
      const configured = section(profile.initializationOptions ?? {}, 'tsserver.path');
      context.selectionSource = preferences.typescript ? 'project' : configured ? 'connection' : 'automatic';
      context.inherited = typeof configured === 'string' ? choice(configured, 'Connection settings', 'Configured TypeScript SDK') : bundledChoice;
      const selected = preferences.typescript === 'bundled' ? bundled : preferences.typescript ?? (typeof configured === 'string' ? configured : bundled);
      const item = selected === bundled ? bundledChoice : choice(selected, preferences.typescript ? 'Project selection' : 'Connection settings', 'Selected TypeScript SDK');
      context.selected = item.id; context.evidence.push(`TypeScript SDK: ${selected}`);
      if (!item.available) issue('typescript-sdk-missing', `The selected TypeScript SDK is missing: ${selected}. Choose the bundled SDK or restore the project SDK.`, true);
      const previous = profile.initializationOptions?.tsserver;
      profile.initializationOptions = { ...profile.initializationOptions, tsserver: { ...(previous && typeof previous === 'object' ? previous : {}), path: selected } };
      for (const name of ['tsconfig.json', 'jsconfig.json', 'package.json']) {
        const file = path.join(root, name); inputs.add(file); if (existsSync(file)) context.evidence.push(`Project configuration: ${file}`);
      }
      const pkg = json(path.join(root, 'package.json'));
      if ((pkg?.dependencies || pkg?.devDependencies) && !existsSync(path.join(root, 'node_modules')) && directory === root)
        issue('typescript-dependencies', 'No node_modules directory was found here. If imports are unresolved, install this project’s dependencies with its package manager.');
    } else if (definition.id === 'clangd') {
      context.kind = 'compilation'; context.label = 'C / C++ build configuration';
      const index = args.findIndex(arg => arg === '--compile-commands-dir' || arg.startsWith('--compile-commands-dir='));
      const configured = index < 0 ? undefined : args[index].slice('--compile-commands-dir='.length) || args[index + 1];
      const directories = new Set([root, path.join(root, 'build'), path.join(root, 'builddir'), path.join(root, 'out/build')]);
      // Literal local presets are useful metadata. Do not evaluate environment macros, includes or scripts.
      for (const name of ['CMakePresets.json', 'CMakeUserPresets.json']) {
        const file = path.join(root, name); inputs.add(file);
        const presets = json(file)?.configurePresets;
        for (const preset of (Array.isArray(presets) ? presets.slice(0, 32) : [])) {
          if (!preset || typeof preset !== 'object') continue;
          if (typeof preset.binaryDir !== 'string') continue;
          const dir = preset.binaryDir.replaceAll('${sourceDir}', root).replaceAll('${presetName}', String(preset.name));
          if (!dir.includes('$')) directories.add(path.resolve(root, dir));
          if (directories.size >= 32) break;
        }
      }
      for (const directory of directories) {
        const database = path.join(directory, 'compile_commands.json'); inputs.add(database);
        if (fileExists(database)) choice(database, 'Detected build', path.relative(root, directory) || 'Project root');
      }
      context.selectionSource = preferences.compilation ? 'project' : configured ? 'connection' : 'automatic';
      const detected = context.choices.find(c => c.path === path.join(root, 'compile_commands.json')) ?? (context.choices.length === 1 ? context.choices[0] : undefined);
      context.inherited = configured ? choice(path.resolve(root, configured, 'compile_commands.json'), 'Connection arguments') : detected;
      const explicit = preferences.compilation ?? (configured ? path.resolve(root, configured, 'compile_commands.json') : undefined);
      const selected = explicit ? choice(explicit, preferences.compilation ? 'Project selection' : 'Connection arguments', path.basename(path.dirname(explicit)))
        : detected;
      if (selected) {
        context.selected = selected.id;
        if (!selected.available) issue('compilation-missing', `The selected compilation database is missing: ${selected.path}. Choose or configure a build.`, true);
        // The selected database changes the actual process argv, not just the status label.
        if (index >= 0) args.splice(index, args[index] === '--compile-commands-dir' ? 2 : 1);
        args.push(`--compile-commands-dir=${path.dirname(selected.path)}`);
        context.evidence.push(`Compilation database: ${selected.path}`);
      } else if (context.choices.length > 1) issue('compilation-choice', 'Several build configurations are available. Choose the one used for this project.', true);
      else if (fileExists(path.join(root, 'compile_flags.txt')) || fileExists(path.join(root, '.clangd')))
        context.evidence.push('clangd project flags are configured; the server interprets them.');
      else issue('compilation-unknown', 'Choose a build folder or configure this project to resolve include paths, defines and the C++ standard.', true);
      for (const name of ['.clangd', 'compile_flags.txt', 'CMakeLists.txt', 'meson.build']) inputs.add(path.join(root, name));
      if (fileExists(path.join(root, 'CMakeLists.txt'))) context.preparation = 'cmake';
      else if (fileExists(path.join(root, 'meson.build'))) context.preparation = 'meson';
    } else if (definition.id === 'rust-analyzer' || definition.id === 'gopls') {
      const names = definition.id === 'rust-analyzer' ? ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain', '.cargo/config.toml'] : ['go.work', 'go.mod', 'go.sum'];
      for (const name of names) { const file = path.join(root, name); inputs.add(file); if (fileExists(file)) context.evidence.push(`Toolchain configuration: ${file}`); }
      context.evidence.push('The language server resolves the project toolchain and dependencies. Connection alone does not mean analysis has completed.');
    }
    context.id = digest([root, definition.id, context.selected, context.issues, options, preferences]);
    return { context, profile, args, inputs: [...inputs], configuration };
  }
  launch(plan: AnalysisPlan, launch: ServerLaunch, definition: LanguageServerDefinition): ServerLaunch {
    // Bundled Node's entry point was already prefixed by ServerRegistry.
    return { ...launch, args: definition.launch.kind === 'bundledNode' ? [launch.args[0], ...plan.args] : plan.args };
  }
}
