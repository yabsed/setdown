import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import type { NotebookKernelEvent, NotebookRun } from '../../protocol/notebook';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), executable: vi.fn(async () => true) }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../language/server-discovery', () => ({ executableFile: mocks.executable, ServerDiscovery: class {} }));
import { NotebookKernelManager, validateNotebookRun } from './kernel-manager';
import type { ServerDiscovery } from '../language/server-discovery';

function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  let sent = ''; child.stdin.on('data', data => { sent += data; });
  mocks.spawn.mockReturnValue(child);
  const discovery = { find: vi.fn(async () => ({ selected: { path: '/usr/bin/python3' }, environment: { env: { PATH: '/usr/bin' } } })), dispose: vi.fn() };
  const manager = new NotebookKernelManager('/app/kernel-bridge.py', discovery as unknown as ServerDiscovery);
  const request: NotebookRun = { id: 'nb', generation: 'gen-1', path: '/project/file.ipynb', cells: [{ id: 'a', version: 1, source: 'print(1)' }] };
  const events: NotebookKernelEvent[] = [], send = (event: NotebookKernelEvent) => events.push(event);
  const event = (event: object) => child.stdout.write(JSON.stringify(event) + '\n');
  const close = () => { manager.dispose(); child.emit('exit', 0); };
  return { manager, discovery, request, child, events, event, send, sent: () => sent, close };
}
afterEach(() => vi.clearAllMocks());
test('execution validates cell identities, path, batch limits and command arguments', () => {
  const f = fixture(); expect(() => validateNotebookRun(f.request)).not.toThrow();
  for (const request of [{ ...f.request, path: '/file.py' }, { ...f.request, python: 'python -c bad' },
    { ...f.request, cells: [f.request.cells[0], f.request.cells[0]] }, { ...f.request, cells: [{ ...f.request.cells[0], source: 'x'.repeat(1024 * 1024 + 1) }] }])
    expect(() => validateNotebookRun(request)).toThrow(); f.close();
});
test('one kernel survives successive batches; interrupt and shutdown remain owner scoped', async () => {
  const f = fixture(); await f.manager.run(5, f.request, f.send);
  expect(mocks.spawn).toHaveBeenCalledWith('/usr/bin/python3', ['-E', '-u', '/app/kernel-bridge.py', '/project'], expect.objectContaining({ shell: false }));
  f.event({ type: 'state', state: 'idle' }); // Ready, with initial batch still pending.
  await expect(f.manager.run(5, f.request, f.send)).rejects.toThrow('already running');
  f.event({ type: 'state', state: 'busy' }); f.manager.interrupt(6, 'nb', 'gen-1'); expect(f.sent()).not.toContain('interrupt');
  f.manager.interrupt(5, 'nb', 'gen-1'); expect(f.sent()).toContain('interrupt');
  f.event({ type: 'state', state: 'idle' }); await f.manager.run(5, f.request, f.send);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  f.manager.stop(5, 'nb', 'stale-generation'); expect(f.sent()).not.toContain('shutdown');
  f.manager.disposeOwner(5); expect(f.sent()).toContain('shutdown'); f.close();
});
test('closing during discovery prevents launching a late kernel', async () => {
  const f = fixture(); let finish!: (value: any) => void;
  f.discovery.find.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.manager.run(5, f.request, f.send); f.manager.disposeOwner(5);
  finish({ selected: { path: '/python' }, environment: { env: {} } }); await pending;
  expect(mocks.spawn).not.toHaveBeenCalled(); f.close();
});
test('bridge failure is reported once and stale process events cannot affect the replacement', async () => {
  const f = fixture(); await f.manager.run(5, f.request, f.send);
  f.event({ type: 'state', state: 'failed', message: 'Missing ipykernel' });
  f.child.emit('exit', 1);
  expect(f.events.filter(e => e.type === 'state' && e.state === 'failed')).toHaveLength(1);
  expect(f.events.at(-1)).toMatchObject({ type: 'state', state: 'failed', message: 'Missing ipykernel' }); f.close();
});
