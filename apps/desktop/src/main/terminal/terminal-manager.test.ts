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
  it('isolates input, resize, termination and acknowledgments by owner', async () => {
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
    await vi.waitFor(() => expect(f.pty.resize).toHaveBeenCalledExactlyOnceWith(100, 40));
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
  it('reports exit once, releases subscriptions, and makes later input harmless', async () => {
    const f = fixture(); f.create(); f.exit();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith({ id: 'one', type: 'exit', exitCode: 7 }));
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
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith({ id: 'one', type: 'data', data: 'before\r\n' }));
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
    await vi.waitFor(() => expect(destination).toHaveBeenCalledWith({ id: 'one', type: 'data', data: 'after' }));
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

describe('ordered terminal resizing', () => {
  it('fits exited output without resizing an exited process', async () => {
    const f = fixture(); f.create(); f.exit();
    f.manager.resize(1, 'one', { cols: 100, rows: 40 });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith({ id: 'one', type: 'resize', size: { cols: 100, rows: 40 } }));
    expect(f.pty.resize).not.toHaveBeenCalled();
  });
  it('delivers parsed output and dimensions in order before exit', async () => {
    const f = fixture(); f.create();
    f.output('before'); f.manager.resize(1, 'one', { cols: 100, rows: 40 }); f.output('after'); f.exit();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(4));
    expect(f.send.mock.calls.map(([event]) => event)).toEqual([
      { id: 'one', type: 'data', data: 'before' },
      { id: 'one', type: 'resize', size: { cols: 100, rows: 40 } },
      { id: 'one', type: 'data', data: 'after' },
      { id: 'one', type: 'exit', exitCode: 7 },
    ]);
  });
  it('lets the process redraw a smaller prompt before reflow and user input', async () => {
    const f = fixture(); f.create();
    f.pty.resize = vi.fn(() => f.output('\r\x1b[2Kredrawn'));
    f.manager.resize(1, 'one', { cols: 60, rows: 24 }); f.manager.write(1, 'one', 'typed');
    expect(f.pty.write).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.pty.write).toHaveBeenCalledWith('typed'));
    expect(f.send.mock.calls.map(([event]) => event)).toEqual([
      { id: 'one', type: 'data', data: '\r\x1b[2Kredrawn' },
      { id: 'one', type: 'resize', size: { cols: 60, rows: 24 } },
    ]);
  });
  it('cancels queued input and grid updates when a resizing session closes', async () => {
    const f = fixture(); f.create();
    f.manager.resize(1, 'one', { cols: 60, rows: 24 }); f.manager.write(1, 'one', 'obsolete');
    f.manager.close(1, 'one');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.pty.write).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
});
