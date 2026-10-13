import { TerminalScreen } from './terminal-screen';
import { TerminalResize } from './terminal-resize';
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
type Session = { owner: number; pty: IPty; pending: number; paused: boolean; title: string; cwd: string; size: TerminalSize; screen: TerminalScreen; resizer: TerminalResize; attaching: boolean; tail: { sequence: number; event: TerminalEvent }[]; exitCode?: number;
  send: ((event: TerminalEvent) => void) | null; dispose(): void };
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
    send: (event: TerminalEvent) => void): TerminalInfo | Promise<TerminalInfo> {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || !validSize(size)) throw new Error('Invalid terminal request.');
    const existing = this.owned(owner, id);
    if (existing) {
      if (existing.send || existing.attaching) throw new Error('Invalid terminal request: already attached.');
      existing.attaching = true;
      return existing.resizer.settled().then(() => existing.screen.snapshot()).then(snapshot => {
        if (this.owned(owner, id) !== existing) throw new Error('Terminal closed during transfer.');
        const tail = existing.tail.filter(chunk => chunk.sequence > snapshot.sequence);
        const info = this.info(existing, snapshot.data, snapshot.size);
        existing.tail = [];
        existing.send = send;
        existing.pending = tail.reduce((total, chunk) => total + (chunk.event.type === 'data' ? chunk.event.data.length : 0), 0);
        for (const chunk of tail) send(chunk.event);
        if (existing.paused && existing.exitCode === undefined) { existing.paused = false; existing.pty.resume(); }
        return info;
      }).finally(() => { existing.attaching = false; });
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
    const screen = new TerminalScreen(size);
    const emit = (event: TerminalEvent, sequence: number) => {
      if (this.sessions.get(id) !== session) return;
      if (session.send) session.send(event);
      else session.tail.push({ sequence, event });
    };
    const resizer = new TerminalResize({
      size: () => screen.size,
      notify: next => { if (session.exitCode === undefined) { try { pty.resize(next.cols, next.rows); } catch { /* Shell may have exited. */ } } },
      apply: async (next, current) => (await screen.resize(next, current, sequence => {
        session.size = { ...next };
        emit({ id, type: 'resize', size: { ...next } }, sequence);
      })) !== null,
    });
    const session: Session = { owner, pty, pending: 0, paused: false, title: basename(shell), cwd: directory, size, screen, resizer, attaching: false, tail: [], send, dispose: () => {} };
    this.sessions.set(id, session);
    const data = pty.onData((text) => {
      session.screen.write(text, sequence => emit({ id, type: 'data', data: text }, sequence));
      session.resizer.output();
      session.pending += text.length;
      if (!session.paused && session.pending > HIGH_WATER) { session.paused = true; pty.pause(); }
    });
    const exit = pty.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      session.dispose();
      void screen.whenParsed(() => session.send?.({ id, type: 'exit', exitCode })).catch(() => {});
    });
    session.dispose = () => { data.dispose(); exit.dispose(); };
    return this.info(session);
  }

  private info(session: Session, snapshot = '', size = session.size): TerminalInfo {
    return { title: session.title, cwd: session.cwd, size: { ...size }, snapshot, exitCode: session.exitCode };
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
    if (!session || session.exitCode !== undefined) return;
    if (!session.resizer.busy) session.pty.write(data);
    else void session.resizer.settled().then(() => {
      if (this.owned(owner, id) === session && session.exitCode === undefined) session.pty.write(data);
    });
  }
  resize(owner: number, id: string, size: TerminalSize): void {
    if (!validSize(size)) return;
    const session = this.owned(owner, id);
    if (session) session.resizer.request(size);
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
    session.resizer.dispose();
    session.screen.dispose();
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
