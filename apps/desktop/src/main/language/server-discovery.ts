import { access, stat, readdir, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { capture, ServerEnvironment, type EnvironmentSnapshot } from './server-environment';
import type { LanguageServerCandidate } from '../../protocol/language';

export type DiscoveredCandidate = LanguageServerCandidate & { runtime?: string };
export type Discovery = { candidates: DiscoveredCandidate[]; selected?: DiscoveredCandidate;
  environment: EnvironmentSnapshot; searched: string[] };
type FindOptions = { resolveEnvironment?: boolean; python?: boolean; npmPackage?: string };
export async function executableFile(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile() && await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(() => true); }
  catch { return false; }
}
export function searchDirectories(env: NodeJS.ProcessEnv): { path: string; source: 'path' | 'user' }[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const paths = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(p => path.isAbsolute(p));
  const user = [env.PIPX_BIN_DIR, env.UV_TOOL_BIN_DIR, env.XDG_BIN_HOME, path.join(home, '.local', 'bin'),
    ...(process.platform === 'win32' ? [env.APPDATA && path.join(env.APPDATA, 'npm')]
      : [env.npm_config_prefix && path.join(env.npm_config_prefix, 'bin'), env.NPM_CONFIG_PREFIX && path.join(env.NPM_CONFIG_PREFIX, 'bin')]),
    path.join(env.CARGO_HOME || path.join(home, '.cargo'), 'bin'),
    env.GOBIN || path.join((env.GOPATH || path.join(home, 'go')).split(path.delimiter)[0], 'bin'),
    ...(env.VIRTUAL_ENV ? [path.join(env.VIRTUAL_ENV, bin)] : []),
    ...(env.CONDA_PREFIX ? [path.join(env.CONDA_PREFIX, process.platform === 'win32' ? 'Scripts' : 'bin')] : [])];
  const seen = new Set<string>();
  return [...paths.map(p => ({ path: p, source: 'path' as const })),
    ...user.filter((p): p is string => !!p && path.isAbsolute(p)).map(p => ({ path: p, source: 'user' as const }))]
    .filter(item => { const key = process.platform === 'win32' ? item.path.toLowerCase() : item.path; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Discovery never executes a candidate server. Only a document's ServerSession does that. */
export class ServerDiscovery {
  private readonly cache = new Map<string, { expires: number; value: Promise<Discovery> }>();
  private pythonPaths?: Promise<string[]>;
  private npmPaths?: Promise<string[]>;
  private controller = new AbortController();
  private revision = 0;
  private readonly directories = new Map<string, { expires: number; files: Promise<Set<string>> }>();
  private readonly packages = new Map<string, Promise<Record<string, unknown> | null>>();
  constructor(readonly environment = new ServerEnvironment(), private readonly query = capture) {}
  get generation(): number { return this.revision; }
  reset(): void { this.revision++; this.controller.abort(); this.controller = new AbortController(); this.cache.clear(); this.directories.clear(); this.packages.clear(); this.pythonPaths = undefined; this.npmPaths = undefined; this.environment.reset(); }
  dispose(): void { this.controller.abort(); this.environment.dispose(); this.cache.clear(); this.directories.clear(); this.packages.clear(); }
  private async listed(file: string): Promise<boolean> {
    const directory = path.dirname(file);
    let cached = this.directories.get(directory);
    if (!cached || cached.expires < Date.now()) {
      cached = { expires: Date.now() + 30_000, files: readdir(directory).then(names => new Set(names.map(n => process.platform === 'win32' ? n.toLowerCase() : n))).catch(() => new Set<string>()) };
      if (this.directories.size >= 512) this.directories.delete(this.directories.keys().next().value!);
      this.directories.set(directory, cached);
    }
    const name = path.basename(file);
    return (await cached.files).has(process.platform === 'win32' ? name.toLowerCase() : name);
  }
  async find(command: string, options: FindOptions = {}): Promise<Discovery> {
    const signal = this.controller.signal;
    const snapshot = options.resolveEnvironment ? await this.environment.resolve() : this.environment.peek();
    if (signal.aborted) throw new Error('Server discovery cancelled. Rescan installed servers.');
    const key = JSON.stringify([command, snapshot.env, !!options.python, options.npmPackage, !!options.resolveEnvironment]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.collect(command, snapshot, options, signal).then(result => {
      if (signal.aborted) throw new Error('Server discovery cancelled. Rescan installed servers.');
      if (options.resolveEnvironment)
        this.cache.delete(JSON.stringify([command, snapshot.env, !!options.python, options.npmPackage, false]));
      return result;
    });
    this.cache.set(key, { expires: Date.now() + 30_000, value });
    // A complete catalog scan fits; directory listings are shared across commands.
    if (this.cache.size > 1024) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
  private async collect(command: string, environment: EnvironmentSnapshot,
    options: FindOptions, signal: AbortSignal): Promise<Discovery> {
    const candidates: DiscoveredCandidate[] = [];
    const searched: string[] = [];
    const installed = new Set<string>();
    const add = async (file: string, source: LanguageServerCandidate['source']) => {
      if (signal.aborted || candidates.some(c => c.path === file) || !await this.listed(file) || !await executableFile(file)) return;
      const actual = await realpath(file).catch(() => undefined);
      if (!actual || installed.has(actual)) return;
      installed.add(actual);
      candidates.push({ id: createHash('sha256').update(file).digest('hex').slice(0, 24), path: file, source });
    };
    if (path.isAbsolute(command)) {
      searched.push(command);
      // A selected npm bin is a script, not a Windows shell wrapper.
      if (options.npmPackage && /\.[cm]?js$/i.test(command) && await this.listed(command)) {
        const node = (await this.find('node', { resolveEnvironment: options.resolveEnvironment })).selected;
        if (node && (await stat(command)).isFile()) candidates.push({ id: createHash('sha256').update(command).digest('hex').slice(0, 24), path: command, source: 'explicit', runtime: node.path });
      } else await add(command, 'explicit');
    }
    else if (!command.includes('/') && !command.includes('\\')) {
      const names = process.platform === 'win32' && !path.extname(command) ? [command + '.exe', command + '.com'] : [command];
      const directories = searchDirectories(environment.env);
      for (const directory of directories) {
        if (signal.aborted) break;
        searched.push(directory.path);
        for (const name of names) await add(path.join(directory.path, name), directory.source);
      }
      if (!candidates.length && options.python && (options.resolveEnvironment || this.pythonPaths) && !signal.aborted) {
        this.pythonPaths ??= this.pythonScripts(environment.env, signal);
        for (const directory of await this.pythonPaths) {
          searched.push(directory);
          for (const name of names) await add(path.join(directory, name), 'python');
        }
      }
      // npm's package.json bin mapping is data. Never execute .cmd/.bat wrappers,
      // package scripts, npm install, npx, or a workspace-local node_modules tree.
      if (!candidates.length && options.npmPackage && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(options.npmPackage) && !signal.aborted) {
        const node = (await this.find('node', { resolveEnvironment: options.resolveEnvironment })).selected;
        const directories = node ? npmDirectories(environment.env, node.path) : [];
        if (node && (options.resolveEnvironment || this.npmPaths)) {
          this.npmPaths ??= this.npmRoot(environment.env, node.path, signal);
          directories.push(...await this.npmPaths);
        }
        if (node) for (const directory of new Set(directories)) {
          searched.push(directory);
          const folder = path.join(directory, options.npmPackage), manifest = path.join(folder, 'package.json');
          if (!await this.listed(folder)) continue;
          if (!await this.listed(manifest)) continue;
          let metadata = this.packages.get(manifest);
          if (!metadata) {
            metadata = stat(manifest).then(s => s.size <= 1024 * 1024 ? readFile(manifest, 'utf8') : '').then(s => JSON.parse(s)).catch(() => null);
            this.packages.set(manifest, metadata);
          }
          const pkg = await metadata;
          if (!pkg || pkg.name !== options.npmPackage) continue;
          const bin = typeof pkg.bin === 'string' ? (command === options.npmPackage.split('/').at(-1) ? pkg.bin : undefined)
            : pkg.bin && typeof pkg.bin === 'object' && Object.hasOwn(pkg.bin, command) ? (pkg.bin as Record<string, unknown>)[command] : undefined;
          if (typeof bin !== 'string' || path.isAbsolute(bin)) continue;
          const file = path.resolve(folder, bin), relative = path.relative(folder, file);
          if (relative.startsWith('..') || !relative || !await this.listed(file)) continue;
          try {
            const actual = await realpath(file), base = await realpath(folder), inside = path.relative(base, actual);
            if (inside.startsWith('..') || path.isAbsolute(inside) || !(await stat(actual)).isFile()) continue;
            // Node bin scripts conventionally use JS or an explicit node shebang.
            if (!/\.[cm]?js$/i.test(file)) {
              if ((await stat(file)).size > 1024 * 1024 || !/^#![^\n]*\bnode\b/.test(await readFile(file, 'utf8'))) continue;
            }
            if (signal.aborted || installed.has(actual)) continue;
            installed.add(actual);
            candidates.push({ id: createHash('sha256').update(file).digest('hex').slice(0, 24), path: file, source: 'npm', runtime: node.path });
          } catch { /* Removed or incomplete installation. */ }
        }
      }
    }
    const preferred = candidates.find(c => c.source === 'explicit' || c.source === 'path');
    return { candidates, selected: preferred ?? (candidates.length === 1 ? candidates[0] : undefined), environment, searched };
  }
  private async pythonScripts(env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string[]> {
    const home = env.HOME || env.USERPROFILE || os.homedir();
    for (const directory of searchDirectories(env)) for (const name of process.platform === 'win32' ? ['python.exe'] : ['python3', 'python']) {
      const executable = path.join(directory.path, name);
      if (signal.aborted) return [];
      if (!await executableFile(executable)) continue;
      try {
        const script = 'import json,sysconfig; print(json.dumps([sysconfig.get_path("scripts"),sysconfig.get_path("scripts",sysconfig.get_preferred_scheme("user"))]))';
        const output = JSON.parse(await this.query(executable, ['-c', script], env, home, signal));
        return Array.isArray(output) ? output.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)) : [];
      } catch { return []; }
    }
    return [];
  }
  private async npmRoot(env: NodeJS.ProcessEnv, node: string, signal: AbortSignal): Promise<string[]> {
    const candidates = npmDirectories(env, node).map(directory => path.join(directory, 'npm/bin/npm-cli.js'));
    for (const directory of searchDirectories(env)) {
      const shim = path.join(directory.path, 'npm');
      if (!await this.listed(shim)) continue;
      const actual = await realpath(shim).catch(() => '');
      if (path.basename(actual) === 'npm-cli.js') candidates.push(actual);
    }
    for (const cli of new Set(candidates)) {
      if (signal.aborted) return [];
      if (!await this.listed(cli)) continue;
      try {
        const { NODE_OPTIONS: _options, NODE_PATH: _path, ELECTRON_RUN_AS_NODE: _electron, ...clean } = env;
        const root = (await this.query(node, [cli, 'root', '--global', '--ignore-scripts', '--no-update-notifier', '--no-audit', '--no-fund'],
          clean, env.HOME || env.USERPROFILE || os.homedir(), signal)).trim();
        return path.isAbsolute(root) && !/[\r\n\0]/.test(root) ? [root] : [];
      } catch { return []; }
    }
    return [];
  }
}

export function npmDirectories(env: NodeJS.ProcessEnv, node: string): string[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const prefixes = [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, path.join(home, '.local'),
    ...(process.platform === 'win32' ? [env.APPDATA && path.join(env.APPDATA, 'npm'), path.dirname(node)] : [path.dirname(path.dirname(node))])];
  const paths = prefixes.filter((p): p is string => !!p && path.isAbsolute(p)).map(p => path.join(p, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'));
  for (const entry of searchDirectories(env).filter(d => d.source === 'path'))
    paths.push(process.platform === 'win32' ? path.join(entry.path, 'node_modules') : path.resolve(entry.path, '../lib/node_modules'));
  return [...new Set(paths)];
}
