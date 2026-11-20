// Loaded by Node before the Pyright server (`node -r this-file langserver.index.js`), and only
// where `pyright-thread.ts` found that the server needs it.
//
// Pyright starts its background analysis thread with `new Worker(__filename)`; its own comment
// says "this will load this same file in BG thread and start listener"
// (vendor/pyright/packages/pyright-internal/src/backgroundAnalysis.ts). In the VS Code extension
// that file is the whole server, so the thread starts the server's entry, which sees that it is
// not the main thread and listens for work (nodeServer.ts `run`). The npm package is built in
// parts, and there `__filename` is a part that only holds code: the thread loads it, has nothing
// to do and ends, and the server waits for its answer for ever. Here the thread is given the
// file the server itself was started with, which is what the extension's server gives it.
'use strict';
const path = require('node:path'), threads = require('node:worker_threads');
if (threads.isMainThread && typeof process.argv[1] === 'string') {
  const entry = process.argv[1], parts = path.join(path.dirname(entry), 'dist') + path.sep;
  const Original = threads.Worker;
  threads.Worker = class extends Original {
    constructor(file, options) { super(typeof file === 'string' && file.startsWith(parts) && path.dirname(file) + path.sep === parts ? entry : file, options); }
  };
}
