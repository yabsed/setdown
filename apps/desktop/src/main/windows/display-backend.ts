/** Electron 44's Ozone Wayland drag transport can leave the compositor's
 * accepted action at NONE after the renderer accepts a drop. Releasing without
 * another physical motion then cancels it. Prefer XWayland where available until
 * that upstream path is fixed; never require X11 on a Wayland-only session or
 * override an explicit --ozone-platform choice. */
export function displayBackend(platform: string, env: NodeJS.ProcessEnv, requested: string): string {
  if (requested && requested !== 'auto') return requested;
  if (platform === 'linux' && env.DISPLAY && (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland')) return 'x11';
  return requested;
}

export function hasGlobalWindowPositions(platform: string, env: NodeJS.ProcessEnv, backend: string): boolean {
  if (platform !== 'linux' || backend === 'x11') return true;
  return backend !== 'wayland' && !env.WAYLAND_DISPLAY && !env.WAYLAND_SOCKET && env.XDG_SESSION_TYPE !== 'wayland';
}
