import { basename } from 'node:path';
import { homedir } from 'node:os';
import { statSync } from 'node:fs';
import type { IPty, IPtyForkOptions } from 'node-pty';
import type { TerminalEvent, TerminalSize, TerminalInfo } from '../../protocol/terminal';

function isDirectory(candidate: string | null): candidate is string {
  if (!candidate) return false;
  try { return statSync(candidate).isDirectory(); } catch { return false; }
}

/** Untitled documents live in a drafts folder that does not exist until save, so a missing directory falls back. */
export function launchDirectory(...candidates: (string | null)[]): string {
  for (const candidate of candidates) if (isDirectory(candidate)) return candidate;
  return homedir();
}

type Spawn = (shell: string, args: string[], options: IPtyForkOptions) => IPty;
type Session = { owner: number; pty: IPty; pending: number; paused: boolean; title: string; cwd: string; size: TerminalSize; output: string[]; outputLength: number; exitCode?: number;
  send: ((event: TerminalEvent) => void) | null; dispose(): void };
const HIGH_WATER = 128 * 1024;
const LOW_WATER = 32 * 1024;
const REPLAY_LIMIT = 2 * 1024 * 1024;

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
    send: (event: TerminalEvent) => void): TerminalInfo {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || !validSize(size)) throw new Error('Invalid terminal request.');
    const existing = this.owned(owner, id);
    if (existing) {
      if (existing.send) throw new Error('Invalid terminal request: already attached.');
      existing.send = send;
      existing.pending = 0;
      const info = this.info(existing);
      if (existing.paused && existing.exitCode === undefined) { existing.paused = false; existing.pty.resume(); }
      return info;
    }
    if (this.sessions.has(id)) throw new Error('Invalid terminal request.');
    if ([...this.sessions.values()].filter((session) => session.owner === owner).length >= 12) {
      throw new Error('Close a terminal before opening another (maximum 12).');
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const env: NodeJS.ProcessEnv = { ...process.env, TERM_PROGRAM: 'Setdown', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const directory = isDirectory(cwd) ? cwd : homedir();
    const pty = this.spawn(shell, process.platform === 'win32' ? ['-NoLogo'] : ['-i'], {
      ...size, cwd: directory, env, name: 'xterm-256color',
    });
    const session: Session = { owner, pty, pending: 0, paused: false, title: basename(shell), cwd: directory, size, output: [], outputLength: 0, send, dispose: () => {} };
    this.sessions.set(id, session);
    const data = pty.onData((text) => {
      session.output.push(text); session.outputLength += text.length;
      while (session.outputLength > REPLAY_LIMIT) {
        const overflow = session.outputLength - REPLAY_LIMIT;
        const first = session.output[0];
        if (first.length <= overflow) { session.output.shift(); session.outputLength -= first.length; }
        else { session.output[0] = first.slice(overflow); session.outputLength -= overflow; }
      }
      session.pending += text.length;
      if (!session.paused && session.pending > HIGH_WATER) { session.paused = true; pty.pause(); }
      session.send?.({ id, type: 'data', data: text });
    });
    const exit = pty.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      session.dispose();
      session.send?.({ id, type: 'exit', exitCode });
    });
    session.dispose = () => { data.dispose(); exit.dispose(); };
    return this.info(session);
  }

  private info(session: Session): TerminalInfo {
    return { title: session.title, cwd: session.cwd, size: { ...session.size }, replay: session.output.join(''), exitCode: session.exitCode };
  }
  owns(owner: number, id: string): boolean { return !!this.owned(owner, id); }
  adopt(source: number, destination: number, id: string): boolean {
    const session = this.owned(source, id);
    if (!session || [...this.sessions.values()].filter(s => s.owner === destination).length >= 12) return false;
    session.owner = destination;
    session.send = null;
    // Stop output while no renderer can acknowledge it. Attach resumes the same PTY.
    if (!session.paused && session.exitCode === undefined) { session.paused = true; session.pty.pause(); }
    return true;
  }
  private owned(owner: number, id: string): Session | undefined {
    const session = this.sessions.get(id);
    return session?.owner === owner ? session : undefined;
  }
  write(owner: number, id: string, data: string): void {
    if (typeof data !== 'string' || data.length > 64 * 1024) return;
    const session = this.owned(owner, id);
    if (session?.exitCode === undefined) session?.pty.write(data);
  }
  resize(owner: number, id: string, size: TerminalSize): void {
    if (!validSize(size)) return;
    const session = this.owned(owner, id);
    if (session && session.exitCode === undefined) { session.size = { ...size }; try { session.pty.resize(size.cols, size.rows); } catch { /* Shell may have exited. */ } }
  }
  acknowledge(owner: number, id: string, length: number): void {
    const session = this.owned(owner, id);
    if (!session || !Number.isInteger(length) || length <= 0 || length > session.pending) return;
    session.pending -= length;
    if (session.paused && session.send && session.exitCode === undefined && session.pending < LOW_WATER) { session.paused = false; session.pty.resume(); }
  }
  close(owner: number, id: string): void {
    const session = this.owned(owner, id);
    if (!session) return;
    this.sessions.delete(id);
    if (session.exitCode !== undefined) return;
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
