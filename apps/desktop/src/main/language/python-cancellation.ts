import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CancellationReceiverStrategy, CancellationStrategy, type CancellationSenderStrategy } from 'vscode-jsonrpc/node';

// Pyright checks for cancellation while it analyses, in the middle of one long computation. A
// `$/cancelRequest` message cannot reach it there: the message is read only when the computation
// gives the thread back. So Pyright's own client cancels through the file system. It starts the
// server with the name of a folder, and to cancel request 7 it creates the empty file
// `cancellation-7.tmp` in that folder. The server asks whether that file exists, at most once
// every 5 ms, from inside the computation. The rules in this file are carried over from:
//   vendor/pyright/packages/vscode-pyright/src/cancellationUtils.ts                       the client: folder, files, argument
//   vendor/pyright/packages/vscode-pyright/src/extension.ts                               where the client uses it
//   vendor/pyright/packages/pyright-internal/src/common/fileBasedCancellationUtils.ts     the server: how it finds the files
//   vendor/pyright/packages/pyright-internal/src/common/cancellationUtils.ts              `FileBasedToken`, `CancellationThrottle`
//   vendor/pyright/packages/pyright-internal/src/server.ts                                what else the argument turns on
//   vendor/vscode-python/src/client/activation/common/cancellationUtils.ts                the same client code, for Pylance
// basedpyright's client and server have the same code (vendor/basedpyright/packages/…).
//
// The argument does one more thing. `server.ts` `createBackgroundAnalysis` starts Pyright's
// background analysis thread exactly when a cancellation folder was named (and the process is not
// being debugged). A server started with `args` therefore checks files on a second thread, as it
// does in VS Code, and holds the project in memory twice.

/** `getCancellationFolderPath` on both sides: the folder, inside the temporary folder, that holds one folder per client. */
export const cancellationParentFolder = 'python-languageserver-cancellation';
/** The client's `getCancellationFilePath` and the server's `getCancellationFileUri`: the file that cancels request `id`. */
export const cancellationFileName = (id: string | number): string => `cancellation-${String(id)}.tmp`;
/** The client's `getCommandLineArguments`; the server reads it in `getCancellationStrategyFromArgv`. */
export const cancellationArgument = (name: string): string => `--cancellationReceive=file:${name}`;

/** What `os.tmpdir()` answers in a process started with this environment (Node's `lib/os.js`
 * `tmpdir`). Client and server each call `os.tmpdir()` and must arrive at the same folder. Setdown
 * starts a tool with the environment of the person's login shell, which may name another
 * temporary folder than Setdown's own, so the folder is the one the server will look in. */
export function temporaryFolderOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    // Windows finds a variable whatever the case of its name; a copied environment does not.
    const value = (name: string) => env[name] || Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    const folder = value('TEMP') || value('TMP') || `${value('SystemRoot') || value('windir')}\\temp`;
    return folder.length > 1 && folder.endsWith('\\') && folder.at(-2) !== ':' ? folder.slice(0, -1) : folder;
  }
  const folder = env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  return folder.length > 1 && folder.endsWith('/') ? folder.slice(0, -1) : folder;
}

export type PythonCancellation = {
  /** Appended to the server's arguments. */
  args: string[];
  /** The `cancellationStrategy` of the connection's options. */
  strategy: CancellationStrategy;
  /** Removes the folder and what is left in it. Called when the server has stopped. */
  dispose(): void;
};

const attempt = (action: () => void): void => { try { action(); } catch { /* As the client's `tryRun`: a cancellation that cannot be written is one that did not happen. */ } };

/** `FileBasedCancellationStrategy` of the Pyright client, for one server process.
 *
 * `temporaryFolder` is the folder the server's `os.tmpdir()` answers: `temporaryFolderOf` of the
 * environment the server is started with.
 *
 * The sender creates `cancellation-<id>.tmp` where the library would send `$/cancelRequest`, and
 * removes it when the request is answered. The receiver stays the library's own: the server cancels
 * its requests to the editor with `$/cancelRequest` (the server's `getCancellationStrategyFromArgv`
 * returns `sender: CancellationSenderStrategy.Message`).
 *
 * One thing differs from the client. It ignores a folder it cannot create and starts the server
 * with the argument all the same; nothing can then be cancelled. Here that case leaves the
 * argument out and cancels by message, as a server without the argument expects. */
export function pythonCancellation(temporaryFolder: string = os.tmpdir()): PythonCancellation {
  // `randomBytesHex(21)` in the Pyright client, `randomBytes(21).toString('hex')` in the Python extension.
  const name = randomBytes(21).toString('hex');
  const folder = path.join(temporaryFolder, cancellationParentFolder, name);
  try { mkdirSync(folder, { recursive: true }); }
  catch { return { args: [], strategy: CancellationStrategy.Message, dispose() { /* Nothing was made. */ } }; }
  // The library numbers its requests itself. A name that would leave the folder is not written.
  const file = (id: string | number): string | undefined => {
    const base = cancellationFileName(id);
    return path.basename(base) === base ? path.join(folder, base) : undefined;
  };
  const sender: CancellationSenderStrategy = {
    sendCancellation(_connection, id) {
      const target = file(id);
      if (target) attempt(() => writeFileSync(target, '', { flag: 'w' }));
      return Promise.resolve();
    },
    cleanup(id) {
      const target = file(id);
      if (target) attempt(() => unlinkSync(target));
    },
  };
  return {
    args: [cancellationArgument(name)],
    strategy: { receiver: CancellationReceiverStrategy.Message, sender },
    dispose() { attempt(() => rmSync(folder, { recursive: true, force: true })); },
  };
}
