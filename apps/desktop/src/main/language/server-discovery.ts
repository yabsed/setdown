import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { capture, ServerEnvironment, type EnvironmentSnapshot } from './server-environment';
import type { LanguageServerCandidate } from '../../protocol/language';

export type Discovery = { candidates: LanguageServerCandidate[]; selected?: LanguageServerCandidate;
  environment: EnvironmentSnapshot; searched: string[] };
export async function executableFile(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile() && await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(() => true); }
  catch { return false; }
}
export function searchDirectories(env: NodeJS.ProcessEnv): { path: string; source: 'path' | 'user' }[] {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const paths = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(p => path.isAbsolute(p));
  const user = [env.PIPX_BIN_DIR, env.UV_TOOL_BIN_DIR, env.XDG_BIN_HOME, path.join(home, '.local', 'bin'),
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
  private controller = new AbortController();
  private revision = 0;
  constructor(readonly environment = new ServerEnvironment(), private readonly query = capture) {}
  get generation(): number { return this.revision; }
  reset(): void { this.revision++; this.controller.abort(); this.controller = new AbortController(); this.cache.clear(); this.pythonPaths = undefined; this.environment.reset(); }
  dispose(): void { this.controller.abort(); this.environment.dispose(); this.cache.clear(); }
  async find(command: string, options: { resolveEnvironment?: boolean; python?: boolean } = {}): Promise<Discovery> {
    const signal = this.controller.signal;
    const snapshot = options.resolveEnvironment ? await this.environment.resolve() : this.environment.peek();
    if (signal.aborted) throw new Error('Server discovery cancelled. Rescan installed servers.');
    const key = JSON.stringify([command, snapshot.env, !!options.python, !!options.resolveEnvironment]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.collect(command, snapshot, options, signal).then(result => {
      if (signal.aborted) throw new Error('Server discovery cancelled. Rescan installed servers.');
      if (options.resolveEnvironment)
        this.cache.delete(JSON.stringify([command, snapshot.env, !!options.python, false]));
      return result;
    });
    this.cache.set(key, { expires: Date.now() + 30_000, value });
    // Bound retained environment keys; there are normally only a handful of profiles.
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
  private async collect(command: string, environment: EnvironmentSnapshot,
    options: { resolveEnvironment?: boolean; python?: boolean }, signal: AbortSignal): Promise<Discovery> {
    const candidates: LanguageServerCandidate[] = [];
    const searched: string[] = [];
    const add = async (file: string, source: LanguageServerCandidate['source']) => {
      if (signal.aborted || candidates.some(c => c.path === file) || !await executableFile(file)) return;
      candidates.push({ id: createHash('sha256').update(file).digest('hex').slice(0, 24), path: file, source });
    };
    if (path.isAbsolute(command)) { searched.push(command); await add(command, 'explicit'); }
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
}
