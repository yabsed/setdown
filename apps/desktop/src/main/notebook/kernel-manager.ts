import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import type { NotebookKernelEvent, NotebookRun } from '../../protocol/notebook';
import { ServerDiscovery, executableFile } from '../language/server-discovery';

type KernelPayload = { [T in NotebookKernelEvent['type']]: Omit<Extract<NotebookKernelEvent, { type: T }>, 'id' | 'generation'> }[NotebookKernelEvent['type']];
type Session = { child: ChildProcessWithoutNullStreams; owner: number; request: NotebookRun; busy: boolean; ready: boolean;
  timer: ReturnType<typeof setTimeout>; send(event: NotebookKernelEvent): void };
export function validateNotebookRun(request: NotebookRun): void {
  if (!request || typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id)
    || typeof request.generation !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.generation)
    || typeof request.path !== 'string' || !path.isAbsolute(request.path) || !/\.ipynb$/i.test(request.path)
    || (request.python !== undefined && (typeof request.python !== 'string' || !path.isAbsolute(request.python)))
    || !Array.isArray(request.cells) || !request.cells.length || request.cells.length > 10000)
    throw Error('Invalid notebook execution request.');
  let length = 0; const ids = new Set<string>();
  for (const cell of request.cells) {
    if (!cell || typeof cell.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cell.id) || ids.has(cell.id)
      || !Number.isSafeInteger(cell.version) || cell.version < 1 || typeof cell.source !== 'string'
      || (cell.runId !== undefined && (typeof cell.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(cell.runId)))
      || cell.source.length > 1024 * 1024) throw Error('Invalid or oversized notebook cell.');
    ids.add(cell.id); length += cell.source.length;
  }
  if (length > 4 * 1024 * 1024) throw Error('Run at most 4 MiB of Python source at a time.');
}

/** One explicitly started Python kernel per owner/tab. No kernel on file open. */
export class NotebookKernelManager {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, object>();
  constructor(private bridge: string, private discovery = new ServerDiscovery()) {}
  private key(owner: number, id: string): string { return `${owner}:${id}`; }
  async run(owner: number, request: NotebookRun, send: (event: NotebookKernelEvent) => void): Promise<void> {
    validateNotebookRun(request);
    const key = this.key(owner, request.id), existing = this.sessions.get(key);
    if (existing && existing.request.generation === request.generation && existing.request.path === request.path
      && existing.request.python === request.python) {
      if (existing.busy) throw Error('A cell is already running. Interrupt it before starting another run.');
      existing.busy = true; existing.request = request;
      this.write(existing, { type: 'execute', cells: request.cells }); return;
    }
    if (this.pending.has(key)) throw Error('The Python kernel is already starting.');
    this.stop(owner, request.id);
    const token = {}; this.pending.set(key, token);
    try {
      const found = await this.discovery.find(process.platform === 'win32' ? 'python' : 'python3', { resolveEnvironment: true });
      const python = request.python || found.selected?.path;
      if (!python || !await executableFile(python)) throw Error('Python was not found. Choose a Python executable with ipykernel installed.');
      if (this.pending.get(key) !== token) return;
      const child = spawn(python, ['-E', '-u', this.bridge, path.dirname(request.path)], {
        cwd: path.dirname(this.bridge), env: { ...found.environment.env, PYTHONUNBUFFERED: '1' }, shell: false, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const emit = (event: KernelPayload) => send({ ...event, id: request.id, generation: request.generation } as NotebookKernelEvent);
      const session: Session = { owner, child, request, send, busy: true, ready: false,
        timer: setTimeout(() => fail('Python kernel startup timed out. Check the chosen environment.'), 65_000) };
      this.sessions.set(key, session);
      const current = () => this.sessions.get(key) === session;
      const fail = (message: string) => { if (current()) { emit({ type: 'state', state: 'failed', message } as NotebookKernelEvent); this.stop(owner, request.id); } };
      let buffer = '', stderr = ''; const decoder = new StringDecoder('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
      child.stdin.on('error', error => fail(`Python connection closed: ${error.message}`));
      child.stdout.on('data', (chunk: Buffer) => {
        if (!current()) return;
        buffer += decoder.write(chunk);
        if (buffer.length > 10 * 1024 * 1024) { fail('Python produced an oversized protocol message.'); return; }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try {
            const event = JSON.parse(line) as NotebookKernelEvent;
            if (!['state', 'cell-start', 'cell-done', 'output', 'input', 'inspect'].includes(event.type)) throw Error('Unknown kernel event.');
            if (event.type === 'state') {
              if (event.state === 'failed') { fail(event.message ?? 'Python kernel failed.'); return; }
              if (event.state === 'idle' && !session.ready) {
                session.ready = true; clearTimeout(session.timer);
                emit({ ...event, state: 'starting' }); continue;
              }
              if (event.state === 'idle') session.busy = false;
            }
            emit(event);
          } catch (error) { fail(`Invalid Python bridge message: ${String(error)}`); return; }
        }
      });
      child.once('error', error => fail(error.message));
      child.once('exit', (code, signal) => fail(`Python kernel bridge exited (${signal ?? code}). ${stderr}`));
      emit({ type: 'state', state: 'starting', python } as NotebookKernelEvent);
      this.write(session, { type: 'execute', cells: request.cells });
    } finally { if (this.pending.get(key) === token) this.pending.delete(key); }
  }
  private write(session: Session, command: unknown): void {
    if (!session.child.stdin.destroyed) session.child.stdin.write(JSON.stringify(command) + '\n');
  }
  interrupt(owner: number, id: string, generation: string): void {
    const session = this.sessions.get(this.key(owner, id));
    if (!session || session.request.generation !== generation) return;
    if (!session.ready) {
      session.send({ id, generation, type: 'state', state: 'stopped' }); this.stop(owner, id); return;
    }
    this.write(session, { type: 'interrupt' });
  }
  input(owner: number, id: string, generation: string, request: string, value: string): void {
    const session = this.sessions.get(this.key(owner, id));
    if (!session || session.request.generation !== generation || typeof request !== 'string' || request.length > 128
      || typeof value !== 'string' || value.length > 65536) throw Error('Input request expired.');
    this.write(session, { type: 'input', request, value });
  }
  inspect(owner: number, id: string, generation: string, request: string, name?: string, offset = 0): void {
    const session = this.sessions.get(this.key(owner, id));
    if (!session || session.request.generation !== generation || !session.ready || session.busy) throw Error('Run a cell and wait for the kernel to become idle.');
    if (typeof request !== 'string' || request.length > 128 || name !== undefined && (typeof name !== 'string' || !/^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(name))
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw Error('Invalid variable request.');
    this.write(session, { type: 'inspect', request, name, offset });
  }
  stop(owner: number, id: string, generation?: string): Promise<void> {
    const key = this.key(owner, id), session = this.sessions.get(key);
    if (session && generation && session.request.generation !== generation) return Promise.resolve();
    this.pending.delete(key);
    if (!session) return Promise.resolve();
    this.sessions.delete(key); clearTimeout(session.timer);
    // EOF also terminates a kernel if the owner crashes before sending shutdown.
    this.write(session, { type: 'shutdown' }); session.child.stdin.end();
    const kill = setTimeout(() => session.child.kill('SIGKILL'), 8000); kill.unref();
    return new Promise(resolve => { session.child.once('close', () => { clearTimeout(kill); resolve(); }); });
  }
  disposeOwner(owner: number): void {
    for (const key of this.pending.keys()) if (key.startsWith(`${owner}:`)) this.pending.delete(key);
    for (const session of this.sessions.values()) if (session.owner === owner) this.stop(owner, session.request.id);
  }
  dispose(): void {
    this.pending.clear(); for (const session of this.sessions.values()) this.stop(session.owner, session.request.id);
    this.discovery.dispose();
  }
}
