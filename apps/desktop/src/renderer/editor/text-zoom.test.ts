import { expect, test, vi } from 'vitest';
import type { ZoomSnapshot } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';

test('one tab factor reaches editors and terminals without coupling tabs or accepting stale snapshots', async () => {
  vi.resetModules();
  const { installTextZoom, textZoomOptions, terminalZoomFactor, onTextZoom, onTerminalZoom } = await import('./text-zoom');
  let publish!: (value: ZoomSnapshot) => void;
  let initial!: (value: ZoomSnapshot) => void;
  const off = installTextZoom({
    onZoomChanged: callback => { publish = callback; return () => {}; },
    getZoom: () => new Promise(resolve => { initial = resolve; }),
  } as DesktopPort);
  const text = vi.fn(), terminal = vi.fn();
  const unsubscribe = [onTextZoom(text), onTerminalZoom(terminal)];
  try {
    publish({ app: 100, text: 100, terminal: 100, revision: 2, tabs: { one: 120 } });
    expect(text).toHaveBeenCalledExactlyOnceWith('one');
    expect(terminal).toHaveBeenCalledExactlyOnceWith('one');
    initial({ app: 100, text: 100, terminal: 100, revision: 0 });
    await Promise.resolve();
    expect(textZoomOptions('one')).toEqual({ fontSize: 16.8, lineHeight: 26.4 });
    expect(terminalZoomFactor('one')).toBe(1.2);
    expect(textZoomOptions('new').fontSize).toBe(14);
    publish({ app: 100, text: 100, terminal: 100, revision: 3, tabs: { one: 120, review: 150 } });
    expect(textZoomOptions('git-diff:review:a').fontSize).toBe(21);
    expect(textZoomOptions('git-diff:review:b').fontSize).toBe(21);
    expect(textZoomOptions('one').fontSize).toBe(16.8);
    expect(text.mock.calls).toEqual([['one'], ['review']]);
  } finally { off(); unsubscribe.forEach(dispose => dispose()); }
});

test('cursor zoom applies immediately, ignores old acknowledgments and resumes external updates after the latest reply', async () => {
  vi.resetModules();
  const { TabZoom } = await import('./tab-zoom');
  const { installTextZoom } = await import('./text-zoom');
  let publish!: (value: ZoomSnapshot) => void;
  const off = installTextZoom({ onZoomChanged: callback => { publish = callback; return () => {}; },
    getZoom: async () => ({ app: 100, text: 100, terminal: 100, revision: 0 }),
  } as DesktopPort);
  const replies: ((percent: number) => void)[] = [];
  const send = vi.fn(() => new Promise<number>(resolve => replies.push(resolve)));
  const changed = vi.fn();
  const zoom = new TabZoom('one', { setTabZoom: send }, changed);
  const snapshot = (revision: number, percent: number) => publish({ app: 100, text: 100, terminal: 100, revision, tabs: { one: percent } });
  try {
    zoom.change(1); zoom.change(1);
    expect(zoom.factor).toBe(1.2);
    expect(send.mock.calls.length).toBe(2);
    snapshot(1, 110); replies[0](110); await Promise.resolve();
    expect(zoom.factor).toBe(1.2);
    snapshot(2, 120); snapshot(3, 150); replies[1](120); await Promise.resolve();
    expect(zoom.factor).toBe(1.5);
    expect(changed.mock.calls.map(([factor]) => factor)).toEqual([1.1, 1.2, 1.5]);
    zoom.change({ percent: 175 }); zoom.dispose(); replies[2](175); await Promise.resolve();
    snapshot(4, 200); expect(zoom.factor).toBe(1.75);
  } finally { zoom.dispose(); off(); }
});
