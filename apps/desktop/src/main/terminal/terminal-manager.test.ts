import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IPty } from 'node-pty';
import { launchDirectory, TerminalManager } from './terminal-manager';

const managers: TerminalManager[] = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); });
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
  const manager = new TerminalManager(spawn); managers.push(manager);
  const send = vi.fn();
  const create = (owner = 1, id = 'one') => {
    const info = manager.create(owner, id, { cols: 80, rows: 24 }, '/tmp', send);
    if (info instanceof Promise) throw new Error('Expected a new terminal');
    return info;
  };
  return { manager, pty, spawn, send, create, output: (text: string) => output(text),
    exit: () => exit({ exitCode: 7 }), dataDispose, exitDispose };
}

describe('launch directory', () => {
  it('uses the first existing directory and falls back to the home directory', () => {
    const existing = mkdtempSync(join(tmpdir(), 'terminal-cwd-'));
    try {
      expect(launchDirectory(null, existing, '/definitely/missing')).toBe(existing);
      expect(launchDirectory('/definitely/missing', null)).toBe(homedir());
    } finally { rmSync(existing, { recursive: true, force: true }); }
  });
});

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

describe('terminal tab transfers', () => {
  it('keeps the PTY, buffers output during handoff and rejects the old owner', async () => {
    const f = fixture(); f.create();
    f.output('before\r\n');
    expect(f.manager.adopt(9, 2, 'one')).toBe(false);
    expect(f.manager.adopt(1, 2, 'one')).toBe(true);
    expect(f.pty.pause).toHaveBeenCalledOnce();
    f.manager.closeOwner(1);
    f.manager.write(1, 'one', 'wrong');
    f.manager.resize(1, 'one', { cols: 90, rows: 20 });
    expect(f.pty.kill).not.toHaveBeenCalled();
    expect(f.pty.write).not.toHaveBeenCalled();
    f.output('during\r\n');
    const destination = vi.fn();
    const restored = await f.manager.create(2, 'one', { cols: 90, rows: 20 }, '/tmp', destination);
    expect(restored.snapshot).toContain('before\r\nduring');
    expect(restored.size).toEqual({ cols: 80, rows: 24 });
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(f.pty.resume).toHaveBeenCalledOnce();
    f.output('after');
    expect(destination).toHaveBeenCalledWith({ id: 'one', type: 'data', data: 'after' });
    expect(f.send).toHaveBeenCalledTimes(1);
    f.manager.write(2, 'one', 'correct');
    expect(f.pty.write).toHaveBeenCalledWith('correct');
    f.manager.closeOwner(2);
    expect(f.pty.kill).toHaveBeenCalledOnce();
  });
  it('keeps exited output transferable without restarting a shell', async () => {
    const f = fixture(); f.create(); f.output('finished'); f.exit();
    expect(f.manager.adopt(1, 2, 'one')).toBe(true);
    const restored = await f.manager.create(2, 'one', { cols: 80, rows: 24 }, '/tmp', vi.fn());
    expect(restored).toMatchObject({ snapshot: expect.stringContaining('finished'), exitCode: 7 });
    f.manager.write(2, 'one', 'ignored'); f.manager.closeOwner(2);
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(f.pty.kill).not.toHaveBeenCalled();
    expect(f.pty.write).not.toHaveBeenCalled();
  });
  it('keeps screen content after a long overwritten output stream', async () => {
    const f = fixture(); f.create();
    f.output('\x1b[Hfirst-row\x1b[3;1H' + 'x\r'.repeat(1100000) + 'latest');
    expect(f.manager.adopt(1, 2, 'one')).toBe(true);
    const info = await f.manager.create(2, 'one', { cols: 80, rows: 24 }, '/tmp', vi.fn());
    expect(info.snapshot).toContain('first-row');
    expect(info.snapshot).toContain('latest');
    expect(info.snapshot.length).toBeLessThan(1000);
  });
});
