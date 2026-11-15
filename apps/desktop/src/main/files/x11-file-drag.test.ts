import { expect, test } from 'vitest';
import { dragPixels, needsX11FileDrag } from './x11-file-drag';

test('only an X11 Setdown window on a Wayland desktop drags files through its own XDND source', () => {
  const wayland = { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' };
  expect(needsX11FileDrag('linux', wayland, 'x11')).toBe(true);
  expect(needsX11FileDrag('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }, 'x11')).toBe(true);
  // A native Wayland window has a Wayland drag source; an X11 session has only X11 drop targets.
  expect(needsX11FileDrag('linux', wayland, 'wayland')).toBe(false);
  expect(needsX11FileDrag('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, 'x11')).toBe(false);
  expect(needsX11FileDrag('linux', { DISPLAY: ':0' }, '')).toBe(false);
  expect(needsX11FileDrag('linux', { WAYLAND_DISPLAY: 'wayland-0' }, 'x11')).toBe(false);
  expect(needsX11FileDrag('darwin', wayland, 'x11')).toBe(false);
  expect(needsX11FileDrag('win32', wayland, 'x11')).toBe(false);
  // An explicit choice wins on Linux with an X display.
  expect(needsX11FileDrag('linux', { DISPLAY: ':99', SETDOWN_X11_FILE_DRAG: '1' }, '')).toBe(true);
  expect(needsX11FileDrag('linux', { ...wayland, SETDOWN_X11_FILE_DRAG: '0' }, 'x11')).toBe(false);
  expect(needsX11FileDrag('darwin', { ...wayland, SETDOWN_X11_FILE_DRAG: '1' }, 'x11')).toBe(false);
});

test('the window\'s name tag becomes premultiplied BGRA; a malformed one is not trusted', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 200, 100, 128]);
  const pixels = dragPixels({ width: 2, height: 1, rgba }, null, 1)!;
  expect(pixels).toMatchObject({ width: 2, height: 1 });
  expect([...Buffer.from(pixels.bgra, 'base64')]).toEqual([0, 0, 255, 255, 50, 100, 0, 128]);
  expect(dragPixels({ width: 3, height: 1, rgba }, null, 1)).toBeUndefined();
  expect(dragPixels({ width: 2, height: 1, rgba: [...rgba] }, null, 1)).toBeUndefined();
  expect(dragPixels({ width: 4096, height: 4096, rgba: new Uint8Array(4) }, null, 1)).toBeUndefined();
  expect(dragPixels(undefined, null, 2)).toBeUndefined();
});
