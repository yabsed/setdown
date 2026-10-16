import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookDocument, emptyNotebook } from '../../core/notebook/notebook-document';
import type { NotebookApi, NotebookKernelEvent, NotebookRun } from '../../protocol/notebook';
import { NotebookExecution } from './notebook-execution';

function fixture() {
  const document = new NotebookDocument(emptyNotebook()), a = document.add('code'), markdown = document.add('markdown'), b = document.add('code');
  document.setSource(a, 'numbers = [1, 2, 3]'); document.setSource(b, 'print(sum(numbers))');
  let listener: (event: NotebookKernelEvent) => void = () => {};
  const port: NotebookApi = { copyOutput: vi.fn(async () => {}), environments: vi.fn(async () => ({ candidates: [], selected: "/usr/bin/python3" })), selectPython: vi.fn(async () => {}), run: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), shutdown: vi.fn(),
    choosePython: vi.fn(async () => '/opt/venv/bin/python'), onEvent: callback => { listener = callback; return () => { listener = () => {}; }; } };
  const execution = new NotebookExecution(port, document, 'notebook', '/workspace/example.ipynb');
  const request = () => vi.mocked(port.run).mock.calls.at(-1)![0];
  const send = (event: Record<string, unknown>, identity: NotebookRun = request()) => listener({ id: 'notebook', generation: identity.generation, ...event } as NotebookKernelEvent);
  const output = (kind: string, content: object, cell = a) => send({ type: 'output', cell, version: document.cells.find(c => c.id === cell)!.version, kind, content });
  return { document, a, b, markdown, port, execution, request, send, output };
}
afterEach(() => vi.useRealTimers());
describe('notebook execution ownership', () => {
  it('starts only on request, queues cells in visible order and coalesces queued reruns', async () => {
    const f = fixture(); expect(f.port.run).not.toHaveBeenCalled();
    f.document.moveBefore(f.b, f.a); await f.execution.run();
    expect(f.request().cells.map(c => c.id)).toEqual([f.b]);
    expect(f.execution.cells.get(f.a)).toBe('queued');
    await f.execution.run([f.a]); expect(f.port.run).toHaveBeenCalledTimes(1);
    f.send({ type: 'state', state: 'idle' });
    expect(f.port.run).toHaveBeenCalledTimes(2);
    expect(f.request().cells.map(c => c.id)).toEqual([f.a]); f.execution.dispose();
  });
  it('batches stream output, implements clear(wait), and saves counts without damaging Markdown', async () => {
    vi.useFakeTimers(); const f = fixture(), markdown = f.document.cells[1];
    await f.execution.run([f.a]); const version = f.request().cells[0].version;
    f.send({ type: 'cell-start', cell: f.a, version });
    f.output('stream', { name: 'stdout', text: 'first' }); f.output('stream', { name: 'stdout', text: ' line\n' });
    vi.advanceTimersByTime(50);
    expect(f.document.cells[0].outputs).toEqual([{ output_type: 'stream', name: 'stdout', text: 'first line\n' }]);
    f.output('clear_output', { wait: true }); vi.advanceTimersByTime(50);
    expect(f.document.cells[0].outputs).toHaveLength(1);
    f.output('execute_result', { data: { 'text/plain': '6' }, metadata: {}, execution_count: 3 });
    f.send({ type: 'cell-done', cell: f.a, version, ok: true, count: 3 });
    const saved = JSON.parse(f.document.serialize());
    expect(saved.cells[0].execution_count).toBe(3); expect(saved.cells[0].outputs).toHaveLength(1);
    expect(saved.cells[0].outputs[0].output_type).toBe('execute_result'); expect(f.document.cells[1]).toBe(markdown);
    f.execution.dispose();
  });
  it('updates display IDs across cells and never persists transient display handles', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.execution.run();
    for (const id of [f.a, f.b]) {
      f.output('display_data', { data: { 'text/plain': 'old' }, transient: { display_id: 'shared' } }, id);
      f.send({ type: 'cell-done', cell: id, version: f.request().cells[0].version, count: 1, ok: true });
      f.send({ type: 'state', state: 'idle' });
    }
    f.output('update_display_data', { data: { 'text/plain': 'new' }, transient: { display_id: 'shared' } }, f.b);
    vi.advanceTimersByTime(50);
    for (const cell of f.document.cells.filter(c => c.kind === 'code')) {
      expect(cell.outputs).toEqual([{ output_type: 'display_data', data: { 'text/plain': 'new' }, metadata: {} }]);
    }
    f.execution.dispose();
  });
  it('keeps executed source identity after edits/reorder, drops deleted cells and stale generations', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.execution.run(); const old = f.request(), version = old.cells[0].version;
    const source = f.document.cells[0].source; f.document.setSource(f.a, 'new source'); f.document.moveBefore(f.a);
    f.send({ type: 'output', cell: f.a, version, kind: 'stream', content: { name: 'stdout', text: 'old result' } });
    vi.advanceTimersByTime(50); expect(f.document.cells.at(-1)?.executedSource).toBe(source);
    f.document.remove(f.a); const revision = f.document.revision;
    f.send({ type: 'cell-done', cell: f.a, version, count: 1, ok: true }); expect(f.document.revision).toBe(revision);
    f.execution.shutdown(); await f.execution.run([f.b]);
    f.send({ type: 'state', state: 'failed', message: 'old kernel' }, old);
    expect(f.execution.state).toBe('starting'); expect(f.execution.message).toBe(''); f.execution.dispose();
  });
  it('interrupts a running kernel and releases pending startup/changed path/closed notebook', async () => {
    const f = fixture(); await f.execution.run(); f.send({ type: 'state', state: 'busy' });
    await f.execution.interrupt(); expect(f.port.interrupt).toHaveBeenCalledWith('notebook', f.request().generation);
    f.execution.setPath('/new/location.ipynb'); expect(f.port.shutdown).toHaveBeenCalledTimes(1);
    await f.execution.run(); expect(f.request().path).toBe('/new/location.ipynb');
    await f.execution.interrupt(); expect(f.execution.state).toBe('stopped');
    await f.execution.choosePython(); await f.execution.run(); expect(f.request().python).toBe('/opt/venv/bin/python');
    f.execution.dispose(); const calls = vi.mocked(f.port.run).mock.calls.length;
    await f.execution.run(); expect(f.port.run).toHaveBeenCalledTimes(calls);
  });
});

  it('failure skips remaining queued cells; interrupt cancels them without losing completed outputs', async () => {
    const f = fixture(); await f.execution.run(); const first = f.request();
    f.send({ type: 'state', state: 'busy' });
    f.send({ type: 'cell-start', cell: f.a, version: first.cells[0].version, runId: first.cells[0].runId });
    f.send({ type: 'cell-done', cell: f.a, version: first.cells[0].version, runId: first.cells[0].runId, count: 1, ok: false });
    f.send({ type: 'state', state: 'idle' });
    expect(f.execution.cells.get(f.a)).toBe('error'); expect(f.execution.cells.get(f.b)).toBe('skipped'); expect(f.port.run).toHaveBeenCalledTimes(1);
    await f.execution.run([f.a]); f.send({ type: 'state', state: 'busy' }); await f.execution.run([f.b]);
    await f.execution.interrupt(); expect(f.execution.cells.get(f.b)).toBe('canceled');
    f.send({ type: 'cell-done', cell: f.a, version: first.cells[0].version, runId: first.cells[0].runId, count: 99, ok: true });
    expect(f.document.cells[0].executionCount).not.toBe(99);
    f.execution.dispose();
  });

it('canceling startup while the saved environment is loading cannot launch a late kernel', async () => {
  const f = fixture(); let resolve!: (value: { candidates: []; selected: string }) => void;
  vi.mocked(f.port.environments).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const starting = f.execution.run();
  expect(f.execution.state).toBe('starting'); f.execution.shutdown();
  resolve({ candidates: [], selected: '/saved/environment/python' }); await starting;
  expect(f.port.run).not.toHaveBeenCalled(); expect(f.execution.state).toBe('stopped'); f.execution.dispose();
});
