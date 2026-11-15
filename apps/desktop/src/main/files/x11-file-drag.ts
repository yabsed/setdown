import type { NativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

/**
 * Whether a folder tab's file drag needs Setdown's own XDND source
 * (x11-file-drag.py) instead of Chromium's. On a Wayland desktop Setdown is an
 * XWayland client, and Chromium's X11 drag source reaches no native Wayland
 * application: it never finds the compositor's XDND proxy window and speaks
 * from a window that does not own the drag selection. A plain X11 session keeps
 * Chromium's source. `SETDOWN_X11_FILE_DRAG=1|0` forces the choice (tests).
 */
export function needsX11FileDrag(platform: string, env: NodeJS.ProcessEnv, backend: string): boolean {
  if (platform !== 'linux' || !env.DISPLAY) return false;
  if (env.SETDOWN_X11_FILE_DRAG === '1' || env.SETDOWN_X11_FILE_DRAG === '0') return env.SETDOWN_X11_FILE_DRAG === '1';
  return backend === 'x11' && (!!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland');
}

export type X11FileDrag = {
  /** Settles when the drag is over. False: the source could not run and nothing was dragged. */
  done: Promise<boolean>;
  /** Abandon the drag (Escape, or the window closed). */
  cancel(): void;
};

export type DragPixels = { width: number; height: number; bgra: string };

/**
 * What follows the pointer, as the premultiplied BGRA rows an ARGB X11 window
 * shows: the window's own name tag, or else the file's icon.
 */
export function dragPixels(label: unknown, icon: NativeImage | null, scale: number): DragPixels | undefined {
  const tag = label as { width?: unknown; height?: unknown; rgba?: unknown } | null | undefined;
  if (tag && Number.isInteger(tag.width) && Number.isInteger(tag.height) && tag.rgba instanceof Uint8Array) {
    const width = tag.width as number, height = tag.height as number, rgba = tag.rgba;
    if (width > 0 && width <= 1024 && height > 0 && height <= 256 && rgba.length === width * height * 4) {
      const bgra = Buffer.alloc(rgba.length);
      for (let index = 0; index < rgba.length; index += 4) {
        const alpha = rgba[index + 3];
        bgra[index] = Math.round(rgba[index + 2] * alpha / 255); bgra[index + 1] = Math.round(rgba[index + 1] * alpha / 255);
        bgra[index + 2] = Math.round(rgba[index] * alpha / 255); bgra[index + 3] = alpha;
      }
      return { width, height, bgra: bgra.toString('base64') };
    }
  }
  if (!icon || icon.isEmpty()) return undefined;
  const side = Math.min(256, Math.round(32 * Math.max(1, scale)));
  const image = icon.getSize().width === side ? icon : icon.resize({ width: side, height: side, quality: 'best' });
  const { width, height } = image.getSize(), pixels = image.toBitmap();
  return pixels.length === width * height * 4 ? { width, height, bgra: pixels.toString('base64') } : undefined;
}

export function startX11FileDrag(paths: string[], icon: DragPixels | undefined): X11FileDrag {
  const script = path.join(__dirname, 'x11-file-drag.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const child = spawn('/usr/bin/python3', ['-I', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  // "started" or "released" means the source answered for this press; anything
  // less (no Python, no Xlib, no display) leaves the drag to Chromium's source.
  let answered = false;
  const done = new Promise<boolean>(resolve => {
    child.once('error', error => { console.error('Could not start the X11 file drag:', error.message); resolve(false); });
    child.once('close', () => resolve(answered));
  });
  createInterface({ input: child.stdout }).on('line', line => {
    try { if (['started', 'released'].includes(JSON.parse(line).state)) answered = true; } catch { /* Not a status line. */ }
  });
  child.stderr.on('data', chunk => console.error('X11 file drag:', String(chunk).trim()));
  child.stdin.on('error', () => { /* The source already exited. */ });
  child.stdin.write(`${JSON.stringify({ paths, icon })}\n`);
  return { done, cancel: () => { if (child.exitCode === null && !child.killed) child.stdin.write('cancel\n'); } };
}
