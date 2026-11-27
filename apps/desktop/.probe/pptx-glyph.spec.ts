import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication } from '../test/support/electron/electron-app';
import { pptxWith } from '../test/support/media/pptx-fixture';
import { shippedFontsOnly } from '../test/support/media/shipped-fonts';

test('pptx glyph probe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-glyph-')), file = path.join(root, 'korean.pptx');
  await writeFile(file, pptxWith(await readFile(path.join(import.meta.dirname, '../test/fixtures/office/deck.pptx')), (name, xml) => name === 'ppt/slides/slide1.xml'
    ? xml.replace('First slide marker: wombat-opening-slide', '맑은고딕글꼴').replace(/<a:latin typeface="[^"]*"/g, '<a:latin typeface="맑은 고딕"').replace(/<a:ea typeface="[^"]*"/g, '<a:ea typeface="맑은 고딕"') : undefined));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, ...(await shippedFontsOnly(root, ['@docx-editor.dev/fonts'])), XDG_CONFIG_HOME: path.join(root, 'config') } });
  await focusApplication(app);
  const page = await app.firstWindow();
  try {
    const deck = page.getByRole('region', { name: 'Presentation', exact: true });
    await expect(deck).toHaveAttribute('data-office-ready', 'true', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    console.log('== glyph', JSON.stringify(await deck.locator('.deck-slide').first().evaluate(async element => {
      await document.fonts.ready;
      const texts = [...element.querySelectorAll('text')].map(node => ({ text: node.textContent, family: node.getAttribute('font-family'), computed: getComputedStyle(node).fontFamily, width: Math.round(node.getBoundingClientRect().width) }));
      const text = [...element.querySelectorAll('text')].find(node => node.textContent?.includes('맑'))!;
      const family = getComputedStyle(text).fontFamily.split(',')[0].trim();
      const ink = (font: string, character: string) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const context = canvas.getContext('2d')!;
        context.font = font;
        context.fillText(character, 6, 36);
        const data = context.getImageData(0, 0, 48, 48).data; let count = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 64) count++;
        return `${context.font}=>${count}/${Math.round(context.measureText(character).width)}`;
      };
      return { texts, family, faces: [...document.fonts].filter(face => face.family.replace(/"/g, '') === family.replace(/"/g, '')).map(face => `${face.family} ${face.status} ${face.unicodeRange}`),
        check: document.fonts.check(`32px ${family}`, '맑'),
        own: ['맑', '은', 'A', '￾'].map(character => ink(`32px ${family}`, character)), fallback: ['맑', 'A'].map(character => ink('32px sans-serif', character)) };
    })).slice(0, 2600));
    await page.screenshot({ path: path.join(process.env.PROBE_OUT!, 'glyph.png') });
  } finally { await disposeApplication(app); }
});
