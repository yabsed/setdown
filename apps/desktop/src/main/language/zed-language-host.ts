import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type PreparedLanguageServer = {
  executable: string; args: string[]; env?: Record<string, string>; languageId?: string;
  settings: Record<string, unknown>; initializationOptions: Record<string, unknown>;
};
type Pending = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; progress?: (message: string) => void };
const prefix = 'SETDOWN-LANGUAGE/1 ';

/** A crash in an installer/extension cannot take the editor or its unsaved buffers down. */
export class ZedLanguageHost {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private starting?: Promise<ChildProcessWithoutNullStreams>;
  private disposed = false;
  constructor(readonly dataDirectory: string, private readonly executable: string,
    private readonly environment: NodeJS.ProcessEnv = process.env) {}

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.disposed) return Promise.reject(Error('Language host has stopped.'));
    if (this.child) return Promise.resolve(this.child);
    return this.starting ??= (async () => {
      await mkdir(this.dataDirectory, { recursive: true });
      if (this.disposed) throw Error('Language host has stopped.');
      const { ELECTRON_RUN_AS_NODE: _electron, NODE_OPTIONS: _options, NODE_PATH: _path, ...env } = this.environment;
      const child = spawn(this.executable, [this.dataDirectory], { cwd: this.dataDirectory, env, windowsHide: true, stdio: 'pipe' });
      this.child = child;
      let buffer = '', errors = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stderr.on('data', text => { errors = (errors + text).slice(-8192); });
      child.stdout.on('data', text => {
        buffer += text;
        if (buffer.length > 8 * 1024 * 1024) { this.fail(child, Error('Language host exceeded its response limit.')); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.startsWith(prefix)) continue; // WASI extension stdout is never a response.
          let response: any; try { response = JSON.parse(line.slice(prefix.length)); } catch { this.fail(child, Error('Invalid language host response.')); return; }
          const pending = this.pending.get(response.id); if (!pending) continue;
          if (response.event) { pending.progress?.(String(response.message ?? response.status ?? '').slice(0, 1024)); continue; }
          clearTimeout(pending.timer); this.pending.delete(response.id);
          if (typeof response.error === 'string') pending.reject(Error(response.error)); else pending.resolve(response.result);
        }
      });
      child.on('error', error => this.fail(child, error));
      child.on('exit', (code, signal) => this.fail(child, Error(`Language host exited (${signal ?? code}). ${errors.trim()}`)));
      child.stdin.on('error', error => this.fail(child, error));
      return child;
    })().finally(() => { this.starting = undefined; });
  }
  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); child.kill();
  }
  async request<T>(op: string, values: Record<string, unknown> = {}, progress?: (message: string) => void): Promise<T> {
    const child = await this.start(), id = ++this.sequence;
    const payload = JSON.stringify({ ...values, op, id }) + '\n';
    if (payload.length > 4 * 1024 * 1024) throw Error('Language host request is too large.');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(child, Error('Language installation timed out. Reopen the file to retry.')), 10 * 60 * 1000);
      timer.unref(); this.pending.set(id, { resolve, reject, timer, progress });
      child.stdin.write(payload, error => { if (error) this.fail(child, error); });
    });
  }
  async prepare(values: Record<string, unknown>, progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    const result = await this.request<PreparedLanguageServer>('prepare', values, progress);
    return validatePreparedServer(result);
  }
  dispose(): void {
    this.disposed = true;
    if (this.child) this.fail(this.child, Error('Language host has stopped.'));
  }
}
export function validatePreparedServer(value: PreparedLanguageServer): PreparedLanguageServer {
  if (!value || !path.isAbsolute(value.executable) || !Array.isArray(value.args) || value.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))
    || !value.settings || typeof value.settings !== 'object' || !value.initializationOptions || typeof value.initializationOptions !== 'object')
    throw Error('Language package returned an invalid launch command.');
  return value;
}
