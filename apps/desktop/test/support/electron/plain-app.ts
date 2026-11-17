import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const executablePath = createRequire(import.meta.url)('electron') as string;

/**
 * The application started as a person starts it, with no test driver on its views.
 *
 * Playwright attaches to every page of an application it launches and emulates focus in each
 * one, which keeps pages that are never shown rendering as if they were on screen. What such a
 * page does on its own can only be observed from outside it: this talks to the shell page
 * alone, over one DevTools socket, and leaves every other view of the process untouched.
 */
export async function launchPlain(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(executablePath, ['--remote-debugging-port=0', ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let output = '';
  const close = async () => {
    child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  };
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Electron opened no DevTools endpoint.\n${output}`)), 30_000);
      child.stderr.on('data', chunk => {
        output += chunk;
        const match = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(output);
        if (match) { clearTimeout(timer); resolve(`http://${match[1]}`); }
      });
      void exited.then(() => { clearTimeout(timer); reject(new Error(`Electron exited before its window opened.\n${output}`)); });
    });
    let shell: { webSocketDebuggerUrl: string } | undefined;
    for (let attempt = 0; attempt < 120 && !shell; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const targets = await fetch(`${endpoint}/json/list`).then(response => response.json() as Promise<Array<{ type: string; url: string; webSocketDebuggerUrl: string }>>).catch(() => []);
      // The window's own page: overlays load the same document with a query.
      shell = targets.find(target => target.type === 'page' && /\/dist\/index\.html$/.test(target.url));
    }
    if (!shell) throw new Error(`The application window did not open.\n${output}`);
    const socket = new WebSocket(shell.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('The shell page refused its DevTools socket.')); });
    let sequence = 0;
    const waiting = new Map<number, (message: { result?: { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }; error?: { message: string } }) => void>();
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      waiting.get(message.id)?.(message); waiting.delete(message.id);
    };
    return {
      /** Evaluate an expression in the shell page; a promise is awaited and its value returned by copy. */
      evaluate<T>(expression: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
          const id = ++sequence;
          waiting.set(id, message => {
            const failure = message.error?.message ?? message.result?.exceptionDetails?.exception?.description ?? message.result?.exceptionDetails?.text;
            if (failure) reject(new Error(failure)); else resolve(message.result?.result?.value as T);
          });
          socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
      },
      async close() { socket.close(); await close(); },
    };
  } catch (error) { await close(); throw error; }
}
