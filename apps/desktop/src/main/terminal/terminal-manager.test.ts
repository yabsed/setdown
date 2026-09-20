import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import { TerminalManager } from './terminal-manager';

function fixture() {
  let output = (_data: string) => {};
  let exit = (_event: { exitCode: number }) => {};
  const dataDispose = vi.fn();
  const exitDispose = vi.fn();
  const pty = { write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), kill: vi.fn(),
    onData: (callback: typeof output) => { output = callback; return { dispose: dataDispose }; },
    onExit: (callback: typeof exit) => { exit = callback; return { dispose: exitDispose }; },
  } as unknown as IPty;
  const spawn = vi.fn(() => pty);
  const manager = new TerminalManager(spawn);
  const send = vi.fn();
  const create = (owner = 1, id = 'one') => manager.create(owner, id, { cols: 80, rows: 24 }, '/tmp', send);
  return { manager, pty, spawn, send, create, output: (text: string) => output(text),
    exit: () => exit({ exitCode: 7 }), dataDispose, exitDispose };
}

describe('window-owned terminals', () => {
  it('uses the requested working directory and rejects invalid launches before spawning', () => {
    const f = fixture();
    expect(f.create().cwd).toBe('/tmp');
    expect(f.spawn.mock.calls[0]).toEqual([expect.any(String), expect.any(Array), expect.objectContaining({
      cwd: '/tmp', cols: 80, rows: 24, name: 'xterm-256color',
    })]);
    expect(() => f.create()).toThrow('Invalid');
    expect(() => f.manager.create(1, 'bad', { cols: NaN, rows: -1 }, '/tmp', f.send)).toThrow('Invalid');
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it('isolates input, resize, termination and acknowledgments by owner', () => {
    const f = fixture(); f.create();
    f.manager.write(2, 'one', 'wrong');
    f.manager.resize(2, 'one', { cols: 100, rows: 40 });
    f.manager.close(2, 'one');
    expect(f.pty.write).not.toHaveBeenCalled();
    expect(f.pty.resize).not.toHaveBeenCalled();
    expect(f.pty.kill).not.toHaveBeenCalled();
    f.manager.write(1, 'one', 'echo hello\r');
    f.manager.resize(1, 'one', { cols: 100, rows: 40 });
    f.manager.resize(1, 'one', { cols: Infinity, rows: 40 });
    expect(f.pty.write).toHaveBeenCalledWith('echo hello\r');
    expect(f.pty.resize).toHaveBeenCalledExactlyOnceWith(100, 40);
    f.manager.closeOwner(1);
    expect(f.pty.kill).toHaveBeenCalledOnce();
    expect(f.dataDispose).toHaveBeenCalledOnce();
    expect(f.exitDispose).toHaveBeenCalledOnce();
  });
  it('pauses busy output until the owning renderer has parsed it', () => {
    const f = fixture(); f.create();
    f.output('a'.repeat(140000));
    expect(f.pty.pause).toHaveBeenCalledOnce();
    f.manager.acknowledge(2, 'one', 140000);
    f.manager.acknowledge(1, 'one', 140001);
    f.manager.acknowledge(1, 'one', -1);
    expect(f.pty.resume).not.toHaveBeenCalled();
    f.manager.acknowledge(1, 'one', 140000);
    expect(f.pty.resume).toHaveBeenCalledOnce();
  });
  it('reports exit once, releases subscriptions, and makes later input harmless', () => {
    const f = fixture(); f.create(); f.exit();
    expect(f.send).toHaveBeenCalledWith({ id: 'one', type: 'exit', exitCode: 7 });
    f.manager.write(1, 'one', 'ignored'); f.manager.dispose();
    expect(f.pty.write).not.toHaveBeenCalled();
    expect(f.pty.kill).not.toHaveBeenCalled();
    expect(f.exitDispose).toHaveBeenCalledOnce();
  });
});
