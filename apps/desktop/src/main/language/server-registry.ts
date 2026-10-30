import { constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLanguageDefinition, type LanguageServerDefinition } from '../../core/document/language-definition';
import { builtinLanguageServers } from './catalog/profiles';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import type { ServerLaunch } from './server-session';

export type Options = { role?: 'primary' | 'supplementary'; formatting?: boolean; enabled?: boolean; executable?: string; automaticExecutable?: boolean; args?: string[]; settings?: Record<string, unknown>; initializationOptions?: Record<string, unknown>; root?: string };
type Settings = { version: 1; servers: Record<string, Options>; custom: LanguageServerDefinition[]; preferred: Record<string, string>; projectPreferred?: Record<string, Record<string, string>>; projects?: Record<string, Record<string, Options>> };
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
    for (const [root, servers] of Object.entries(this.data.projects ?? {})) {
      if (!path.isAbsolute(root) || !record(servers)) throw Error('Invalid project language settings.');
      for (const [id, options] of Object.entries(servers)) { this.definition(id); this.validateOptions(options); }
    }
    for (const [root, preferred] of Object.entries(this.data.projectPreferred ?? {})) {
      if (!path.isAbsolute(root) || !record(preferred) || Object.entries(preferred).some(([language, id]) => !/^[\w.+-]+$/.test(language) || !ids.includes(id))) throw Error('Invalid project preferred server.');
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
  options(id: string, resource?: string): Options {
    const global = Object.hasOwn(this.data.servers, id) ? this.data.servers[id] : {};
    if (!resource) return global;
    const roots = Object.keys(this.data.projects ?? {}).filter(root => {
      const relative = path.relative(root, resource); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    }).sort((a, b) => a.length - b.length);
    return roots.reduce((options, root) => ({ ...options, ...this.data.projects![root][id] }), global);
  }
  role(id: string, resource?: string): 'primary' | 'supplementary' { return this.options(id, resource).role ?? this.definition(id).role ?? 'primary'; }
  associations(resource?: string): LanguageRoute[] {
    return this.definitions().flatMap(d => d.languages.map(language => ({ ...language, server: d.id, enabled: this.enabled(d.id, resource), role: this.role(d.id, resource), formatting: this.options(d.id, resource).formatting,
      scopes: Object.entries(this.data.projects ?? {}).filter(([, servers]) => !!servers[d.id]).map(([root, servers]) => ({ root, role: servers[d.id].role, formatting: servers[d.id].formatting, enabled: servers[d.id].enabled })) })));
  }
  preferred(languageId: string, resource?: string): string | undefined {
    const root = resource && Object.keys(this.data.projectPreferred ?? {}).filter(root => { const relative = path.relative(root, resource); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }).sort((a, b) => b.length - a.length).find(root => this.data.projectPreferred![root][languageId]);
    const id = (root && this.data.projectPreferred![root][languageId]) || this.data.preferred[languageId];
    return id && this.enabled(id, resource) && this.role(id, resource) === 'primary' ? id : this.definitions().find(d => this.role(d.id, resource) === 'primary' && this.options(d.id, resource).enabled === true
      && d.languages.some(l => l.languageId === languageId))?.id;
  }
  enabled(id: string, resource?: string): boolean { return this.options(id, resource).enabled ?? this.definition(id).enabledByDefault ?? false; }
  routes(resource?: string): LanguageRoute[] {
    const definitions = this.definitions().filter(item => this.enabled(item.id, resource));
    const result: LanguageRoute[] = [];
    for (const id of new Set(definitions.flatMap(item => item.languages.map(l => l.languageId)))) {
      const candidates = definitions.filter(item => item.languages.some(l => l.languageId === id));
      candidates.sort((a, b) => Number(b.id === this.preferred(id, resource)) - Number(a.id === this.preferred(id, resource))
        || Number(this.options(b.id, resource).enabled === true) - Number(this.options(a.id, resource).enabled === true));
      for (const candidate of candidates) for (const language of candidate.languages.filter(l => l.languageId === id))
        result.push({ ...language, server: candidate.id, role: this.role(candidate.id, resource), formatting: this.options(candidate.id, resource).formatting });
    }
    return result;
  }
  candidates(file: string, server?: string, languageId?: string): { server: string; languageId: string }[] {
    const routes = this.routes(file).filter(route => server ? route.server === server : route.role !== 'supplementary');
    const support = languageId ? routes.find(route => route.languageId === languageId) : languageSupport(file, routes);
    if (!support) return [];
    const matches = routes.filter(route => route.languageId === support.languageId && (languageId || languageSupport(file, [route])));
    const preferred = matches.find(route => route.server === this.preferred(support.languageId, file))
      ?? matches.find(route => this.options(route.server, file).enabled === true);
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
      || (options.root !== undefined && (typeof options.root !== 'string' || options.root.length > 4096 || options.root.includes('\0') || !path.isAbsolute(options.root)))
      || (options.executable !== undefined && (typeof options.executable !== 'string' || !path.isAbsolute(options.executable))))
      throw Error('Invalid language server options.');
    if (options.role !== undefined && !['primary', 'supplementary'].includes(options.role)) throw Error('Invalid provider role.');
    if (options.formatting !== undefined && typeof options.formatting !== 'boolean') throw Error('Invalid formatting preference.');
    validateLanguageDefinition({ id: 'options', name: 'Options', launch: { kind: 'native', command: 'server', args: options.args ?? [] },
      languages: [{ languageId: 'text', extensions: ['.txt'] }], settings: options.settings, initializationOptions: options.initializationOptions });
  }
  configure(id: string, options: Pick<Options, 'args' | 'settings' | 'initializationOptions' | 'root' | 'role' | 'formatting'>, scope?: string): void {
    this.definition(id); this.validateOptions(options);
    if (scope && (!path.isAbsolute(scope) || scope.includes('\0'))) throw Error('Project scope must be an absolute path.');
    const target = scope ? ((this.data.projects ??= {})[scope] ??= {}) : this.data.servers;
    // Omitted project fields inherit exactly as they will after a settings reload.
    // Keeping own undefined keys here would mask the global value until restart.
    target[id] = Object.fromEntries(Object.entries({ ...(target[id] ?? {}), args: options.args,
      settings: options.settings, initializationOptions: options.initializationOptions, root: options.root,
      role: options.role, formatting: options.formatting }).filter(([, value]) => value !== undefined));
    // Exactly one explicitly selected external formatter per overlapping language.
    if (options.formatting) for (const other of this.definitions()) {
      if (other.id !== id && other.languages.some(a => this.definition(id).languages.some(b => a.languageId === b.languageId)))
        target[other.id] = { ...(target[other.id] ?? {}), formatting: false };
    }
    this.save();
  }
  setEnabled(id: string, enabled: boolean, scope?: string): void {
    const definition = this.definition(id);
    if (typeof enabled !== 'boolean') throw Error('Invalid enabled state.');
    if (scope && (!path.isAbsolute(scope) || scope.includes('\0'))) throw Error('Invalid project scope.');
    const target = scope ? ((this.data.projects ??= {})[scope] ??= {}) : this.data.servers;
    target[id] = { ...target[id], enabled };
    const preferred = scope ? ((this.data.projectPreferred ??= {})[scope] ??= {}) : this.data.preferred;
    if (enabled && this.role(id, scope) === 'primary') for (const language of definition.languages) preferred[language.languageId] = id;
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
    for (const servers of Object.values(this.data.projects ?? {})) delete servers[id];
    for (const preferred of [this.data.preferred, ...Object.values(this.data.projectPreferred ?? {})]) for (const [language, selected] of Object.entries(preferred)) if (selected === id) delete preferred[language];
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
  launch(id: string, packaged: boolean, environment: NodeJS.ProcessEnv = process.env, resolvedExecutable?: string, resource?: string): ServerLaunch {
    const definition = this.definition(id), options = this.options(id, resource);
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
  fingerprint(id: string, resource?: string): string {
    return createHash('sha256').update(JSON.stringify([this.definition(id), this.options(id, resource), this.executable(id), resource ? this.definition(id).languages.map(l => this.preferred(l.languageId, resource)) : [Object.entries(this.data.projects ?? {}).map(([root, servers]) => [root, servers[id]]), this.data.projectPreferred]])).digest('hex').slice(0, 16);
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
