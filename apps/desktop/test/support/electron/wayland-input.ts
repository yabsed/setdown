import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

function requirePrivateDisplay() {
  if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || (process.env.DISPLAY && process.env.SETDOWN_TEST_DISPLAY !== 'xwayland')
    || !process.env.XDG_RUNTIME_DIR?.startsWith('/tmp/setdown-display-runtime.')
    || !process.env.WAYLAND_DISPLAY) throw Error('Private Wayland display required');
}

/**
 * Scale the private compositor's monitor, as a HiDPI desktop does. X11 clients
 * then work in coordinates larger than the compositor's own. Returns the
 * monitor's width in the compositor's coordinates.
 */
export async function setMonitorScale(scale: number): Promise<number> {
  requirePrivateDisplay();
  const call = async (method: string, ...parameters: string[]) => (await promisify(execFile)('gdbus', ['call', '--session',
    '--dest', 'org.gnome.Mutter.DisplayConfig', '--object-path', '/org/gnome/Mutter/DisplayConfig',
    '--method', `org.gnome.Mutter.DisplayConfig.${method}`, ...parameters])).stdout;
  const state = await call('GetCurrentState');
  const serial = /^\(uint32 (\d+)/.exec(state)?.[1], connector = /\(\('([^']+)'/.exec(state)?.[1];
  const mode = /\[\('([^']+)', (\d+), \d+/.exec(state);
  if (!serial || !connector || !mode) throw Error('Unreadable monitor state');
  await call('ApplyMonitorsConfig', serial, '1', `[(0, 0, ${scale}, uint32 0, true, [('${connector}', '${mode[1]}', {})])]`, '{}');
  if (!(await call('GetCurrentState')).includes(`[(0, 0, ${scale}`)) throw Error(`Monitor scale ${scale} was not applied`);
  return Math.round(Number(mode[2]) / scale);
}

/** Native compositor input, confined to the runner's private headless display. */
export async function waylandInput() {
  requirePrivateDisplay();
  const processInput = spawn('/usr/bin/python3', [fileURLToPath(new URL('./wayland-input.py', import.meta.url))],
    { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: processInput.stdout })[Symbol.asyncIterator]();
  async function response() {
    const line = await lines.next();
    if (line.done) throw Error('Wayland input broker exited');
    const reply = JSON.parse(line.value);
    if (reply.error) throw Error(reply.error);
    return reply;
  }
  try {
    if (!(await response()).ready) throw Error('Wayland input broker not ready');
  } catch (error) { processInput.kill(); throw error; }
  return {
    async send(input: { click?: { x: number; y: number }; pointer?: { x: number; y: number }[];
      button?: 'down' | 'up'; keys?: string[]; keyDown?: string[]; keyUp?: string[]; pointerIntervalMs?: number;
      resetPointer?: boolean }) {
      processInput.stdin.write(JSON.stringify(input) + '\n'); await response();
    },
    async close() {
      if (processInput.exitCode !== null || processInput.signalCode !== null) return;
      const exited = new Promise<void>(resolve => processInput.once('exit', () => resolve()));
      processInput.stdin.end(); await exited;
    },
  };
}
