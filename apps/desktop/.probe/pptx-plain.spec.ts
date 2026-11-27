import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { launchPlain } from '../test/support/electron/plain-app';
import { nativeInput } from '../test/support/electron/native-input';

// The application as a person starts it: no test driver on its views, real pointer and key input through the X server.
const exec = promisify(execFile);
const out = process.env.PROBE_OUT!;
type Rect = { x: number; y: number; width: number; height: number };

test('plain launch: a double click on slide text starts editing there, Esc returns to reading', async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pptx-plain-')), file = path.join(root, 'deck.pptx');
  await mkdir(out, { recursive: true });
  await copyFile(path.join(import.meta.dirname, '../test/fixtures/office/deck.pptx'), file);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await launchPlain(['.', file], { ...env, XDG_CONFIG_HOME: path.join(root, 'config') });
  const shot = (name: string) => exec('import', ['-window', 'root', path.join(out, `${name}.png`)]).catch(() => undefined);
  const state = () => app.evaluate<{ ready: string | null; mode: string | null; slide: string | null; dirty: string | null; focus: string; stage: string } | null>(`(() => {
    const deck = document.querySelector('[aria-label="Presentation"]');
    if (!deck) return null;
    const active = document.activeElement;
    return { ready: deck.getAttribute('data-office-ready'), mode: deck.getAttribute('data-pptx-mode'), slide: deck.getAttribute('data-pptx-slide'), dirty: deck.getAttribute('data-pptx-dirty'),
      focus: active ? active.tagName.toLowerCase() + '.' + active.className : '', stage: [...deck.querySelectorAll('.deck-stage text')].map(node => node.textContent).join('') };
  })()`).catch(() => null);
  const rect = (expression: string) => app.evaluate<Rect | null>(`(() => {
    const element = ${expression};
    if (!element) return null;
    element.scrollIntoView({ block: 'center' });
    const box = element.getBoundingClientRect();
    return { x: box.x + window.screenX, y: box.y + window.screenY, width: box.width, height: box.height };
  })()`);
  try {
    await expect.poll(async () => (await state())?.ready, { timeout: 60_000 }).toBe('true');
    console.log('== opened', JSON.stringify(await state()));
    const marker = `[...([...document.querySelectorAll('.deck-slide')][1]?.querySelectorAll('text') ?? [])].at(-1)`;
    await expect.poll(() => rect(marker)).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 500));
    const box = (await rect(marker))!;
    console.log('== target', JSON.stringify(box), JSON.stringify(await app.evaluate('({ screenX: window.screenX, screenY: window.screenY, inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight] })')));
    const at = { x: box.x + box.width - 8, y: box.y + box.height / 2 };
    // Two presses of the real pointer in one place, close together: a double click.
    await nativeInput({ click: at });
    await nativeInput({ click: at });
    await expect.poll(async () => (await state())?.mode, { timeout: 10_000 }).toBe('edit');
    await expect.poll(async () => (await state())?.focus, { timeout: 10_000 }).toContain('pptx-surface__input');
    console.log('== after double click', JSON.stringify(await state()));
    await shot('1-editing');
    await nativeInput({ keys: ['End'] });
    await nativeInput({ text: 'zz' });
    await expect.poll(async () => (await state())?.stage, { timeout: 10_000 }).toContain('wombat-second-slidezz');
    console.log('== after typing', JSON.stringify(await state()));
    await nativeInput({ keys: ['Escape'] });
    await expect.poll(async () => (await state())?.mode, { timeout: 10_000 }).toBe('view');
    console.log('== after Esc', JSON.stringify(await state()));
    await shot('2-reading');
    // The button, then Esc with nothing clicked in the slide.
    const button = `[...document.querySelectorAll('[aria-label="Presentation"] button')].find(element => element.textContent.trim() === 'Edit presentation')`;
    const edit = (await rect(button))!;
    await nativeInput({ click: { x: edit.x + edit.width / 2, y: edit.y + edit.height / 2 } });
    await expect.poll(async () => (await state())?.mode, { timeout: 10_000 }).toBe('edit');
    console.log('== after button', JSON.stringify(await state()));
    await nativeInput({ keys: ['Escape'] });
    await expect.poll(async () => (await state())?.mode, { timeout: 10_000 }).toBe('view');
    console.log('== after second Esc', JSON.stringify(await state()));
  } finally { await shot('9-last'); await app.close(); await rm(root, { recursive: true, force: true }); }
});
