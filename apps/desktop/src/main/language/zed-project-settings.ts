import { readFileSync, statSync, watchFile, unwatchFile } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { mergeLanguageSettings } from './language-settings';

type Json = Record<string, unknown>;
type LspOptions = { settings?: Json; initializationOptions?: Json };
const object = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

/** Zed JSONC settings are inherited from the user and enclosing folders, including newly created files. */
export class ZedProjectSettings {
  private readonly files = new Map<string, Json>();
  private readonly resources = new Map<string, Json>();
  private readonly resolved = new Map<string, LspOptions>();
  private readonly watchers = new Map<string, () => void>();
  private readonly globals: string[];
  constructor(options: { home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; changed?: (servers: string[]) => void } = {}) {
    const home = options.home ?? os.homedir(), env = options.env ?? process.env;
    const config = (options.platform ?? process.platform) === 'win32'
      ? path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Zed')
      : path.join(env.FLATPAK_XDG_CONFIG_HOME ?? env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'zed');
    this.globals = [path.join(config, 'settings.json'), path.join(home, '.zed', 'settings.json')];
    this.changed = options.changed;
  }
  private readonly changed?: (servers: string[]) => void;
  private load(file: string, previous: Json = {}): Json {
    try {
      if (statSync(file).size > 1024 * 1024) throw Error('Settings exceed 1 MiB');
      const errors: ParseError[] = [], value = parse(readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
      if (errors.length || !object(value)) throw Error('Invalid JSONC');
      return object(value.lsp) ? mergeLanguageSettings(value.lsp) : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      console.warn(`Could not read Zed language settings at ${file}; keeping the last valid settings.`, String(error));
      return previous;
    }
  }
  private read(file: string): Json {
    if (!this.files.has(file)) {
      this.files.set(file, this.load(file));
      if (this.changed) {
        const update = () => {
          const previous = this.files.get(file)!, next = this.load(file, previous);
          if (JSON.stringify(previous) === JSON.stringify(next)) return;
          this.files.set(file, next); this.resources.clear(); this.resolved.clear();
          this.changed?.([...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key])));
        };
        watchFile(file, { persistent: false, interval: 750 }, update); this.watchers.set(file, update);
      }
    }
    return this.files.get(file)!;
  }
  private configuration(resource?: string): Json {
    const directory = resource ? path.dirname(resource) : '';
    let result = this.resources.get(directory);
    if (!result) {
      const ancestors: string[] = [];
      if (directory) for (let current = directory;; current = path.dirname(current)) {
        ancestors.unshift(path.join(current, '.zed', 'settings.json'));
        if (path.dirname(current) === current) break;
      }
      result = mergeLanguageSettings(...[...new Set([...this.globals, ...ancestors])].map(file => this.read(file)));
      this.resources.set(directory, result);
    }
    return result;
  }
  options(definition: LanguageServerDefinition, resource?: string, adapter?: string): LspOptions {
    const key = JSON.stringify([definition.id, resource && path.dirname(resource), adapter]);
    const cached = this.resolved.get(key); if (cached) return cached;
    const lsp = this.configuration(resource);
    const names = [...new Set([definition.id, definition.provenance?.profile,
      definition.launch.kind === 'native' ? definition.launch.command : undefined, adapter].filter((name): name is string => !!name))];
    const entry = mergeLanguageSettings(...names.map(name => object(lsp[name]) ? lsp[name] as Json : undefined));
    const result = { ...(object(entry.settings) ? { settings: entry.settings } : {}),
      ...(object(entry.initialization_options) ? { initializationOptions: entry.initialization_options } : {}) };
    this.resolved.set(key, result); return result;
  }
  dispose(): void {
    for (const [file, callback] of this.watchers) unwatchFile(file, callback);
    this.watchers.clear(); this.files.clear(); this.resources.clear(); this.resolved.clear();
  }
}
