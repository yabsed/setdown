import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Native compositor input, confined to the runner's private headless display. */
export async function waylandInput() {
  if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || (process.env.DISPLAY && process.env.SETDOWN_TEST_DISPLAY !== 'xwayland')
    || !process.env.XDG_RUNTIME_DIR?.startsWith('/tmp/setdown-display-runtime.')
    || !process.env.WAYLAND_DISPLAY) throw Error('Private Wayland display required');
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
      button?: 'down' | 'up'; keys?: string[]; keyDown?: string[]; keyUp?: string[]; pointerIntervalMs?: number }) {
      processInput.stdin.write(JSON.stringify(input) + '\n'); await response();
    },
    async close() {
      if (processInput.exitCode !== null || processInput.signalCode !== null) return;
      const exited = new Promise<void>(resolve => processInput.once('exit', () => resolve()));
      processInput.stdin.end(); await exited;
    },
  };
}
