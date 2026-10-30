import { expect, test } from 'vitest';
import { electronLaunchOptions } from './options';

const wayland = { DISPLAY: ':9', WAYLAND_DISPLAY: 'private', XDG_SESSION_TYPE: 'wayland' };
test('preselects the existing XWayland policy before launching Electron', () => {
  expect(electronLaunchOptions('linux', wayland, ['.']).args).toEqual(['--ozone-platform=x11', '.']);
  expect(electronLaunchOptions('linux', wayland, ['.', '--ozone-platform=auto', 'file.md']).args).toEqual(['--ozone-platform=x11', '.', 'file.md']);
  expect(electronLaunchOptions('linux', wayland, ['--ozone-platform', 'auto', '.']).args).toEqual(['--ozone-platform=x11', '.']);
});
test('preserves explicit choices, native X11, Wayland-only and non-Linux launches', () => {
  for (const args of [['.', '--ozone-platform=wayland'], ['--ozone-platform', 'headless', '.'], ['--ozone-platform=x11', '.']])
    expect(electronLaunchOptions('linux', wayland, args).args).toEqual(args);
  expect(electronLaunchOptions('linux', { WAYLAND_DISPLAY: 'private' }, ['.']).args).toEqual(['.']);
  expect(electronLaunchOptions('linux', { DISPLAY: ':9' }, ['.']).args).toEqual(['.']);
  for (const platform of ['darwin', 'win32']) expect(electronLaunchOptions(platform, wayland, ['.']).args).toEqual(['.']);
});
test('removes the Node-only flag without mutating caller arguments or environment', () => {
  const env = { ...wayland, ELECTRON_RUN_AS_NODE: '1', VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }, args = ['.'];
  const launch = electronLaunchOptions('linux', env, args);
  expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(launch.env.VITE_DEV_SERVER_URL).toBe(env.VITE_DEV_SERVER_URL);
  expect(env.ELECTRON_RUN_AS_NODE).toBe('1'); expect(args).toEqual(['.']);
});
