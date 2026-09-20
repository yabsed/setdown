import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

let script: string;
test.beforeAll(async () => {
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife',
    stdin: { resolveDir: process.cwd(), contents: `
      import { SourceAtlas } from './src/preview-runtime/source-atlas';
      import { installReviewPreparation } from './src/preview-runtime/review-preparation';
      import { installCommandRouter } from './src/preview-runtime/command-router';
      Object.assign(window, { SourceAtlas, installReviewPreparation, installCommandRouter });
    ` } });
  script = bundle.outputFiles[0].text;
});
const html = `<!DOCTYPE html><style>
html,body,p{margin:0}.setdown-rendered-diff-split{display:grid;grid-template-columns:1fr 1fr}
.lead{height:1800px}.before .lead{height:900px}.target{height:200px}.tail{height:1500px}
</style><div class="markdown-preview" data-for="preview"><div class="setdown-rendered-diff-split">
${['before', 'after'].map(side => `<div class="setdown-rendered-diff-${side} ${side}">
<p data-source-line="1" class="lead">lead</p><p data-source-line="120" class="target">target</p>
<p data-source-line="121" class="tail">tail</p></div>`).join('')}</div></div>`;

test('real layout: first/current target, warm no-op and invalidated prewarming', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent(html);
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(() => {
    const w = window as typeof window & { SourceAtlas: new (options: unknown) => {
      invalidate(): void; position(line: number, ratio: number, band: unknown[], side: string, offset: number, revision: number): void;
    } };
    const atlas = new w.SourceAtlas({ lineCount: () => 300, documentIsBlank: () => false });
    let scans = 0;
    let writes = 0;
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { scans++; return rect.call(this); };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    for (const element of [document.documentElement, document.body]) Object.defineProperty(element, 'scrollTop', {
      configurable: true, get() { return descriptor.get!.call(this); },
      set(value: number) { writes++; descriptor.set!.call(this, value); },
    });
    const move = (line = 120, revision = 1, side = 'after') => atlas.position(line, .7, [], side, 0, revision);
    move();
    const cold = scrollY;
    scans = writes = 0;
    move();
    const warm = { scans, writes };
    move(1); move();
    const afterOldTarget = scrollY;
    scrollTo(0, 0); move();
    const afterUnexpectedScroll = scrollY;
    (document.querySelector('.after .lead') as HTMLElement).style.height = '2000px';
    atlas.invalidate(); move(120, 2);
    const afterLayout = scrollY;
    move(120, 2, 'before');
    const before = scrollY;
    Element.prototype.getBoundingClientRect = rect;
    return { cold, warm, afterOldTarget, afterUnexpectedScroll, afterLayout, before };
  });
  expect(result).toMatchObject({ warm: { scans: 0, writes: 0 } });
  expect(result.cold).toBeCloseTo(1380, 0);
  expect(result.afterOldTarget).toBeCloseTo(1380, 0);
  expect(result.afterUnexpectedScroll).toBeCloseTo(1380, 0);
  expect(result.afterLayout).toBeCloseTo(1580, 0);
  expect(result.before).toBeCloseTo(480, 0);
});

test('a late font-ready operation cannot overwrite the latest Esc position', async ({ page }) => {
  await page.setContent(html);
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(async () => {
    const w = window as typeof window & {
      installReviewPreparation(options: unknown): void; installCommandRouter(options: unknown): void;
    };
    let finish!: () => void;
    const fonts = { status: 'loading', ready: new Promise<void>(resolve => { finish = resolve; }), addEventListener() {} };
    Object.defineProperty(document, 'fonts', { value: fonts });
    const positions: number[] = [];
    const messages: Array<Record<string, unknown>> = [];
    const atlas = { invalidate() {}, lineCount: () => 300, readBand: () => [], position: (line: number) => positions.push(line) };
    const content = { hydrateAll() {}, pendingCount: 0, includesSourceLine: () => true };
    const send = (message: Record<string, unknown>) => messages.push(message);
    w.installReviewPreparation({ sourceAtlas: atlas, revision: () => 1, hydrate() {}, send });
    w.installCommandRouter({ sourceAtlas: atlas, content, config: { revision: 1, totalLineCount: 300 }, send });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    window.postMessage({ command: 'marktex:prepare-review', revision: 1, requestId: 1,
      primeId: 99, sourceSide: 'after', sourceLine: 1, topRatio: .7 }, '*');
    while (positions.length < 1) await tick();
    window.postMessage({ command: 'marktex:position-preview', sourceSide: 'after', sourceLine: 120,
      topRatio: .7, settle: false }, '*');
    while (positions.length < 2) await tick();
    fonts.status = 'loaded'; finish(); await tick();
    return { positions, messages };
  });
  expect(result.positions).toEqual([1, 120]);
  expect(result.messages.some(message => message.type === 'marktex:review-primed')).toBe(false);
});
