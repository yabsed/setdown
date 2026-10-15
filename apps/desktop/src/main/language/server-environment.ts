import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export type EnvironmentSnapshot = { env: NodeJS.ProcessEnv; source: 'inherited' | 'shell'; message?: string };

/** A bounded metadata query, never a package installation or a workspace shell command. */
export function capture(executable: string, args: string[], env: NodeJS.ProcessEnv, cwd: string,
  signal?: AbortSignal, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Environment discovery cancelled.')); return; }
    const child = spawn(executable, args, { env, cwd, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0, finished = false;
    const terminate = () => {
      if (!child.pid) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
    };
    const done = (error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { terminate(); reject(error); } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const abort = () => done(new Error('Environment discovery cancelled.'));
    const timer = setTimeout(() => done(new Error('Environment discovery timed out.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) done(new Error('Environment query produced too much output.'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) done(new Error('Environment query produced too much output.'));
    });
    child.once('error', error => done(error));
    child.once('close', code => done(code === 0 ? undefined : new Error(`Environment query exited (${code}).`)));
  });
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export class ServerEnvironment {
  private pending?: Promise<EnvironmentSnapshot>;
  private controller = new AbortController();
  private value: EnvironmentSnapshot;
  constructor(private readonly inherited: NodeJS.ProcessEnv = { ...process.env },
    private readonly home = inherited.HOME || inherited.USERPROFILE || os.homedir(),
    private readonly query = capture) {
    this.value = { env: { ...inherited }, source: 'inherited' };
  }
  peek(): EnvironmentSnapshot { return this.value; }
  reset(): void {
    this.controller.abort(); this.controller = new AbortController(); this.pending = undefined;
    this.value = { env: { ...this.inherited }, source: 'inherited' };
  }
  dispose(): void { this.controller.abort(); }
  resolve(): Promise<EnvironmentSnapshot> {
    if (this.pending) return this.pending;
    const signal = this.controller.signal;
    return this.pending = this.read(signal).then(value => {
      if (!signal.aborted) this.value = value;
      return value;
    });
  }
  private async read(signal: AbortSignal): Promise<EnvironmentSnapshot> {
    const inherited = { env: { ...this.inherited }, source: 'inherited' as const };
    // An explicitly activated runtime belongs to the launching terminal.
    if (process.platform === 'win32' || this.inherited.VIRTUAL_ENV || this.inherited.CONDA_PREFIX
      || this.inherited.SETDOWN_LSP_INHERIT_ENV === '1') return inherited;
    const shell = this.inherited.SHELL || os.userInfo().shell || '/bin/sh';
    const name = path.basename(shell);
    if (!path.isAbsolute(shell) || !/^(bash|zsh|fish|sh|dash|ksh|csh|tcsh)$/.test(name))
      return { ...inherited, message: `Shell environment unavailable for ${name}; using inherited environment.` };
    const mark = randomUUID().replaceAll('-', '');
    const script = `JSON.stringify(process.env)`;
    // Only the application path and fixed helper text enter the shell, never workspace data.
    const command = `${quote(process.execPath)} -p ${quote(`'${mark}'+${script}+'${mark}'`)}`;
    const args = name === 'csh' || name === 'tcsh' ? ['-ic', command] : ['-ilc', command];
    try {
      const output = await this.query(shell, args, { ...this.inherited, ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: undefined, NODE_PATH: undefined, DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTART: 'false', ZSH_TMUX_AUTOSTARTED: 'true' }, this.home, signal, 5000);
      const start = output.indexOf(mark), end = output.indexOf(mark, start + mark.length);
      if (start < 0 || end < 0) throw new Error('Shell did not return a valid environment.');
      const values: unknown = JSON.parse(output.slice(start + mark.length, end));
      if (!values || typeof values !== 'object' || Array.isArray(values)
        || Object.entries(values).some(([key, value]) => !key || key.includes('=') || key.includes('\0') || typeof value !== 'string' || value.includes('\0')))
        throw new Error('Shell returned an invalid environment.');
      const env: NodeJS.ProcessEnv = { ...values };
      // Helper-only flags must not leak into servers (or into the main process).
      for (const key of ['ELECTRON_RUN_AS_NODE', 'DISABLE_AUTO_UPDATE', 'ZSH_TMUX_AUTOSTART', 'ZSH_TMUX_AUTOSTARTED'])
        if (this.inherited[key] === undefined) delete env[key]; else env[key] = this.inherited[key];
      return { env, source: 'shell' };
    } catch (error) { return { ...inherited, message: String(error) }; }
  }
}
