// Memory held after garbage collection: the same document opened many times in one page, then large documents in a fresh page each.
import { launch } from './drive.mjs';
const [kind, small, ...large] = process.argv.slice(2);
const heap = page => page.evaluate(async () => { window.gc?.(); await new Promise(resolve => setTimeout(resolve, 100)); window.gc?.(); return { heapMiB: Math.round(performance.memory.usedJSHeapSize / 1048576), fontFaces: document.fonts.size, gc: typeof window.gc }; });
{
  const session = await launch(kind);
  console.log(kind, 'empty page', JSON.stringify(await heap(session.page)));
  for (let round = 1; round <= 40; round++) {
    await session.open(small);
    if (round === 1 || round % 10 === 0) console.log(kind, 'after', round, 'opens of the same document', JSON.stringify(await heap(session.page)));
  }
  await session.close();
}
for (const file of large) {
  const session = await launch(kind);
  const opened = await session.open(file);
  const held = await heap(session.page);
  const metrics = await session.app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, mib: Math.round(item.memory.workingSetSize / 1024) })));
  console.log(kind, file.split('/').pop(), 'open', opened.ms, 'ms, painted', opened.paintedMs, 'ms, status', opened.snapshot?.status, '| heap after gc', held.heapMiB, 'MiB | renderer working set', metrics.filter(item => item.type === 'Tab').map(item => item.mib).join('+'), 'MiB');
  await session.close();
}
