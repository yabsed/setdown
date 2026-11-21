import { test, type Page } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../test/support/electron/electron-app';

// A closer look at single things the audit of the Zed-served languages turned up. Not a test of
// record. AUDIT_DIR as in zed-audit.spec.ts; FOCUS_PASS names the build looked at ("before", "after").
const audit = process.env.AUDIT_DIR!, pass = process.env.FOCUS_PASS ?? 'before';
const own = (project: string) => path.join(audit, 'sources', project);
const flat = (text: string | null | undefined, limit = 900) => (text ?? '').replace(/\s*\n\s*/g, ' | ').replace(/[ \t ]+/g, ' ').trim().slice(0, limit);
const dialogs = async (page: Page) => (await page.getByRole('dialog').allInnerTexts().catch(() => [] as string[])).map(text => flat(text, 1600));
async function hostState(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('.editor-group.focused .editor-host') ?? document.querySelector('.editor-host');
    const chip = [...document.querySelectorAll('button')].find(button => /^Language status:/.test(button.getAttribute('aria-label') ?? ''));
    return { server: host?.getAttribute('data-language-server') ?? null, chipText: chip?.textContent?.replace(/\s+/g, ' ').trim() ?? null, turning: !!chip?.querySelector('.turning') };
  });
}
async function cursorPlace(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.editor-group.focused .editor-host > .monaco-editor, .editor-group.focused .editor-host .monaco-editor') ?? document.querySelector('.monaco-editor');
    const cursor = editor?.querySelector('.cursors-layer .cursor');
    if (!editor || !cursor) return null;
    const box = cursor.getBoundingClientRect(), middle = box.y + box.height / 2;
    const line = [...editor.querySelectorAll('.view-line')].find(item => { const r = item.getBoundingClientRect(); return r.top <= middle && middle < r.bottom; });
    return { x: box.x, y: box.y, height: box.height, text: (line?.textContent ?? '').replace(/ /g, ' ').slice(0, 160) };
  });
}
const selectedTab = async (page: Page) => flat(await page.locator('.editor-group.focused .document-tab[aria-selected="true"] .tab-name').first().textContent().catch(() => ''), 80);

type Session = { page: Page; note(line: string): void; shot(name: string): Promise<void>; goto(line: number, word: string): Promise<Awaited<ReturnType<typeof cursorPlace>>> };
async function look(name: string, file: string, run: (session: Session) => Promise<void>) {
  const out = path.join(audit, 'focus', name); await mkdir(out, { recursive: true });
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(audit, 'profile'), SETDOWN_LSP_INHERIT_ENV: '1' } });
  const started = Date.now(), live = path.join(out, `${pass}-notes.txt`); writeFileSync(live, '');
  const note = (line: string) => { const stamped = `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`; console.log(stamped); appendFileSync(live, stamped + '\n'); };
  let shots = 0;
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    page.on('pageerror', error => note(`PAGE ERROR ${String(error).slice(0, 300)}`));
    await page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }).first().waitFor({ state: 'visible', timeout: 30_000 });
    const text = await readFile(file, 'utf8');
    const session: Session = { page, note,
      shot: async label => { await page.screenshot({ path: path.join(out, `${pass}-${String(++shots).padStart(2, '0')}-${label}.png`) }).catch(() => {}); },
      goto: async (line, word) => {
        const area = await page.evaluate(() => {
          const box = [...document.querySelectorAll('.editor-host .monaco-editor')].map(host => host.getBoundingClientRect()).find(rect => rect.width > 200 && rect.height > 100);
          return box ? { x: box.x, y: box.y } : null;
        });
        if (area) await page.mouse.click(area.x + 300, area.y + 40);
        await page.keyboard.press('Control+Home');
        for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Home'); await page.keyboard.press('Home');
        const column = Math.max(0, (text.split('\n')[line - 1] ?? '').indexOf(word));
        for (let i = 0; i < column + 1; i++) await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(400);
        const place = await cursorPlace(page); note(`cursor at line ${line} "${word}": ${JSON.stringify(place)}`); return place;
      } };
    await run(session);
  } finally { await disposeApplication(application); }
}
async function ready(page: Page, note: (line: string) => void, seconds: number) {
  const limit = Date.now() + seconds * 1000; let last = '';
  while (Date.now() < limit) {
    const state = await hostState(page), now = JSON.stringify(state);
    if (now !== last) { note(`state: ${now}`); last = now; }
    if (state.server === 'ready' && !state.turning) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}
const peek = (page: Page) => page.evaluate(() => {
  const widget = document.querySelector('.peekview-widget');
  if (!widget) return null;
  const text = (selector: string, limit = 400) => (widget.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const rows = [...widget.querySelectorAll('.ref-tree .monaco-list-row')].map(row => (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90));
  const preview = widget.querySelector('.preview');
  return { title: text('.head .peekview-title'), rows: rows.slice(0, 14), rowCount: rows.length,
    preview: [...(preview?.querySelectorAll('.view-line') ?? [])].slice(0, 6).map(line => (line.textContent ?? '').replace(/ /g, ' ').slice(0, 80)),
    message: text('.preview .message, .message', 200) };
});

test('focus lua: references in other files, and the definition link while Ctrl is held', async () => {
  test.setTimeout(420_000);
  await look('lua', path.join(own('plenary.nvim'), 'lua/plenary/job.lua'), async ({ page, note, shot, goto }) => {
    note(`ready=${await ready(page, note, 120)}`);
    await page.waitForTimeout(12_000); // the workspace is read by the tool
    // References of a method other files call.
    await goto(452, 'sync');
    await page.keyboard.press('Shift+F12'); await page.waitForTimeout(6000);
    note(`references: ${JSON.stringify(await peek(page))}`); await shot('references');
    const other = page.locator('.peekview-widget .ref-tree .monaco-list-row').filter({ hasNotText: /job\.lua/ });
    note(`rows not of this file: ${await other.count()}`);
    // The last rows are the other files' references.
    const rows = page.locator('.peekview-widget .ref-tree .monaco-list-row'), count = await rows.count();
    if (count) { await rows.nth(count - 1).click(); await page.waitForTimeout(2500); note(`after opening the last file's rows: ${JSON.stringify(await peek(page))}`); await shot('references-other-file'); }
    // One reference of another file: what the preview beside the list shows.
    const inner = page.locator('.peekview-widget .ref-tree .monaco-list-row[aria-level="2"]'), inside = await inner.count();
    if (inside) { await inner.nth(inside - 1).click(); await page.waitForTimeout(2500); const now = await peek(page); note(`after choosing a reference in another file: title=${now?.title.slice(0, 40)} preview=${JSON.stringify(now?.preview)}`); await shot('references-preview'); }
    note(`type: ${JSON.stringify(await page.evaluate(() => {
      const of = (selector: string) => { const element = document.querySelector(selector); if (!element) return null; const style = getComputedStyle(element); return `${style.fontSize} ${style.fontFamily.slice(0, 40)}`; };
      return { row: of('.peekview-widget .ref-tree .monaco-list-row'), title: of('.peekview-widget .head .peekview-title'), code: of('.editor-host .view-lines'), chip: of('button[aria-label^="Language status:"]') };
    }))}`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // The definition in a file that is not open: what Ctrl shows, and where Ctrl+click goes.
    const place = await goto(142, 'if_nil');
    if (!place) return;
    const x = place.x + 12, y = place.y + place.height / 2;
    await page.mouse.move(x - 1, y); await page.mouse.move(x, y); await page.waitForTimeout(300);
    await page.keyboard.down('Control'); await page.mouse.move(x + 1, y); await page.mouse.move(x + 2, y); await page.waitForTimeout(2500);
    note(`while Ctrl is held: link decorations=${await page.locator('.goto-definition-link').count()} hover=${flat(await page.locator('.monaco-hover:visible').first().textContent().catch(() => ''), 300)}`);
    await shot('ctrl-held');
    await page.mouse.click(x + 2, y); await page.keyboard.up('Control'); await page.waitForTimeout(3000);
    note(`after Ctrl+click: tab=${await selectedTab(page)} cursor=${JSON.stringify(await cursorPlace(page))}`); await shot('ctrl-click');
  });
});

test('focus clojure: the question a tool asks while it starts', async () => {
  test.setTimeout(420_000);
  await look('clojure', path.join(own('ring'), 'ring-core/src/ring/util/response.clj'), async ({ page, note, shot }) => {
    const chip = page.getByRole('button', { name: /^Language status:/ }).first();
    const limit = Date.now() + 100_000; let last = '', asked = 0;
    // How long the question stays, and what the button says meanwhile.
    while (Date.now() < limit) {
      const state = await hostState(page), now = JSON.stringify(state);
      if (now !== last) { note(`state: ${now}`); last = now; }
      if (/Needs answer/.test(state.chipText ?? '') && !asked) asked = Date.now();
      if (asked && Date.now() - asked > 45_000) break;
      await page.waitForTimeout(1000);
    }
    await shot('asked');
    await chip.click(); await page.waitForTimeout(900);
    note(`panel: ${JSON.stringify(await dialogs(page))}`); await shot('panel');
    const answer = page.getByRole('dialog').getByRole('button', { name: /^Answer…$/ });
    if (await answer.count()) { await answer.first().click(); await page.waitForTimeout(900); }
    note(`after "Answer…": ${JSON.stringify(await dialogs(page))}`);
    note(`buttons: ${JSON.stringify(await page.getByRole('dialog').getByRole('button').allInnerTexts().catch(() => []))}`); await shot('question');
    // The answer that lets the tool go on without the project's own build tool.
    const choice = page.getByRole('dialog').getByRole('button', { name: /ignore|continue|proceed|later/i });
    if (await choice.count()) { note(`choosing "${flat(await choice.first().innerText())}"`); await choice.first().click(); }
    else note('no answer that goes on was found');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
    note(`ready=${await ready(page, note, 120)}`);
    await chip.click(); await page.waitForTimeout(900);
    note(`panel at the end: ${JSON.stringify(await dialogs(page))}`); await shot('end');
  });
});

test('focus swift: what the session records when the program its extension names is not on the computer', async () => {
  test.setTimeout(180_000);
  await look('swift', path.join(own('swift-argument-parser'), 'Sources/ArgumentParser/Parsable Types/ParsableCommand.swift'), async ({ page, note, shot }) => {
    // The status events the main process sends, as the renderer receives them.
    await page.evaluate(() => {
      const seen: string[] = []; (window as unknown as { seen: string[] }).seen = seen;
      (window as unknown as { marktex: { language: { onEvent(listener: (event: unknown) => void): void } } }).marktex.language.onEvent(event => {
        const value = event as { type?: string; state?: string; message?: string; issue?: unknown; recovery?: unknown };
        if (value.type === 'status') seen.push(JSON.stringify({ state: value.state, message: value.message, issue: value.issue, recovery: value.recovery }));
      });
    });
    const chip = page.getByRole('button', { name: /^Language status:/ }).first();
    await chip.click(); await page.waitForTimeout(600);
    const again = page.getByRole('dialog').getByRole('button', { name: /^(Try again|Restart|Install Swift support)$/ });
    note(`panel before: ${JSON.stringify(await dialogs(page))}`);
    if (await again.count()) { note(`clicking "${flat(await again.first().innerText())}"`); await again.first().click(); }
    for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); const state = await hostState(page); if (i % 5 === 0) note(`state: ${JSON.stringify(state)}`); }
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    for (const line of seen) note(`event: ${line.replaceAll(audit, '<A>').slice(0, 700)}`);
    await page.keyboard.press('Escape'); await chip.click(); await page.waitForTimeout(700);
    note(`panel after: ${JSON.stringify(await dialogs(page))}`); await shot('panel');
  });
});
