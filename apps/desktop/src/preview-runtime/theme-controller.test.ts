import { afterEach, expect, test, vi } from 'vitest';
import type { SourceAtlas } from './source-atlas';
import { ThemeController } from './theme-controller';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const urls = ['marktex-resource://file/styles/preview_theme/night.css',
    'marktex-resource://file/styles/prism_theme/darcula.css'];
  const body = { scrollTop: 300, dataset: {} as Record<string, string>, style: { setProperty: vi.fn() } };
  const frames: FrameRequestCallback[] = [];
  const styles: Array<{ id: string; textContent: string; remove(): void }> = [];
  vi.stubGlobal('document', {
    visibilityState: 'visible', body,
    documentElement: { scrollTop: 300, scrollHeight: 2000, style: { setProperty: vi.fn() } },
    querySelectorAll: () => urls.map(href => ({ href })),
    getElementById: (id: string) => styles.find(style => style.id === id),
    createElement: () => { const style = { id: '', textContent: '', remove: () => styles.splice(styles.indexOf(style), 1) }; return style; },
    head: { append: (style: typeof styles[number]) => styles.push(style) },
  });
  vi.stubGlobal('window', { innerHeight: 600, requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback) });
  const sourceAtlas = { viewportAnchorAt: () => ({ sourceLine: 15, yRatio: .372 }),
    position: vi.fn(), invalidate: vi.fn() };
  const send = vi.fn();
  const controller = new ThemeController({ sourceAtlas: sourceAtlas as unknown as SourceAtlas,
    revision: () => 3, send, viewportChanged: vi.fn() });
  return { controller, sourceAtlas, body, frames, send, urls, styles };
}

test('VS Code reader colors apply while hidden and retire when returning to an existing theme', async () => {
  const f = fixture();
  f.controller.initialize('vscode-dark-2026');
  expect(f.body.dataset.previewTheme).toBe('dark');
  expect(f.styles).toHaveLength(1); expect(f.styles[0].textContent).toContain('#121314');
  await f.controller.apply('vscode-dark-2026', f.urls[0], f.urls[1], true);
  expect(f.styles).toHaveLength(1); expect(f.frames).toHaveLength(0);
  await f.controller.apply('night', f.urls[0], f.urls[1], true);
  expect(f.styles).toHaveLength(0);
  expect(f.body.dataset.setdownPreviewTheme).toBe('night');
  expect(f.sourceAtlas.position).toHaveBeenCalledWith(15, .372);
});

test('native hidden theme completion does not wait for frames when DOM visibility says visible', async () => {
  const f = fixture();
  await f.controller.apply('night', f.urls[0], f.urls[1], true);
  expect(f.frames).toHaveLength(0);
  expect(f.sourceAtlas.position).toHaveBeenCalledWith(15, .372);
  expect(f.body.dataset.setdownPreviewTheme).toBe('night');
  expect(f.send).toHaveBeenCalledWith({ type: 'marktex:theme-applied', revision: 3, themeId: 'night' });
});

test('visible themes settle their reading anchor on real presentation frames', async () => {
  const f = fixture();
  const applied = f.controller.apply('night', f.urls[0], f.urls[1], false);
  await vi.waitFor(() => expect(f.frames).toHaveLength(1));
  expect(f.send).not.toHaveBeenCalled();
  f.frames.shift()!(0);
  await vi.waitFor(() => expect(f.frames).toHaveLength(1));
  expect(f.send).not.toHaveBeenCalled();
  f.frames.shift()!(0);
  await applied;
  expect(f.sourceAtlas.position).toHaveBeenCalledTimes(2);
  expect(f.body.dataset.setdownPreviewTheme).toBe('night');
  expect(f.send).toHaveBeenCalledWith({ type: 'marktex:theme-applied', revision: 3, themeId: 'night' });
});
