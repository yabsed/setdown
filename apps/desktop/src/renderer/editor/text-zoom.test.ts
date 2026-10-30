import { expect, test, vi } from 'vitest';
import type { ZoomSnapshot } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';

test('new code files use the shared preference; unrelated surfaces and stale snapshots cannot reset it', async () => {
  vi.resetModules();
  const { installTextZoom, textZoomOptions, onCodeZoom, onTextZoom, onTerminalZoom, usesCodeZoom } = await import('./text-zoom');
  let publish!: (value: ZoomSnapshot) => void;
  let initial!: (value: ZoomSnapshot) => void;
  const off = installTextZoom({
    onZoomChanged: callback => { publish = callback; return () => {}; },
    getZoom: () => new Promise(resolve => { initial = resolve; }),
  } as DesktopPort);
  const code = vi.fn(), text = vi.fn(), terminal = vi.fn();
  const unsubscribe = [onCodeZoom(code), onTextZoom(text), onTerminalZoom(terminal)];
  try {
    publish({ app: 100, text: 100, terminal: 100, code: 125, revision: 2 });
    expect(code).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled(); expect(terminal).not.toHaveBeenCalled();
    initial({ app: 100, text: 100, terminal: 100, revision: 0 });
    await Promise.resolve();
    for (const path of ['first.ts', 'second.py', 'notes.txt', 'Makefile']) {
      expect(textZoomOptions(crypto.randomUUID(), path)).toEqual({ fontSize: 17.5, lineHeight: 27.5 });
    }
    for (const path of ['doc.md', 'cells.ipynb', 'image.png', 'doc.pdf', 'video.mp4']) {
      expect(usesCodeZoom(path)).toBe(false);
      expect(textZoomOptions('other', path).fontSize).toBe(14);
    }
    publish({ app: 100, text: 100, terminal: 100, code: 125, revision: 3, tabs: { markdown: 150, oldCode: 200 } });
    expect(textZoomOptions('markdown', 'doc.md').fontSize).toBe(21);
    expect(textZoomOptions('oldCode', 'first.ts').fontSize).toBe(17.5);
    expect(textZoomOptions('oldCode', 'doc.md').fontSize).toBe(28);
    expect(code).toHaveBeenCalledOnce();
  } finally { off(); unsubscribe.forEach(dispose => dispose()); }
});
