// Temporary: replays opening one of the user's files with a copy of their settings.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { product } from './lib/product.mjs';
import { work } from './lib/paths.mjs';
const [file, root, seconds = '25'] = process.argv.slice(2);
const { start } = await product();
const host = start(path.join(work, 'profile'));
const window = host.window(root, [file]);
const text = await readFile(file, 'utf8');
const began = Date.now();
const opening = window.invoke('open', { id: 'doc', generation: 'g1', path: file, text, version: 1 })
  .then(result => ({ result }), error => ({ error: String(error) }));
const done = await Promise.race([opening, new Promise(r => setTimeout(() => r({ pending: true }), Number(seconds) * 1000))]);
const brief = v => JSON.stringify(v, (k, x) => k === 'capabilities' ? '[capabilities]' : typeof x === 'string' && x.length > 300 ? x.slice(0, 300) + '…' : x);
console.log('after', ((Date.now() - began) / 1000).toFixed(1), 's:', brief(done).slice(0, 3000));
for (const { at, event } of window.received) console.log('event +' + ((at - began) / 1000).toFixed(1), brief(event).slice(0, 700));
process.exit(0);
