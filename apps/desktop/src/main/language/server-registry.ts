import { constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLanguageDefinition, type LanguageServerDefinition } from '../../core/document/language-definition';
import { builtinLanguageServers } from './catalog/profiles';
import { mergeLanguageSettings } from './language-settings';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import type { ServerLaunch } from './server-session';
import { languageDefinition } from '../../core/document/language-catalog';
import type { AnalysisPolicy } from '../../core/document/analysis-context';

export type Options = { automaticInstall?: boolean; role?: 'primary' | 'supplementary'; formatting?: boolean; enabled?: boolean; executable?: string; automaticExecutable?: boolean; args?: string[]; settings?: Record<string, unknown>; initializationOptions?: Record<string, unknown>; root?: string };
type Settings = { version: 1; servers: Record<string, Options>; custom: LanguageServerDefinition[]; preferred: Record<string, string>; projectPreferred?: Record<string, Record<string, string>>; projects?: Record<string, Record<string, Options>>;
  automaticInstall?: boolean; languageDefaults?: Record<string, string>; projectDefaults?: Record<string, Record<string, string>> };
const noPackageDefinitions: readonly LanguageServerDefinition[] = [];
export class ServerRegistry {
  private data: Settings = { version: 1, servers: {}, custom: [], preferred: {} };
  private saved = JSON.stringify(this.data);
  private indexedCustom?: LanguageServerDefinition[];
  private indexedPackages?: readonly LanguageServerDefinition[];
  private indexedDefinitions: LanguageServerDefinition[] = [];
  private readonly definitionsById = new Map<string, LanguageServerDefinition>();
  private readonly customIds = new Set<string>();
  private readonly policyLanguages = new Map<string, string>();
  private readonly policyCache = new Map<string, AnalysisPolicy>();
  readonly file: string;
  constructor(private readonly directory: string, private readonly packageDefinitions: () => readonly LanguageServerDefinition[] = () => noPackageDefinitions,
    private readonly inheritedOptions?: (definition: LanguageServerDefinition, resource?: string) => Pick<Options, 'settings' | 'initializationOptions'>,
    private readonly declaredServers: (language: string) => readonly string[] = language => languageDefinition(language)?.servers ?? []) {
    this.file = path.join(directory, 'language-servers.json');
    if (!existsSync(this.file)) return;
    if (statSync(this.file).size > 4 * 1024 * 1024) throw Error('Language settings are too large.');
    const saved = JSON.parse(readFileSync(this.file, 'utf8'));
    const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!saved || saved.version !== 1 || !record(saved.servers) || !Array.isArray(saved.custom) || saved.custom.length > 100 || !record(saved.preferred)) throw Error('Invalid language-servers.json');
    this.data = { ...saved, custom: saved.custom.map(validateLanguageDefinition) };
    for (const field of ['projects', 'projectPreferred', 'languageDefaults', 'projectDefaults'] as const)
      if (this.data[field] !== undefined && !record(this.data[field])) throw Error('Invalid language settings map.');
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
    if (this.data.automaticInstall !== undefined && typeof this.data.automaticInstall !== 'boolean') throw Error('Invalid automatic installation setting.');
    for (const choices of [this.data.languageDefaults ?? {}, ...Object.values(this.data.projectDefaults ?? {})]) {
      if (!record(choices)) throw Error('Invalid language defaults.');
      for (const [language, value] of Object.entries(choices)) this.validateSelection(language, value);
    }
    for (const root of Object.keys(this.data.projectDefaults ?? {})) this.validateScope(root);
    this.saved = JSON.stringify(this.data);
  }
  // Existing custom profiles shadow newly shipped defaults without losing their identity or settings.
  definitions(): LanguageServerDefinition[] {
    const packages = this.packageDefinitions();
    if (this.indexedCustom !== this.data.custom || this.indexedPackages !== packages) {
      this.policyCache.clear();
      this.indexedPackages = packages;
      this.indexedCustom = this.data.custom; this.customIds.clear(); this.definitionsById.clear(); this.policyLanguages.clear();
      for (const definition of this.data.custom) this.customIds.add(definition.id);
      const imported = new Map([...builtinLanguageServers,...packages].map(definition=>[definition.id,definition]));
      this.indexedDefinitions = [...imported.values()].filter(d => !this.customIds.has(d.id)).concat(this.data.custom);
      for (const definition of this.indexedDefinitions) {
        this.definitionsById.set(definition.id, definition);
        for (const language of definition.languages) if (language.monacoId) this.policyLanguages.set(language.languageId, language.monacoId);
      }
    }
    return this.indexedDefinitions;
  }
  isCustom(id: string): boolean { this.definitions(); return this.customIds.has(id); }
  automatic(id: string): boolean { return !!this.definition(id).automatic && this.options(id).enabled === undefined; }
  canDetect(id: string): boolean {
    const launch = this.definition(id).launch;
    return launch.kind === 'native' && !path.isAbsolute(launch.command);
  }
  definition(id: string): LanguageServerDefinition {
    this.definitions(); const definition = this.definitionsById.get(id);
    if (!definition) throw new Error('Unknown language server. Configure a connection first.');
    return definition;
  }
  options(id: string, resource?: string): Options {
    const stored = this.storedOptions(id, resource);
    if (!this.inheritedOptions) return stored;
    const definition = this.definition(id), inherited = this.inheritedOptions(definition, resource);
    return { ...inherited, ...stored,
      ...(inherited.settings ? { settings: mergeLanguageSettings(definition.settings, inherited.settings, stored.settings) } : {}),
      ...(inherited.initializationOptions ? { initializationOptions: mergeLanguageSettings(definition.initializationOptions, inherited.initializationOptions, stored.initializationOptions) } : {}) };
  }
  private storedOptions(id: string, resource?: string): Options {
    const global = Object.hasOwn(this.data.servers, id) ? this.data.servers[id] : {};
    if (!resource) return global;
    const roots = Object.keys(this.data.projects ?? {}).filter(root => {
      const relative = path.relative(root, resource); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    }).sort((a, b) => a.length - b.length);
    return roots.reduce((options, root) => ({ ...options, ...this.data.projects![root][id] }), global);
  }
  role(id: string, resource?: string): 'primary' | 'supplementary' { return this.options(id, resource).role ?? this.definition(id).role ?? 'primary'; }
  automaticInstall(id?: string, resource?: string): boolean { return (id ? this.options(id, resource).automaticInstall : undefined) ?? this.data.automaticInstall ?? true; }
  setAutomaticInstall(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw Error('Invalid automatic installation setting.');
    this.data.automaticInstall = enabled; this.save();
  }
  private validateScope(scope: string): void {
    if (!path.isAbsolute(scope) || scope.includes('\0')) throw Error('Project scope must be an absolute path.');
  }
  private validateSelection(language: string, value: string): void {
    if (typeof language !== 'string' || !/^[\w.+-]{1,80}$/.test(language) || ['__proto__', 'constructor', 'prototype'].includes(language)
      || typeof value !== 'string') throw Error('Invalid language selection.');
    if (!['automatic', 'off'].includes(value)) {
      const definition = this.definition(value);
      if (!definition.languages.some(l => l.languageId === language || l.monacoId === language)) throw Error('This tool does not support the language.');
    }
  }
  selectAnalysis(language: string, value: string, scope?: string): void {
    language = this.policyLanguage(language);
    this.validateSelection(language, value);
    if (scope) this.validateScope(scope);
    if (!['automatic', 'off'].includes(value) && this.role(value, scope) !== 'primary') throw Error('Choose a primary analysis tool.');
    const target = scope ? ((this.data.projectDefaults ??= {})[scope] ??= {}) : (this.data.languageDefaults ??= {});
    // An explicit automatic marker restores inheritance without deleting legacy
    // per-server options that may still be used by another language.
    target[language] = value; this.save();
  }
  private projectScopes(resource?: string): string[] {
    if (!resource) return [];
    return [...new Set([...Object.keys(this.data.projects ?? {}), ...Object.keys(this.data.projectPreferred ?? {}), ...Object.keys(this.data.projectDefaults ?? {})])]
      .filter(root => { const relative = path.relative(root, resource); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); })
      .sort((a, b) => b.length - a.length);
  }
  private legacySelection(language: string, scope?: string): AnalysisPolicy | undefined {
    const options = scope ? this.data.projects?.[scope] ?? {} : this.data.servers;
    const preferred = scope ? this.data.projectPreferred?.[scope]?.[language] : this.data.preferred[language];
    if (!preferred && !Object.values(options).some(option => option.enabled !== undefined)) return;
    const definitions = this.definitions().filter(d => d.languages.some(l => l.languageId === language) && this.role(d.id, scope) === 'primary');
    const selected = definitions.find(d => d.id === preferred && this.enabled(d.id, scope))
      ?? definitions.find(d => options[d.id]?.enabled === true);
    const source = scope ? 'project' : 'global';
    if (selected) return { mode: 'server', source, server: selected.id };
    if (definitions.length && definitions.every(d => options[d.id]?.enabled === false)) return { mode: 'off', source };
  }
  analysisSelection(language: string, resource?: string): AnalysisPolicy {
    this.definitions();
    const key = JSON.stringify([language, resource]);
    const cached = this.policyCache.get(key); if (cached) return cached;
    const result = this.resolveSelection(language, resource);
    this.policyCache.set(key, result); return result;
  }
  private policyLanguage(language: string): string {
    this.definitions();
    // JSX/TSX and other protocol dialects share one language control in Monaco.
    // A disabled editor language must not reconnect through an enabled alias.
    return this.policyLanguages.get(language) ?? language;
  }
  private resolveSelection(language: string, resource?: string): AnalysisPolicy {
    const key = this.policyLanguage(language);
    for (const root of this.projectScopes(resource)) {
      const value = this.data.projectDefaults?.[root]?.[key] ?? this.data.projectDefaults?.[root]?.[language];
      if (value === 'automatic') break;
      if (value) return { mode: value === 'off' ? 'off' : 'server', source: 'project', ...(value === 'off' ? {} : { server: value }) };
      const legacy = this.legacySelection(language, root); if (legacy) return legacy;
    }
    const value = this.data.languageDefaults?.[key] ?? this.data.languageDefaults?.[language];
    if (value && value !== 'automatic') return { mode: value === 'off' ? 'off' : 'server', source: 'global', ...(value === 'off' ? {} : { server: value }) };
    return (value !== 'automatic' ? this.legacySelection(language) : undefined) ?? { mode: 'automatic', source: 'default' };
  }
  enabledFor(id: string, language: string, resource?: string): boolean {
    const policy = this.analysisSelection(language, resource);
    const key = this.policyLanguage(language);
    if (policy.mode === 'off') return false;
    const primary = this.role(id, resource) === 'primary';
    if (policy.mode === 'server' && primary) return policy.server === id;
    let enabled = primary && this.data.languageDefaults?.[key] === 'automatic' ? undefined : this.data.servers[id]?.enabled;
    const global = enabled;
    for (const root of this.projectScopes(resource).reverse()) {
      if (primary && this.data.projectDefaults?.[root]?.[key] === 'automatic') enabled = global;
      else enabled = this.data.projects?.[root]?.[id]?.enabled ?? enabled;
    }
    return enabled ?? this.definition(id).enabledByDefault ?? false;
  }
  defaultServer(language: string, resource?: string): string | undefined {
    const policy = this.analysisSelection(language, resource);
    if (policy.mode !== 'automatic') return policy.server;
    const definitions = this.definitions().filter(d => d.languages.some(l => l.languageId === language || l.monacoId === language)
      && this.role(d.id, resource) === 'primary' && this.enabledFor(d.id, language, resource));
    const order = this.declaredServers(this.policyLanguage(language));
    const rank = (d: LanguageServerDefinition) => {
      const index = order.findIndex(id => id === d.id || id === d.provenance?.profile || d.launch.kind === 'native' && id === d.launch.command);
      return index < 0 ? order.length : index;
    };
    const declared = definitions.filter(d => d.launch.kind === 'bundledNode' || rank(d) < order.length);
    return declared.sort((a, b) => Number(b.launch.kind === 'bundledNode') - Number(a.launch.kind === 'bundledNode') || rank(a) - rank(b))[0]?.id
      ?? (definitions.length === 1 ? definitions[0].id : undefined);
  }
  associations(resource?: string): LanguageRoute[] {
    const roots = [...new Set([...Object.keys(this.data.projects ?? {}), ...Object.keys(this.data.projectDefaults ?? {}), ...Object.keys(this.data.projectPreferred ?? {})])];
    return this.definitions().flatMap(d => d.languages.map(language => ({ ...language, server: d.id, enabled: this.enabledFor(d.id, language.languageId, resource), role: this.role(d.id, resource), formatting: this.options(d.id, resource).formatting,
      scopes: roots.map(root => ({ root, role: this.role(d.id, root), formatting: this.options(d.id, root).formatting, enabled: this.enabledFor(d.id, language.languageId, root) })) })));
  }
  preferred(languageId: string, resource?: string): string | undefined {
    const root = resource && Object.keys(this.data.projectPreferred ?? {}).filter(root => { const relative = path.relative(root, resource); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }).sort((a, b) => b.length - a.length).find(root => this.data.projectPreferred![root][languageId]);
    const id = (root && this.data.projectPreferred![root][languageId]) || this.data.preferred[languageId];
    if (id && this.enabled(id, resource) && this.role(id, resource) === 'primary') return id;
    const overridden = new Set([...Object.keys(this.data.servers), ...Object.values(this.data.projects ?? {}).flatMap(servers => Object.keys(servers))]);
    return this.definitions().find(d => overridden.has(d.id) && this.options(d.id,resource).enabled === true && this.role(d.id,resource) === 'primary'
      && d.languages.some(l => l.languageId === languageId))?.id;
  }
  enabled(id: string, resource?: string): boolean { return this.options(id, resource).enabled ?? this.definition(id).enabledByDefault ?? false; }
  routes(resource?: string): LanguageRoute[] {
    const definitions = this.definitions();
    const result: LanguageRoute[] = [];
    const groups = new Map<string, LanguageServerDefinition[]>();
    for (const definition of definitions) for (const id of new Set(definition.languages.map(l=>l.languageId))) {
      if (!this.enabledFor(definition.id, id, resource)) continue;
      const candidates=groups.get(id)??[]; candidates.push(definition); groups.set(id,candidates);
    }
    for (const [id,candidates] of groups) {
      const preferred = this.preferred(id,resource);
      candidates.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)
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
    const defaultId = this.defaultServer(support.languageId, file);
    const chosen = server || !defaultId && !preferred ? matches : matches.filter(route => route.server === (defaultId ?? preferred?.server));
    return [...new Map(chosen.map(({ server, languageId }) => [server, { server, languageId }])).values()];
  }
  private save(): void {
    this.policyCache.clear();
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
      || (options.automaticInstall !== undefined && typeof options.automaticInstall !== 'boolean')
      || (options.root !== undefined && (typeof options.root !== 'string' || options.root.length > 4096 || options.root.includes('\0') || !path.isAbsolute(options.root)))
      || (options.executable !== undefined && (typeof options.executable !== 'string' || !path.isAbsolute(options.executable))))
      throw Error('Invalid language server options.');
    if (options.role !== undefined && !['primary', 'supplementary'].includes(options.role)) throw Error('Invalid provider role.');
    if (options.formatting !== undefined && typeof options.formatting !== 'boolean') throw Error('Invalid formatting preference.');
    validateLanguageDefinition({ id: 'options', name: 'Options', launch: { kind: 'native', command: 'server', args: options.args ?? [] },
      languages: [{ languageId: 'text', extensions: ['.txt'] }], settings: options.settings, initializationOptions: options.initializationOptions });
  }
  configure(id: string, options: Pick<Options, 'args' | 'settings' | 'initializationOptions' | 'root' | 'role' | 'formatting' | 'automaticInstall'>, scope?: string): void {
    this.definition(id); this.validateOptions(options);
    if (scope && (!path.isAbsolute(scope) || scope.includes('\0'))) throw Error('Project scope must be an absolute path.');
    const target = scope ? ((this.data.projects ??= {})[scope] ??= {}) : this.data.servers;
    // Omitted project fields inherit exactly as they will after a settings reload.
    // Keeping own undefined keys here would mask the global value until restart.
    target[id] = Object.fromEntries(Object.entries({ ...(target[id] ?? {}), args: options.args,
      settings: options.settings, initializationOptions: options.initializationOptions, root: options.root,
      role: options.role, formatting: options.formatting, automaticInstall:options.automaticInstall }).filter(([, value]) => value !== undefined));
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
    const defaults = scope ? this.data.projectDefaults?.[scope] : this.data.languageDefaults;
    if (this.role(id, scope) === 'primary') for (const language of definition.languages) {
      if (enabled) preferred[language.languageId] = id;
      const key = this.policyLanguage(language.languageId);
      if (defaults && (enabled || defaults[key] === id)) delete defaults[key];
    }
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
    for (const defaults of [this.data.languageDefaults ?? {}, ...Object.values(this.data.projectDefaults ?? {})]) for (const [language, selected] of Object.entries(defaults)) if (selected === id) defaults[language] = 'automatic';
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
    this.data.servers[id] = { ...this.storedOptions(id), executable, automaticExecutable: false }; this.save();
  }
  useAutomatic(id: string): void {
    if (!this.canDetect(id)) throw Error('This connection has no automatic executable profile.');
    this.data.servers[id] = { ...this.storedOptions(id), executable: undefined, automaticExecutable: true }; this.save();
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
    return createHash('sha256').update(JSON.stringify([this.definition(id), this.options(id, resource), this.executable(id), this.automaticInstall(id, resource), resource ? this.definition(id).languages.map(l => [this.analysisSelection(l.languageId, resource), this.enabledFor(id, l.languageId, resource)]) : [this.data.languageDefaults, this.data.projectDefaults, Object.entries(this.data.projects ?? {}).map(([root, servers]) => [root, servers[id]]), this.data.projectPreferred, this.data.preferred]])).digest('hex').slice(0, 16);
  }
  sessionFingerprint(id: string, resource: string): string {
    const { automaticInstall: _policy, ...options } = this.options(id, resource);
    return JSON.stringify([this.definition(id), options, this.executable(id), this.definition(id).languages.map(l =>
      [l.languageId, this.enabledFor(id, l.languageId, resource), this.role(id, resource) === 'primary' ? this.defaultServer(l.languageId, resource) : undefined])]);
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
