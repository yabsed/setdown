import { basename } from 'node:path';
import { homedir } from 'node:os';
import type { IPty, IPtyForkOptions } from 'node-pty';
import type { TerminalEvent, TerminalSize } from '../../protocol/terminal';

type Spawn = (shell: string, args: string[], options: IPtyForkOptions) => IPty;
type Session = { owner: number; pty: IPty; pending: number; paused: boolean; dispose(): void };
const HIGH_WATER = 128 * 1024;
const LOW_WATER = 32 * 1024;

function validSize(size: TerminalSize): boolean {
  return !!size && Number.isInteger(size.cols) && Number.isInteger(size.rows)
    && size.cols >= 2 && size.cols <= 1000 && size.rows >= 1 && size.rows <= 500;
}

/** Window-owned PTYs. Output acknowledgments keep busy shells from flooding IPC. */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly spawn: Spawn = (shell, args, options) =>
    require('node-pty').spawn(shell, args, options)) {}

  create(owner: number, id: string, size: TerminalSize, cwd: string | null,
    send: (event: TerminalEvent) => void): { title: string; cwd: string } {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || this.sessions.has(id)
      || !validSize(size)) throw new Error('Invalid terminal request.');
    if ([...this.sessions.values()].filter((session) => session.owner === owner).length >= 12) {
      throw new Error('Close a terminal before opening another (maximum 12).');
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const env: NodeJS.ProcessEnv = { ...process.env, TERM_PROGRAM: 'Setdown', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const directory = cwd || homedir();
    const pty = this.spawn(shell, process.platform === 'win32' ? ['-NoLogo'] : ['-i'], {
      ...size, cwd: directory, env, name: 'xterm-256color',
    });
    const session: Session = { owner, pty, pending: 0, paused: false, dispose: () => {} };
    this.sessions.set(id, session);
    const data = pty.onData((text) => {
      session.pending += text.length;
      if (!session.paused && session.pending > HIGH_WATER) { session.paused = true; pty.pause(); }
      send({ id, type: 'data', data: text });
    });
    const exit = pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      session.dispose();
      send({ id, type: 'exit', exitCode });
    });
    session.dispose = () => { data.dispose(); exit.dispose(); };
    return { title: basename(shell), cwd: directory };
  }

  private owned(owner: number, id: string): Session | undefined {
    const session = this.sessions.get(id);
    return session?.owner === owner ? session : undefined;
  }
  write(owner: number, id: string, data: string): void {
    if (typeof data !== 'string' || data.length > 64 * 1024) return;
    this.owned(owner, id)?.pty.write(data);
  }
  resize(owner: number, id: string, size: TerminalSize): void {
    if (!validSize(size)) return;
    const session = this.owned(owner, id);
    if (session) { try { session.pty.resize(size.cols, size.rows); } catch { /* Shell may have exited. */ } }
  }
  acknowledge(owner: number, id: string, length: number): void {
    const session = this.owned(owner, id);
    if (!session || !Number.isInteger(length) || length <= 0 || length > session.pending) return;
    session.pending -= length;
    if (session.paused && session.pending < LOW_WATER) { session.paused = false; session.pty.resume(); }
  }
  close(owner: number, id: string): void {
    const session = this.owned(owner, id);
    if (!session) return;
    this.sessions.delete(id);
    session.dispose();
    try { session.pty.kill(); } catch { /* Already exited. */ }
  }
  closeOwner(owner: number): void {
    for (const [id, session] of this.sessions) if (session.owner === owner) this.close(owner, id);
  }
  dispose(): void {
    for (const [id, session] of this.sessions) this.close(session.owner, id);
  }
}
