import { app, screen, type BrowserWindow, type WebContents, type WebContentsView } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

export type PinchSample = { type: 'begin' | 'update' | 'end'; device: number; scale: number; x: number; y: number; cancelled: boolean };

/** XI2 scale is absolute from gesture start; Chromium wheel zoom is incremental. */
export class PinchScale {
  private device: number | undefined;
  private scale = 1;
  consume(sample: PinchSample): number[] {
    if (sample.type === 'begin') { this.device = sample.device; this.scale = 1; return []; }
    if (sample.device !== this.device) return [];
    if (sample.type === 'end' || sample.cancelled) { this.device = undefined; return []; }
    if (!Number.isFinite(sample.scale) || sample.scale < .001 || sample.scale > 1000) return [];
    const delta = -100 * Math.log(sample.scale / this.scale);
    this.scale = sample.scale;
    // Keep every sample in the continuous pinch range, even after coalescing.
    const count = Math.ceil(Math.abs(delta) / 30);
    return count ? Array.from({ length: count }, () => delta / count) : [];
  }
}

/** Bridge the missing X11 gesture translation, scoped to our native window IDs.
 * Wayland/macOS/Windows keep Chromium's own gesture path. No input devices,
 * global hooks, synthetic Control key presses or focus changes are involved. */
export function installX11Pinch(): void {
  const children = new Set<ChildProcess>();
  app.on('browser-window-created', (_event, window) => {
    window.once('show', () => {
      if (window.isDestroyed()) return;
      const handle = window.getNativeWindowHandle();
      const xid = handle.length >= 8 ? Number(handle.readBigUInt64LE()) : handle.readUInt32LE();
      const script = path.join(__dirname, 'x11-pinch.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      const child = spawn('/usr/bin/python3', ['-I', script, String(xid)], { stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      child.on('error', error => console.error('Could not start X11 touchpad gestures:', error.message));
      child.once('exit', () => children.delete(child));
      // Drain errors without allowing a missing XI2 extension to stop the app.
      child.stderr.on('data', chunk => console.error('X11 touchpad gestures:', String(chunk).trim()));
      const scale = new PinchScale();
      let target: { contents: WebContents; x: number; y: number } | undefined;
      let device: number | undefined;
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        let input: PinchSample;
        try { input = JSON.parse(line); } catch { return; }
        if (!['begin', 'update', 'end'].includes(input.type) || !Number.isInteger(input.device)
          || ![input.x, input.y, input.scale].every(Number.isFinite)) return;
        if (input.type === 'begin') { target = pinchTarget(window, input); device = input.device; }
        const deltas = scale.consume(input);
        if (device !== input.device || !target) return;
        if (window.isDestroyed() || !window.isVisible() || !window.isFocused() || target.contents.isDestroyed()) { target = undefined; return; }
        // Electron's native wheel sign is opposite to DOM WheelEvent.deltaY.
        for (const deltaY of deltas) target.contents.sendInputEvent({ type: 'mouseWheel', x: target.x, y: target.y,
          deltaX: 0, deltaY: -deltaY * target.contents.getZoomFactor(), modifiers: ['control'], hasPreciseScrollingDeltas: true, canScroll: true });
        if (input.type === 'end') target = undefined;
      });
      window.once('closed', () => { lines.close(); child.kill(); children.delete(child); });
    });
  });
  app.once('will-quit', () => { for (const child of children) child.kill(); children.clear(); });
}

function pinchTarget(window: BrowserWindow, input: PinchSample) {
  if (window.isDestroyed()) return;
  const point = screen.screenToDipPoint({ x: Math.round(input.x), y: Math.round(input.y) });
  const bounds = window.getContentBounds(), x = point.x - bounds.x, y = point.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return;
  for (const view of [...window.contentView.children].reverse()) {
    if (!view.getVisible() || !('webContents' in view)) continue;
    const rect = view.getBounds();
    if (x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height)
      return { contents: (view as WebContentsView).webContents, x: Math.round(x - rect.x), y: Math.round(y - rect.y) };
  }
  return { contents: window.webContents, x: Math.round(x), y: Math.round(y) };
}
