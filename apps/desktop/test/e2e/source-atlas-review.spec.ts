import { chromium, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

// Exercises the real SourceAtlas implementation with actual browser layout.
// The fixture uses the rendered-diff split cell contract, including deliberately
// different before/after source lines and large blocks.
test('review source coordinates, weighted band and block bookmarks survive layout changes', async () => {
  const { outputFiles } = await build({
    stdin: { contents: `import { SourceAtlas } from './src/preview-runtime/source-atlas';
      window.SourceAtlas = SourceAtlas;`, resolveDir: path.resolve('.') },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    await page.setContent("<!doctype html><style>body{margin:0}.row{display:grid;grid-template-columns:1fr 1fr}.cell{min-width:0}p{margin:0}.one{height:900px}.two{height:300px}.three{height:500px}.tail{height:1600px}</style><main class=\"markdown-preview\" data-for=\"preview\"><div class=\"setdown-rendered-diff-split\">\n<div class=\"row\"><section class=\"setdown-rendered-diff-before cell\"><p class=\"one\" data-source-line=\"1\">Before intro</p></section><section class=\"setdown-rendered-diff-after cell\"><p class=\"one\" data-source-line=\"1\">After intro</p></section></div>\n<div class=\"row\"><section class=\"setdown-rendered-diff-before cell\"><p class=\"two\" data-source-line=\"10\">Before ten</p></section><section class=\"setdown-rendered-diff-after cell\"><p class=\"two\" data-source-line=\"20\">After twenty</p></section></div>\n<div class=\"row\"><section class=\"setdown-rendered-diff-before cell\"><p class=\"three\" data-source-line=\"20\">Before twenty</p></section><section class=\"setdown-rendered-diff-after cell\"><p class=\"three\" data-source-line=\"30\">After thirty</p></section></div>\n<div class=\"row\"><section class=\"setdown-rendered-diff-before cell\"><p class=\"tail\" data-source-line=\"500\">Before five hundred</p></section><section class=\"setdown-rendered-diff-after cell\"><p class=\"tail\" data-source-line=\"60\">After sixty</p></section></div>\n</div></main>");
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.evaluate("window.atlas = new SourceAtlas({ lineCount: () => 60, documentIsBlank: () => false })");
    await test.step("after line 20 cannot resolve to before line 20", async () => {
      const result = await page.evaluate<{ pass: boolean }>("(() => { atlas.position(20,.8,[],'after'); const expected=900-800*.8; return {pass:Math.abs(scrollY-expected)<1,scrollY,expected}; })()");
      expect(result.pass, JSON.stringify(result)).toBe(true);
    });
    await test.step("before line 20 retains original coordinate system", async () => {
      const result = await page.evaluate<{ pass: boolean }>("(() => { atlas.position(20,.8,[],'before'); const expected=1200-800*.8; return {pass:Math.abs(scrollY-expected)<1,scrollY,expected}; })()");
      expect(result.pass, JSON.stringify(result)).toBe(true);
    });
    await test.step("weighted band only uses the chosen side", async () => {
      const result = await page.evaluate<{ pass: boolean }>("(() => { atlas.position(20,.372,[{sourceLine:20,yRatio:.2},{sourceLine:30,yRatio:.8}],'after'); const expected=(300*(900-800*.2)+500*(1200-800*.8))/800; return {pass:Math.abs(scrollY-expected)<1,scrollY,expected}; })()");
      expect(result.pass, JSON.stringify(result)).toBe(true);
    });
    await test.step("tall block bookmark survives layout growth before it", async () => {
      const result = await page.evaluate<{ pass: boolean }>("(() => { atlas.position(30,.372,[],'after'); scrollTo(0,1100); const mark=atlas.bookmarkAt(.372); document.querySelectorAll('.one').forEach(n=>n.style.height='1100px'); atlas.position(mark.sourceLine,mark.yRatio,[],mark.sourceSide,mark.blockOffset);return {pass:mark.sourceSide==='after'&&mark.sourceLine===30&&Math.abs(scrollY-1300)<1,scrollY,mark}; })()");
      expect(result.pass, JSON.stringify(result)).toBe(true);
    });
    await test.step("left click is not clamped to modified line count", async () => {
      const result = await page.evaluate<{ pass: boolean }>("(() => { atlas.position(500,.5,[],'before');const el=document.querySelector('[data-source-line=\"500\"]');const r=el.getBoundingClientRect();const mark=atlas.anchorAtPoint(r.left+10,r.top+10,el,[el]);return {pass:mark.sourceLine===500&&mark.sourceSide==='before',mark}; })()");
      expect(result.pass, JSON.stringify(result)).toBe(true);
    });
  } finally { await browser.close(); }
});
