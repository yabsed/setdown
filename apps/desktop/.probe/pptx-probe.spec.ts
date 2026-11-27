import { expect, test } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, focusApplication } from '../test/support/electron/electron-app';

// Exploration only: what the presentation surface looks like in the real application and how the stage takes input.
const fixtures = path.join(import.meta.dirname, '../test/fixtures/office'), out = process.env.PROBE_OUT!;
test('pptx surface probe', async () => {
  test.setTimeout(240_000);
  await mkdir(out, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-probe-'));
  const file = path.join(root, process.env.PROBE_DECK ? path.basename(process.env.PROBE_DECK) : 'deck.pptx');
  await copyFile(process.env.PROBE_DECK ?? path.join(fixtures, 'deck.pptx'), file);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  await focusApplication(app);
  const page = await app.firstWindow();
  const log: unknown[] = [];
  const note = (label: string, value: unknown) => { log.push({ label, value }); console.log(`== ${label} ${JSON.stringify(value)}`.slice(0, 1800)); };
  page.on('pageerror', error => note('pageerror', error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) note(`console.${message.type()}`, message.text().slice(0, 400)); });
  try {
    const deck = page.getByRole('region', { name: 'Presentation', exact: true });
    await expect(deck).toHaveAttribute('data-office-ready', 'true', { timeout: 60_000 });
    const attributes = () => deck.evaluate(element => Object.fromEntries([...element.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])));
    note('reading', await attributes());
    note('tab icon', await page.locator('.document-tab .file-type-icon').first().evaluate(element => ({ id: element.getAttribute('data-file-icon'), svg: !!element.querySelector('svg'), box: element.getBoundingClientRect().toJSON(), colour: getComputedStyle(element).color })));
    note('slides', await deck.locator('.deck-slide').evaluateAll(list => list.map(element => ({ box: element.getBoundingClientRect().toJSON(), svg: !!element.querySelector('svg'), texts: [...element.querySelectorAll('text')].map(t => t.textContent).slice(0, 4) }))));
    await page.screenshot({ path: path.join(out, '1-reading.png') });
    if (process.env.PROBE_FONTS) {
      await page.waitForTimeout(1500);
      note('fonts', await page.evaluate(() => [...document.fonts].map(face => `${face.family} ${face.weight} ${face.style} ${face.status}`).filter(name => !/Seti|Setdown|codicon/i.test(name))));
      note('texts', await deck.locator('.deck-slide').evaluateAll(list => list.map(slide => [...slide.querySelectorAll('text')].map(text => {
        const style = getComputedStyle(text), box = text.getBoundingClientRect(), frame = slide.getBoundingClientRect();
        const point = (text as SVGTextElement).ownerSVGElement!.createSVGPoint(); point.x = parseFloat(text.getAttribute('x') ?? '0'); point.y = parseFloat(text.getAttribute('y') ?? '0');
        const at = point.matrixTransform((text as SVGTextElement).getScreenCTM()!);
        return { baseline: Math.round((at.y - frame.top) / frame.height * 100000) / 100000, text: (text.textContent ?? '').slice(0, 30), family: style.fontFamily.slice(0, 80), attribute: text.getAttribute('font-family'), size: style.fontSize, weight: style.fontWeight,
          top: Math.round((box.top - frame.top) / frame.height * 10000) / 10000, height: Math.round(box.height / frame.height * 10000) / 10000, width: Math.round(box.width / frame.width * 10000) / 10000, markup: text.outerHTML.slice(0, 260) };
      }))));
    }
    if (process.env.PROBE_DECK) {
      // A real deck: walk it while reading, then stop.
      const list = deck.locator('.deck-slides');
      for (let step = 2; step <= 4; step++) { await list.evaluate((element, s) => { element.scrollTop = element.scrollHeight * (s - 1) / 6; }, step); await page.waitForTimeout(900); await page.screenshot({ path: path.join(out, `${step}-reading.png`) }); }
      await deck.getByRole('button', { name: 'Edit presentation', exact: true }).click();
      await expect(deck).toHaveAttribute('data-pptx-mode', 'edit');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, '5-editing.png') });
      return;
    }
    const focusAt = () => page.evaluate(() => { const a = document.activeElement; return `${a?.localName}.${a?.className} inStage=${!!a?.closest('.deck-stage')} inList=${!!a?.closest('.deck-slides')}`; });
    // Word's behaviour: a double click on text enters editing with the caret there, and one Esc returns to reading.
    const second = deck.locator('.deck-slide').nth(1).getByText('Second slide marker: wombat-second-slide').first();
    await second.scrollIntoViewIfNeeded();
    const sb = (await second.boundingBox())!;
    await page.mouse.dblclick(sb.x + sb.width - 6, sb.y + sb.height / 2);
    await expect(deck).toHaveAttribute('data-pptx-mode', 'edit');
    await page.waitForTimeout(500);
    note('dblclick text: focus', { focus: await focusAt(), ...(await attributes()) });
    await page.keyboard.type('Z');
    await page.waitForTimeout(200);
    note('dblclick text: typed Z', await deck.locator('.deck-stage text').allTextContents());
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    note('one Esc from text', { focus: await focusAt(), ...(await attributes()) });
    await deck.getByRole('button', { name: 'Edit presentation', exact: true }).click();
    await expect(deck).toHaveAttribute('data-pptx-mode', 'edit');
    await page.waitForTimeout(300);
    note('Edit button: focus', { focus: await focusAt(), ...(await attributes()) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    note('one Esc after Edit button', { focus: await focusAt(), ...(await attributes()) });
    await deck.locator('.deck-slides').evaluate(element => { element.scrollTop = 0; });
    await deck.getByRole('button', { name: 'Edit presentation', exact: true }).click();
    await expect(deck).toHaveAttribute('data-pptx-mode', 'edit');
    await page.waitForTimeout(500);
    note('editing', await attributes());
    note('stage', await deck.locator('.deck-stage').evaluate(element => ({ box: element.getBoundingClientRect().toJSON(), children: [...element.querySelectorAll('.pptx-editor > *')].map(child => `${child.localName}.${child.getAttribute('class')}`),
      texts: [...element.querySelectorAll('text')].map(t => ({ text: t.textContent, box: t.getBoundingClientRect().toJSON() })).slice(0, 6), active: document.activeElement?.localName + '.' + document.activeElement?.className })));
    await page.screenshot({ path: path.join(out, '2-editing.png') });
    const marker = deck.locator('.deck-stage').getByText('First slide marker: wombat-opening-slide').first();
    note('marker count', await deck.locator('.deck-stage').getByText('First slide marker: wombat-opening-slide').count());
    const box = (await marker.boundingBox())!;
    note('marker box', box);
    const state = () => page.evaluate(() => { const s = document.querySelector('[data-office-family="presentation"]')!; return { dirty: s.getAttribute('data-pptx-dirty'), slide: s.getAttribute('data-pptx-slide'), active: `${document.activeElement?.localName}.${document.activeElement?.className}` }; });
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await page.waitForTimeout(200); note('after one click', await state());
    await page.keyboard.type('A');
    await page.waitForTimeout(200); note('after typing A (one click)', { ...(await state()), text: await deck.locator('.deck-stage text').allTextContents() });
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.press('End'); await page.keyboard.type(' EDITED');
    await page.waitForTimeout(300); note('after second click + End + typing', { ...(await state()), text: await deck.locator('.deck-stage text').allTextContents() });
    await page.screenshot({ path: path.join(out, '3-typed.png') });
    note('rail text', await deck.locator('.deck-slide').first().locator('text').allTextContents());
    await page.waitForTimeout(1500);
    note('rail text later', await deck.locator('.deck-slide').first().locator('text').allTextContents());
    const stageWidth = () => deck.locator('.deck-stage .pptx-surface__stage').evaluate(element => element.getBoundingClientRect().width);
    const s0 = await stageWidth();
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click(); await page.waitForTimeout(500);
    const s110 = await stageWidth();
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click(); await page.getByRole('button', { name: 'Zoom document in', exact: true }).click(); await page.waitForTimeout(500);
    note('stage zoom', { s0, s110, s130: await stageWidth(), ratio110: s110 / s0, scroll: await deck.locator('.deck-stage').evaluate(element => ({ sw: element.scrollWidth, cw: element.clientWidth, sh: element.scrollHeight, ch: element.clientHeight })) });
    await page.screenshot({ path: path.join(out, '3b-zoomed-stage.png') });
    await page.getByRole('button', { name: 'Reset document zoom', exact: true }).click(); await page.waitForTimeout(400);
    note('stage zoom reset', { s100: await stageWidth() });
    await deck.locator('.deck-stage').click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(100);
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2); await page.waitForTimeout(200);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
    note('after Ctrl+Z', { ...(await state()), text: await deck.locator('.deck-stage text').allTextContents() });
    await page.keyboard.press('Control+y'); await page.waitForTimeout(200);
    note('after Ctrl+Y', { ...(await state()), text: await deck.locator('.deck-stage text').allTextContents() });
    const before = await readFile(file);
    await page.keyboard.press('Control+s');
    await expect(deck).toHaveAttribute('data-pptx-dirty', 'false', { timeout: 15_000 }).catch(error => note('save did not clean', String(error).slice(0, 300)));
    const after = await readFile(file);
    note('saved', { changed: !before.equals(after), before: before.length, after: after.length, alert: await deck.locator('[role=alert]').allTextContents(), notice: await page.locator('.notice').evaluateAll(list => list.map(element => ({ text: element.textContent, visible: (element as HTMLElement).checkVisibility() }))) });
    await writeFile(path.join(out, 'saved.pptx'), after);
    for (const key of ['Escape', 'Escape', 'Escape']) { await page.keyboard.press(key); await page.waitForTimeout(150); note('Esc', { ...(await attributes()), ...(await state()) }); }
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, '4-after-esc.png') });
    note('reading text after edit', await deck.locator('.deck-slide').first().locator('text').allTextContents());
    // Find, from reading.
    await deck.getByRole('searchbox', { name: 'Search presentation' }).fill('wombat');
    await page.waitForTimeout(300);
    note('find', { status: await deck.locator('.deck-find [role=status]').allTextContents(), found: await deck.locator('.deck-slide.found').evaluateAll(list => list.map(element => element.getAttribute('data-slide'))) });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    note('find next', { status: await deck.locator('.deck-find [role=status]').allTextContents(), found: await deck.locator('.deck-slide.found').evaluateAll(list => list.map(element => element.getAttribute('data-slide'))), mode: (await attributes())['data-pptx-mode'] });
    // Zoom while reading.
    const width = () => deck.locator('.deck-slide').first().evaluate(element => element.getBoundingClientRect().width);
    const w0 = await width();
    await page.getByRole('button', { name: 'Zoom document in', exact: true }).click(); await page.waitForTimeout(200);
    note('zoom', { w0, w110: await width(), label: await page.getByRole('button', { name: 'Reset document zoom', exact: true }).textContent() });
    // Double click a slide to edit it.
    const third = (await deck.locator('.deck-slide').nth(2).boundingBox())!;
    await deck.locator('.deck-slide').nth(2).scrollIntoViewIfNeeded();
    const again = (await deck.locator('.deck-slide').nth(2).boundingBox())!;
    await page.mouse.dblclick(again.x + 20, again.y + 20); await page.waitForTimeout(400);
    note('dblclick third', { ...(await attributes()), third });
    await page.screenshot({ path: path.join(out, '5-edit-third.png') });
    for (const name of ['New slide', 'Duplicate', 'Delete']) {
      await deck.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(200);
      note(name, await attributes());
    }
    await page.keyboard.press('PageUp'); await page.waitForTimeout(150); note('PageUp', await attributes());
    note('controls', await deck.locator('.deck-toolbar button, .deck-toolbar select').evaluateAll(list => list.map(element => `${element.getAttribute('aria-label') ?? element.textContent?.trim()}${(element as HTMLButtonElement).disabled ? ' (off)' : ''}`)));
  } finally {
    await writeFile(path.join(out, 'log.json'), JSON.stringify(log, null, 1));
    await disposeApplication(app); await rm(root, { recursive: true, force: true });
  }
});
