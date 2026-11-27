// One document in a fresh page: does the page survive, and how far does its memory go?
import { launch } from './drive.mjs';
const [kind, file] = process.argv.slice(2);
const session = await launch(kind);
let peak = 0, crashed = false;
session.page.on('crash', () => { crashed = true; });
const watch = setInterval(async () => { try { const tabs = await session.app.evaluate(({ app }) => app.getAppMetrics().filter(item => item.type === 'Tab').map(item => Math.round(item.memory.workingSetSize / 1024))); peak = Math.max(peak, ...tabs); } catch {} }, 250);
const started = Date.now();
try {
  const opened = await Promise.race([session.open(file), new Promise((_, reject) => setTimeout(() => reject(Error('no answer in 120 s')), 120_000))]);
  console.log('RESULT opened', opened.snapshot?.status, JSON.stringify(opened.snapshot?.failure), opened.ms, 'ms');
} catch (error) { console.log('RESULT failed after', Date.now() - started, 'ms:', String(error.message).slice(0, 120)); }
clearInterval(watch);
console.log('RESULT page crashed:', crashed, '| peak renderer working set', peak, 'MiB');
await session.close();
