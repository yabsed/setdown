import { constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLanguageDefinition, type LanguageServerDefinition } from '../../core/document/language-definition';
import { builtinLanguageServers } from './catalog/profiles';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import type { ServerLaunch } from './server-session';

type Options = { enabled?: boolean; executable?: string; automaticExecutable?: boolean; args?: string[]; settings?: Record<string, unknown>; initializationOptions?: Record<string, unknown> };
type Settings = { version: 1; servers: Record<string, Options>; custom: LanguageServerDefinition[]; preferred: Record<string, string> };
export class ServerRegistry {
  private data: Settings = { version: 1, servers: {}, custom: [], preferred: {} };
  private saved = JSON.stringify(this.data);
  readonly file: string;
  constructor(private readonly directory: string) {
    this.file = path.join(directory, 'language-servers.json');
    if (!existsSync(this.file)) return;
    if (statSync(this.file).size > 4 * 1024 * 1024) throw Error('Language settings are too large.');
    const saved = JSON.parse(readFileSync(this.file, 'utf8'));
    const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!saved || saved.version !== 1 || !record(saved.servers) || !Array.isArray(saved.custom) || saved.custom.length > 100 || !record(saved.preferred)) throw Error('Invalid language-servers.json');
    this.data = { ...saved, custom: saved.custom.map(validateLanguageDefinition) };
    const ids = this.definitions().map(item => item.id);
    if (new Set(ids).size !== ids.length) throw Error('Duplicate language server ID.');
    for (const [language, id] of Object.entries(this.data.preferred))
      if (!/^[\w.+-]+$/.test(language) || typeof id !== 'string' || !ids.includes(id)) throw Error('Invalid preferred server.');
    // Validate persisted overrides too; a malformed file must not silently reset settings.
    for (const [id, options] of Object.entries(this.data.servers)) {
      this.definition(id);
      this.validateOptions(options);
    }
    this.saved = JSON.stringify(this.data);
  }
  // Existing custom profiles shadow newly shipped defaults without losing their identity or settings.
  definitions(): LanguageServerDefinition[] { return [...builtinLanguageServers.filter(d => !this.isCustom(d.id)), ...this.data.custom]; }
  isCustom(id: string): boolean { return this.data.custom.some(d => d.id === id); }
  automatic(id: string): boolean { return !!this.definition(id).automatic && this.options(id).enabled === undefined; }
  canDetect(id: string): boolean {
    const launch = this.definition(id).launch;
    return launch.kind === 'native' && !path.isAbsolute(launch.command);
  }
  definition(id: string): LanguageServerDefinition {
    const definition = this.definitions().find(item => item.id === id);
    if (!definition) throw new Error('Unknown language server. Configure a connection first.');
    return definition;
  }
  options(id: string): Options { return Object.hasOwn(this.data.servers, id) ? this.data.servers[id] : {}; }
  preferred(languageId: string): string | undefined {
    const id = this.data.preferred[languageId];
    return id && this.enabled(id) ? id : this.definitions().find(d => this.options(d.id).enabled === true
      && d.languages.some(l => l.languageId === languageId))?.id;
  }
  enabled(id: string): boolean { return this.options(id).enabled ?? this.definition(id).enabledByDefault ?? false; }
  routes(): LanguageRoute[] {
    const definitions = this.definitions().filter(item => this.enabled(item.id));
    const result: LanguageRoute[] = [];
    for (const id of new Set(definitions.flatMap(item => item.languages.map(l => l.languageId)))) {
      const candidates = definitions.filter(item => item.languages.some(l => l.languageId === id));
      candidates.sort((a, b) => Number(b.id === this.data.preferred[id]) - Number(a.id === this.data.preferred[id])
        || Number(this.options(b.id).enabled === true) - Number(this.options(a.id).enabled === true));
      for (const candidate of candidates) for (const language of candidate.languages.filter(l => l.languageId === id))
        result.push({ ...language, server: candidate.id });
    }
    return result;
  }
  candidates(file: string): { server: string; languageId: string }[] {
    const routes = this.routes(), support = languageSupport(file, routes);
    if (!support) return [];
    const matches = routes.filter(route => route.languageId === support.languageId && languageSupport(file, [route]));
    const preferred = matches.find(route => route.server === this.data.preferred[support.languageId])
      ?? matches.find(route => this.options(route.server).enabled === true);
    // A user selection is authoritative, including a currently missing executable.
    const chosen = preferred ? [preferred] : matches;
    return [...new Map(chosen.map(({ server, languageId }) => [server, { server, languageId }])).values()];
  }
  private save(): void {
    const next = JSON.stringify(this.data, null, 2) + '\n';
    try {
      if (next.length > 4 * 1024 * 1024) throw Error('Language settings are too large.');
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(this.file + '.tmp', next);
      renameSync(this.file + '.tmp', this.file);
      this.saved = next;
    } catch (error) { this.data = JSON.parse(this.saved); throw error; }
  }
  private validateOptions(options: Options): void {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || (options.enabled !== undefined && typeof options.enabled !== 'boolean')
      || (options.automaticExecutable !== undefined && typeof options.automaticExecutable !== 'boolean')
      || (options.executable !== undefined && (typeof options.executable !== 'string' || !path.isAbsolute(options.executable))))
      throw Error('Invalid language server options.');
    validateLanguageDefinition({ id: 'options', name: 'Options', launch: { kind: 'native', command: 'server', args: options.args ?? [] },
      languages: [{ languageId: 'text', extensions: ['.txt'] }], settings: options.settings, initializationOptions: options.initializationOptions });
  }
  configure(id: string, options: Pick<Options, 'args' | 'settings' | 'initializationOptions'>): void {
    this.definition(id); this.validateOptions(options);
    this.data.servers[id] = { ...this.options(id), args: options.args, settings: options.settings, initializationOptions: options.initializationOptions };
    this.save();
  }
  setEnabled(id: string, enabled: boolean): void {
    const definition = this.definition(id);
    if (typeof enabled !== 'boolean') throw Error('Invalid enabled state.');
    this.data.servers[id] = { ...this.options(id), enabled };
    if (enabled) for (const language of definition.languages) this.data.preferred[language.languageId] = id;
    this.save();
  }
  add(value: unknown): string {
    const definition = validateLanguageDefinition(value);
    if (!this.isCustom(definition.id) && builtinLanguageServers.some(item => item.id === definition.id)) throw Error('Use connection settings to customize a built-in profile.');
    if (this.data.custom.length >= 100 && !this.data.custom.some(item => item.id === definition.id)) throw Error('Too many custom servers.');
    this.data.custom = [...this.data.custom.filter(item => item.id !== definition.id), definition];
    this.save(); return definition.id;
  }
  remove(id: string): void {
    if (!this.data.custom.some(item => item.id === id)) throw Error('Only custom connections can be removed.');
    this.data.custom = this.data.custom.filter(item => item.id !== id);
    delete this.data.servers[id];
    for (const [language, selected] of Object.entries(this.data.preferred)) if (selected === id) delete this.data.preferred[language];
    this.save();
  }
  executable(id: string, environment: NodeJS.ProcessEnv = process.env): string {
    const definition = this.definition(id), launch = definition.launch;
    const selected = this.options(id).executable;
    if (selected) return selected;
    if (launch.kind === 'bundledNode') return process.execPath;
    if (this.options(id).automaticExecutable) return launch.command;
    if (launch.legacySettingsFile) {
      try {
        const legacy = JSON.parse(readFileSync(path.join(this.directory, launch.legacySettingsFile), 'utf8')).executable;
        if (typeof legacy === 'string' && path.isAbsolute(legacy)) return legacy;
      } catch { /* No earlier executable selection. */ }
    }
    return (launch.environmentVariable && environment[launch.environmentVariable]) || launch.command;
  }
  async chooseExecutable(id: string, executable: string, discoveredScript = false): Promise<void> {
    this.definition(id);
    if (!path.isAbsolute(executable) || !(discoveredScript ? (await stat(executable)).isFile() : await findExecutable(executable))) throw Error('Select an executable file.');
    if (this.definition(id).launch.kind === 'bundledNode') throw Error('This server uses the bundled runtime.');
    this.data.servers[id] = { ...this.options(id), executable, automaticExecutable: false }; this.save();
  }
  useAutomatic(id: string): void {
    if (!this.canDetect(id)) throw Error('This connection has no automatic executable profile.');
    this.data.servers[id] = { ...this.options(id), executable: undefined, automaticExecutable: true }; this.save();
  }
  launch(id: string, packaged: boolean, environment: NodeJS.ProcessEnv = process.env, resolvedExecutable?: string): ServerLaunch {
    const definition = this.definition(id), options = this.options(id);
    const { NODE_OPTIONS: _node, NODE_PATH: _path, ELECTRON_RUN_AS_NODE: _electron, ...env } = environment;
    const args = options.args ?? definition.launch.args;
    if (definition.launch.kind === 'native') {
      const executable = resolvedExecutable ?? this.executable(id, environment);
      if (/\.(cmd|bat)$/i.test(executable)) throw Error('Choose the runtime executable and put the server script in Arguments; shell launchers are not supported.');
      return { executable, args, env };
    }
    const entry = require.resolve(definition.launch.module);
    return { executable: process.execPath, args: [packaged ? entry.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2') : entry, ...args],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  }
  fingerprint(id: string): string {
    return createHash('sha256').update(JSON.stringify([this.definition(id), this.options(id), this.executable(id)])).digest('hex').slice(0, 16);
  }
}

/** Presence check only: browsing the catalog never runs an executable. */
export async function findExecutable(command: string): Promise<string | null> {
  const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    .flatMap(directory => process.platform === 'win32' && !path.extname(command)
      ? ['.exe', '.com'].map(ext => path.join(directory, command + ext)) : [path.join(directory, command)]);
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
