// First look: does each engine open a document from a file:// page, and what does it report?
import { launch } from './drive.mjs';
const [kind, ...files] = process.argv.slice(2);
const session = await launch(kind);
try {
  console.log('location', await session.page.evaluate(() => location.protocol), 'exports', await session.page.evaluate(() => window.spike.exports()));
  for (const file of files) {
    const report = await session.open(file);
    console.log('==', file.split('/').pop());
    console.log(JSON.stringify(report, null, 1).slice(0, 3500));
    console.log('keys', (await session.page.evaluate(() => window.spike.keys())).join(' ').slice(0, 1500));
    await session.page.screenshot({ path: `${process.env.SPIKE_OUT}/${kind}-${file.split('/').pop()}.png` });
  }
  console.log('page errors', JSON.stringify(await session.page.evaluate(() => window.spike.errors), null, 1).slice(0, 2500));
  console.log('driver saw', JSON.stringify(session.messages, null, 1).slice(0, 2500));
} finally { await session.close(); }
