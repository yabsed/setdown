import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Whether a Pyright server can run its background analysis thread, which the cancellation
// argument turns on (`python-cancellation.ts`, server.ts `createBackgroundAnalysis`).
//
// The thread is started with `new Worker(__filename)` and has to arrive at the server's own
// entry (vendor/pyright/packages/pyright-internal/src/backgroundAnalysis.ts, nodeServer.ts `run`).
// That holds for the server of the VS Code extension and for basedpyright's npm package, which
// are one file each. Pyright's npm package is built in parts: the thread loads a part that
// starts nothing and ends at once ("Background thread exited with code: 0"), and the server then
// never finishes an analysis: no diagnostics, measured with pyright 1.1.414. Its own entry says
// "Command line version doesn't use any worker threads" (packages/pyright/src/langserver.ts).
//
// So the argument is given only to a server whose files were looked at:
//   `own`       the entry holds the code that starts the thread; nothing is added
//   `redirect`  another part holds it; Node loads `pyright-thread-entry.cjs` first, which gives
//               the thread the server's entry, as the extension's server does
//   none        anything else, and any program a person chose: such a server is cancelled by
//               message and analyses on its one thread, as it did before

export type PyrightThread = { nodeArguments: string[] };
const startsThread = /Worker\(__filename\b/;
const plans = new Map<string, Promise<PyrightThread | undefined>>();

/** scripts/build-electron.mjs copies the file beside the main bundle; in the source tree it lies beside this one. */
function entryFile(): string | undefined {
  const file = path.join(__dirname, 'pyright-thread-entry.cjs').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  return existsSync(file) ? file : undefined;
}

async function plan(script: string, preload: string | undefined): Promise<PyrightThread | undefined> {
  const dist = path.join(path.dirname(script), 'dist'), entry = path.join(dist, 'pyright-langserver.js');
  const holds = async (file: string) => { try { return (await stat(file)).size < 64 * 1024 * 1024 && startsThread.test(await readFile(file, 'utf8')); } catch { return false; } };
  if (await holds(entry)) return { nodeArguments: [] };
  if (!preload) return undefined;
  for (const name of (await readdir(dist).catch(() => [])).filter(name => name.endsWith('.js') && name !== path.basename(entry)).slice(0, 32))
    if (await holds(path.join(dist, name))) return { nodeArguments: ['-r', preload] };
  return undefined;
}

/** How the server of this launch runs its background thread, or nothing when it is not known to.
 * Only a server Setdown starts itself with its own Node is looked at: `node <package>/langserver.index.js`. */
export function pyrightThread(launch: { executable: string; args: readonly string[] }, entry: () => string | undefined = entryFile): Promise<PyrightThread | undefined> {
  const script = launch.args[0], preload = entry();
  if (launch.executable !== process.execPath || typeof script !== 'string' || !path.isAbsolute(script) || path.basename(script) !== 'langserver.index.js') return Promise.resolve(undefined);
  const key = `${script}\0${preload ?? ''}`;
  let found = plans.get(key);
  if (!found) plans.set(key, found = plan(script, preload));
  return found;
}
