import { expect, test, vi } from 'vitest';
import { PreviewRenderer } from './preview-renderer';
import type { WindowState } from '../windows/window-state';
vi.mock('electron', () => ({ utilityProcess: {} }));
const result = { totalLineCount: 2, baseHref: 'file:///project/', themeId: 'github-light', patch: null };
function fixture() {
  const events: string[] = [];
  const view = { webContents: { getURL: () => 'marktex-preview://document/live', send: vi.fn() }, setBackgroundColor: vi.fn() };
  const previews = { views: new Map([['tab', { ownerWebContentsId: 1, view }]]), syncTheme: vi.fn() };
  const renderer = new PreviewRenderer({ previews, roots: () => ['/project'], theme: () => 'github-light', workerPath: '/tmp/unused-worker.cjs' } as unknown as ConstructorParameters<typeof PreviewRenderer>[0]);
  const internal = renderer as unknown as { render: (...args: unknown[]) => Promise<typeof result>; worker: { postMessage(message: unknown): void } };
  internal.worker = { postMessage: () => events.push('forget') };
  const render = vi.spyOn(internal, 'render').mockImplementation(async () => { events.push('render'); return result; });
  const state = { currentDocument: { path: '/project/current.md', name: 'current.md', text: 'latest', revision: 9 }, activeRoot: '/project',
    rendererTabs: [{ path: '/project/background.md' }, { path: '/project/current.md' }] } as unknown as WindowState;
  return { renderer, render, state, events };
}
test('owned background preparation preserves the foreground document and root', async () => {
  const f = fixture(), document = f.state.currentDocument;
  await f.renderer.prepare(f.state, 'tab', 'background', 0, '/project/background.md', 'github-light', 1);
  expect(f.state.currentDocument).toBe(document);
  expect(f.state.activeRoot).toBe('/project');
});
test('queued older preparation cannot roll back the current text revision', async () => {
  const f = fixture();
  await f.renderer.prepare(f.state, 'tab', 'old text', 8, '/project/current.md', 'github-light', 1);
  expect(f.state.currentDocument).toMatchObject({ text: 'latest', revision: 9 });
});
test('superseded uninstalled worker history is cleared before the next render', async () => {
  const f = fixture(); let release!: (value: typeof result) => void;
  f.render.mockImplementationOnce(() => { f.events.push('first'); return new Promise(resolve => { release = resolve; }); });
  const first = f.renderer.prepare(f.state, 'tab', 'old', 10, '/project/current.md', 'github-light', 1);
  await Promise.resolve(); await Promise.resolve();
  const rejected = expect(first).rejects.toThrow('changed');
  const next = f.renderer.prepare(f.state, 'tab', 'new', 11, '/project/current.md', 'github-light', 1);
  expect(f.render).toHaveBeenCalledTimes(1);
  release(result); await rejected; await next;
  expect(f.events).toEqual(['first', 'forget', 'render']);
  expect(f.state.currentDocument).toMatchObject({ text: 'new', revision: 11 });
});
test('a different owner cannot supersede a pending owned render', async () => {
  const f = fixture(); let release!: (value: typeof result) => void;
  f.render.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const own = f.renderer.prepare(f.state, 'tab', 'owned', 10, '/project/current.md', 'github-light', 1);
  await Promise.resolve(); await Promise.resolve();
  await expect(f.renderer.prepare(f.state, 'tab', 'foreign', 11, '/project/current.md', 'github-light', 2)).rejects.toThrow('owned');
  release(result); await own;
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.state.currentDocument).toMatchObject({ text: 'owned', revision: 10 });
});
