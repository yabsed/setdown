import { expect, test } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { launchPlain } from '../test/support/electron/plain-app';
import { nativeInput } from '../test/support/electron/native-input';

// The application as a person starts it: no test driver on its views, real pointer input, and the
// real screen as evidence. PLAIN_SOURCE is a real project; PLAIN_OUT receives screenshots and video.
const exec = promisify(execFile);
const source = process.env.PLAIN_SOURCE!, out = process.env.PLAIN_OUT!;
type Rect = { x: number; y: number; width: number; height: number };

test('plain launch: side panel opens in the focused group; focus changes do not move a reader', async () => {
  test.setTimeout(240_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-plain-verify-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-plain-verify-config-'));
  await mkdir(out, { recursive: true });
  await cp(source, root, { recursive: true, filter: file => !/\/(node_modules|\.git)(\/|$)/.test(file) });
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await launchPlain(['.', path.join(root, 'package.json')], { ...env, XDG_CONFIG_HOME: config, SETDOWN_NATIVE_DIALOGS: '1' });
  const shot = (name: string) => exec('import', ['-window', 'root', path.join(out, `${name}.png`)]);
  const ready = () => expect.poll(() => app.evaluate<boolean>('typeof window.marktex?.openLink === "function" && document.querySelectorAll(".document-tab").length > 0').catch(() => false), { timeout: 30_000 }).toBe(true);
  const rect = (selector: string, text?: string, index = 0) => app.evaluate<Rect | null>(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const found = ${text === undefined ? 'all' : `all.filter(element => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().split('\\n')[0].trim() === ${JSON.stringify(text)})`};
    const element = found[${index}];
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x + window.screenX, y: box.y + window.screenY, width: box.width, height: box.height };
  })()`);
  const click = async (selector: string, text?: string, index = 0) => {
    await expect.poll(() => rect(selector, text, index), `${selector} ${text ?? ''}`).not.toBeNull();
    const box = (await rect(selector, text, index))!;
    await nativeInput({ click: { x: box.x + box.width / 2, y: box.y + box.height / 2 } });
  };
  const groups = () => app.evaluate<Array<{ focused: boolean; selected: string | null; tabs: string[] }>>(`[...document.querySelectorAll('.editor-group')].map(group => ({
    focused: group.classList.contains('focused'),
    selected: group.querySelector('.document-tab[aria-selected="true"] .tab-name')?.textContent ?? null,
    tabs: [...group.querySelectorAll('.document-tab .tab-name')].map(name => name.textContent),
  }))`);
  try {
    await ready();
    await app.evaluate(`window.marktex.restoreProjectFolder(${JSON.stringify(root)}).then(() => { setTimeout(() => location.reload(), 0); return true; })`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await ready();
    await app.evaluate(`window.marktex.openLink(${JSON.stringify(`marktex-resource://file${path.join(root, 'Readme.md')}`)}).then(() => true)`);
    await expect.poll(async () => (await groups())[0]?.selected).toBe('Readme.md');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Split: drag the Readme.md tab to the right edge of the document area, as a person does.
    const tab = (await rect('.document-tab .tab-name', 'Readme.md'))!, body = (await rect('.group-body'))!;
    const start = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
    const end = { x: body.x + body.width * .95, y: body.y + body.height / 2 };
    await nativeInput({ pointer: [start], button: 'down' });
    await nativeInput({ pointer: [{ x: start.x + 20, y: start.y + 10 }, { x: (start.x + end.x) / 2, y: end.y }, { x: end.x - 10, y: end.y }, end], pointerIntervalMs: 120 });
    await new Promise(resolve => setTimeout(resolve, 400));
    await nativeInput({ button: 'up' });
    await expect.poll(async () => (await groups()).length).toBe(2);
    await expect.poll(async () => (await groups()).map(group => group.selected)).toEqual(['package.json', 'Readme.md']);

    // Work in the left group, then use the side panel.
    await click('.document-tab .tab-name', 'package.json');
    await expect.poll(async () => (await groups()).map(group => group.focused)).toEqual([true, false]);
    // PLAIN_NO_WAIT: go on at once, as a quick hand does, instead of letting the split settle.
    if (!process.env.PLAIN_NO_WAIT) { await new Promise(resolve => setTimeout(resolve, 1500)); await shot('0-split'); }
    await click('button', 'Toggle Folder Tools');
    await click('button', 'Explorer');
    await expect.poll(() => rect('[role="treeitem"]', 'History.md')).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await shot('1-before');
    if (process.env.PLAIN_STOP_EARLY) return;
    // PLAIN_ONLY_FOCUS: record the focus changes only (a build from 2026-11-23 opened these beside the group in use).
    if (!process.env.PLAIN_ONLY_FOCUS) {
      const seen: unknown[] = [];
      for (const [step, file] of [['2-history', 'History.md'], ['3-index', 'index.js'], ['4-license', 'LICENSE']] as const) {
        await click('[role="treeitem"]', file);
        await expect.poll(async () => (await groups())[0]?.selected, `${file} opens in the focused group`).toBe(file);
        await new Promise(resolve => setTimeout(resolve, 1500));
        const state = await groups(); seen.push({ file, state });
        expect(state[0].focused).toBe(true);
        expect(state[1], `the other group after opening ${file}`).toMatchObject({ focused: false, selected: 'Readme.md' });
        await shot(step);
      }
      // Back to package.json: its tab is already in the focused group.
      await click('[role="treeitem"]', 'package.json');
      await expect.poll(async () => (await groups())[0]?.selected).toBe('package.json');
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect((await groups())[1]).toMatchObject({ focused: false, selected: 'Readme.md' });
      await shot('5-package');
      console.log(`[plain] ${JSON.stringify(seen)}`);
    }

    // Focus left ↔ right while the real screen is recorded at 60 frames per second.
    const left = (await rect('.group-body', undefined, 0))!, right = (await rect('.group-body', undefined, 1))!;
    console.log(`[plain] bodies ${JSON.stringify({ left, right })}`);
    const video = path.join(out, 'focus.mkv');
    const recorder = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'x11grab', '-framerate', '60', '-video_size', '1920x1080', '-i', process.env.DISPLAY!,
      '-t', '14', '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', video], { stdio: 'ignore' });
    const recorded = new Promise<void>(resolve => recorder.once('exit', () => resolve()));
    await new Promise(resolve => setTimeout(resolve, 1500));
    for (let round = 0; round < 6; round++) {
      await nativeInput({ click: { x: right.x + right.width / 2, y: right.y + right.height / 2 } });
      await expect.poll(async () => (await groups()).map(group => group.focused), { intervals: [50] }).toEqual([false, true]);
      await new Promise(resolve => setTimeout(resolve, 700));
      await click('.document-tab .tab-name', 'package.json');
      await expect.poll(async () => (await groups()).map(group => group.focused), { intervals: [50] }).toEqual([true, false]);
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    await recorded;
    await shot('6-after-focus');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});
