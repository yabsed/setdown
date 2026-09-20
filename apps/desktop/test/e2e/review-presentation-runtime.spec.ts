import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { test } from '@playwright/test';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('src/preview-runtime/review-presentation.ts')],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SetdownPresentation' });
  bundle = result.outputFiles[0].text;
});

for (const mode of ['normal', 'stale', 'resume', 'cancel', 'replace', 'content']) {
  test(`presentation runtime: ${mode}`, async ({ page }) => {
    await page.setContent('<style>body{margin:0}#content{height:8000px}</style><div id="content"></div>');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async (mode) => {
      let revision = 7;
      let finishFonts: () => void = () => {};
      const messages: Array<Record<string, unknown>> = [];
      const positions: number[] = [];
      const slow = ['cancel', 'replace', 'content'].includes(mode);
      const fakeFonts = { status: 'loading', ready: new Promise<void>(resolve => { finishFonts = resolve; }) };
      if (slow) Object.defineProperty(document, 'fonts', { value: fakeFonts, configurable: true });
      const atlas = { lineCount: () => 800, readBand: (band: unknown) => band, invalidate() {},
        position(line: number) { positions.push(line); window.scrollTo(0, line * 10); } };
      const runtime = (window as unknown as { SetdownPresentation: {
        installReviewPresentation(options: unknown): void;
      } }).SetdownPresentation;
      runtime.installReviewPresentation({ atlas, hydrate() {}, revision: () => revision,
        send: (message: Record<string, unknown>) => messages.push({ ...message, scrollY: window.scrollY }) });
      const target = { sourceLine: 120, topRatio: .8, sourceSide: 'after', band: [] };
      const base = { command: 'marktex:present-review-page', presentationId: 1,
        revision: mode === 'stale' ? 6 : 7, bounds: { x: 0, y: 0, width: 900, height: 600 },
        position: mode === 'resume' ? null : target };
      const send = (message: unknown) => window.postMessage(message, '*');
      const turn = () => new Promise(resolve => setTimeout(resolve, 15));
      send(base); await turn();
      if (mode === 'cancel') send({ command: 'marktex:cancel-presentation' });
      if (mode === 'replace') send({ ...base, presentationId: 2, position: { ...target, sourceLine: 200 } });
      if (mode === 'content') { revision = 8; send({ command: 'marktex:update-html' }); }
      if (slow) { await turn(); fakeFonts.status = 'loaded'; finishFonts(); await turn(); }
      return { messages, positions };
    }, mode);
    const { messages, positions } = result;
    if (mode === 'normal') {
      assert.equal(messages.length, 1); assert.equal(messages[0].scrollY, 1200); assert.deepEqual(positions, [120]);
    } else if (mode === 'stale') {
      assert.equal(messages.length, 1); assert.ok(messages[0].error); assert.deepEqual(positions, []);
    } else if (mode === 'resume') {
      assert.equal(messages.length, 1); assert.deepEqual(positions, []);
    } else if (mode === 'cancel' || mode === 'content') {
      assert.deepEqual(messages, []); assert.deepEqual(positions, [120]);
    } else {
      assert.equal(messages.length, 1); assert.equal(messages[0].presentationId, 2);
      assert.equal(messages[0].scrollY, 2000); assert.deepEqual(positions, [120, 200, 200]);
    }
  });
}
