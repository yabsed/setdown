import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { pyrightThread } from './pyright-thread';

const run = promisify(execFile);
const vendor = path.resolve(__dirname, '../../../../../vendor'), preload = path.join(__dirname, 'pyright-thread-entry.cjs');
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
/** A package laid out as Pyright's: an entry, and the code that starts the thread in `holder`. */
async function layout(holder: 'pyright-langserver.js' | 'pyright-internal.js' | undefined): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'setdown-pyright-thread-')); folders.push(folder);
  await mkdir(path.join(folder, 'dist'));
  const starts = 'const { Worker } = require("node:worker_threads"); exports.start = () => new Worker(__filename, { workerData: 1 });';
  // As nodeServer.ts `run`: the main thread starts the thread, and the thread answers that it runs.
  await writeFile(path.join(folder, 'langserver.index.js'), 'require("./dist/pyright-langserver");');
  await writeFile(path.join(folder, 'dist', 'pyright-langserver.js'), `const threads = require("node:worker_threads");
${holder === 'pyright-langserver.js' ? starts : holder ? 'exports.start = require("./pyright-internal").start;' : 'exports.start = () => undefined;'}
if (threads.isMainThread) { const worker = exports.start(); if (!worker) console.log("no thread"); else { worker.on("message", text => { console.log(text); worker.terminate(); }); worker.on("exit", () => console.log("thread ended")); } }
else threads.parentPort.postMessage("the thread runs the server's entry");`);
  if (holder === 'pyright-internal.js') await writeFile(path.join(folder, 'dist', 'pyright-internal.js'), starts);
  return path.join(folder, 'langserver.index.js');
}
const lines = async (script: string, node: string[]) => (await run(process.execPath, [...node, script], { timeout: 20_000 })).stdout.trim().split('\n');

test('the thread of a server built in parts is given the server\'s entry, and nothing else is changed', async () => {
  const parts = await layout('pyright-internal.js'), whole = await layout('pyright-langserver.js'), none = await layout(undefined);
  expect(await pyrightThread({ executable: process.execPath, args: [parts, '--stdio'] }, () => preload)).toEqual({ nodeArguments: ['-r', preload] });
  expect(await pyrightThread({ executable: process.execPath, args: [whole, '--stdio'] }, () => preload)).toEqual({ nodeArguments: [] });
  // No code that starts a thread was found, a program a person chose, a script that is not the package's entry.
  expect(await pyrightThread({ executable: process.execPath, args: [none, '--stdio'] }, () => preload)).toBeUndefined();
  expect(await pyrightThread({ executable: '/usr/bin/pyright-langserver', args: ['--stdio'] }, () => preload)).toBeUndefined();
  expect(await pyrightThread({ executable: '/usr/bin/node', args: [parts, '--stdio'] }, () => preload)).toBeUndefined();
  expect(await pyrightThread({ executable: process.execPath, args: [path.join(path.dirname(parts), 'dist', 'pyright-langserver.js')] }, () => preload)).toBeUndefined();
  // Without the file Node is to load first, a server built in parts gets no thread.
  expect(await pyrightThread({ executable: process.execPath, args: [parts, '--stdio'] }, () => undefined)).toBeUndefined();

  // What Node then does. Built in parts and started as it is, the thread loads a part and ends without a word.
  expect(await lines(parts, [])).toEqual(['thread ended']);
  expect(await lines(parts, ['-r', preload])).toEqual(['the thread runs the server\'s entry', 'thread ended']);
  expect(await lines(whole, [])).toEqual(['the thread runs the server\'s entry', 'thread ended']);
  expect(await lines(whole, ['-r', preload])).toEqual(['the thread runs the server\'s entry', 'thread ended']);
});

test('the packages Setdown ships are read as what they are', async () => {
  const pyright = require.resolve('pyright/langserver.index.js'), basedpyright = require.resolve('basedpyright/langserver.index.js');
  expect(await pyrightThread({ executable: process.execPath, args: [pyright, '--stdio'] }, () => preload)).toEqual({ nodeArguments: ['-r', preload] });
  expect(await pyrightThread({ executable: process.execPath, args: [basedpyright, '--stdio'] }, () => preload)).toEqual({ nodeArguments: [] });
  // The lines of Pyright this rests on.
  expect(readFileSync(path.join(vendor, 'pyright/packages/pyright-internal/src/backgroundAnalysis.ts'), 'utf8')).toContain('const worker = new Worker(__filename, { workerData: initialData });');
  expect(readFileSync(path.join(vendor, 'pyright/packages/pyright/src/langserver.ts'), 'utf8')).toContain("// Command line version doesn't use any worker threads.");
  expect(readFileSync(path.join(vendor, 'pyright/packages/pyright-internal/src/server.ts'), 'utf8')).toMatch(/isDebugMode\(\) \|\| !getCancellationFolderName\(\)\s*\? undefined\s*: new BackgroundAnalysis\(/);
});
