import { test, type Locator, type Page } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../test/support/electron/electron-app';

// A one-off look at what a person sees around a file of a language Setdown does not answer for
// itself: the tool comes from the imported Zed catalog and is installed only after they ask.
// Not a test of record. AUDIT_DIR holds `sources/` (real projects at fixed commits), the profile
// the tools are installed into, and the notes and screenshots this writes.
const audit = process.env.AUDIT_DIR!;
const bench = path.resolve(process.cwd(), '../lsp-benchmark/work/sources');
type Case = { name: string; root: string; file: string; line: number; word: string; wait?: number };
const own = (project: string) => path.join(audit, 'sources', project);
const cases: Case[] = [
  { name: 'lua', root: own('plenary.nvim'), file: 'lua/plenary/job.lua', line: 142, word: 'if_nil' },
  { name: 'toml', root: path.join(bench, 'walkdir'), file: 'Cargo.toml', line: 1, word: 'package' },
  { name: 'ruby', root: own('sinatra'), file: 'lib/sinatra/main.rb', line: 30, word: 'Base' },
  { name: 'shell', root: own('nvm'), file: 'install.sh', line: 48, word: 'nvm_echo' },
  { name: 'haskell', root: own('extra'), file: 'src/Data/List/Extra.hs', line: 268, word: 'first', wait: 600 },
  { name: 'ocaml', root: own('yojson'), file: 'bin/ydump.ml', line: 37, word: 'from_channel' },
  { name: 'r', root: own('stringr'), file: 'R/detect.R', line: 42, word: 'check_lengths' },
  { name: 'perl', root: own('mojo'), file: 'lib/Mojolicious.pm', line: 28, word: 'Home' },
  { name: 'latex', root: own('Awesome-CV'), file: 'examples/resume.tex', line: 55, word: 'name' },
  { name: 'vue', root: own('vue3-realworld-example-app'), file: 'src/pages/Article.vue', line: 28, word: 'ArticleDetail' },
  { name: 'astro', root: own('astro-paper'), file: 'src/layouts/Layout.astro', line: 4, word: 'resolveDefaultOgImagePath' },
  { name: 'terraform', root: own('terraform-aws-vpc'), file: 'main.tf', line: 2, word: 'public_subnet_ipv6_prefixes' },
  { name: 'typst', root: own('templates'), file: 'charged-ieee/template/main.typ', line: 3, word: 'ieee' },
  { name: 'proto', root: own('grpc-proto'), file: 'grpc/gcp/handshaker.proto', line: 106, word: 'RpcProtocolVersions' },
  { name: 'clojure', root: own('ring'), file: 'ring-core/src/ring/util/response.clj', line: 96, word: 'split' },
  { name: 'xml', root: path.join(bench, 'petclinic'), file: 'pom.xml', line: 12, word: 'artifactId' },
  { name: 'cmake', root: path.join(bench, 'fmt'), file: 'CMakeLists.txt', line: 1, word: 'cmake_minimum_required' },
  { name: 'make', root: path.join(bench, 'cjson'), file: 'Makefile', line: 1, word: 'CJSON_OBJ' },
  { name: 'markdown', root: own('sinatra'), file: 'README.md', line: 1, word: 'Sinatra' },
  { name: 'csharp', root: own('serilog'), file: 'src/Serilog/Log.cs', line: 36, word: 'ILogger' },
  { name: 'swift', root: own('swift-argument-parser'), file: 'Sources/ArgumentParser/Parsable Types/ParsableCommand.swift', line: 16, word: 'CommandConfiguration' },
  { name: 'dart', root: own('http'), file: 'pkgs/http/lib/src/client.dart', line: 11, word: 'http' },
  { name: 'elixir', root: own('plug'), file: 'lib/plug/conn.ex', line: 1, word: 'Unfetched' },
  { name: 'zig', root: own('http.zig'), file: 'src/httpz.zig', line: 8, word: 'routing' },
  { name: 'scala', root: own('os-lib'), file: 'os/src/Path.scala', line: 6, word: 'Paths', wait: 600 },
  { name: 'nix', root: own('nix-direnv'), file: 'default.nix', line: 11, word: 'mkDerivation' },
  { name: 'julia', root: own('DataStructures.jl'), file: 'src/deque.jl', line: 13, word: 'DequeBlock' },
  { name: 'gleam', root: own('stdlib'), file: 'src/gleam/list.gleam', line: 28, word: 'Order' },
];

const flat = (text: string | null | undefined, limit = 900) => (text ?? '').replace(/\s*\n\s*/g, ' | ').replace(/[ \t ]+/g, ' ').trim().slice(0, limit);
const chipOf = (page: Page) => page.getByRole('button', { name: /^Language status:/ }).first();
const editorOf = (page: Page) => page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }).first();
async function hostState(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('.editor-group.focused .editor-host') ?? document.querySelector('.editor-host');
    const chip = [...document.querySelectorAll('button')].find(button => /^Language status:/.test(button.getAttribute('aria-label') ?? ''));
    return { server: host?.getAttribute('data-language-server') ?? null, chip: chip?.getAttribute('aria-label') ?? null, chipText: chip?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      turning: !!chip?.querySelector('.turning'), indicator: chip?.querySelector('.indicator')?.textContent ?? null };
  });
}
const dialogs = async (page: Page) => (await page.getByRole('dialog').allInnerTexts().catch(() => [] as string[])).map(text => flat(text, 1600));
async function colours(page: Page) {
  return page.evaluate(() => {
    const spans = [...document.querySelectorAll('.editor-group.focused .view-lines span span, .view-lines span span')];
    return new Set(spans.flatMap(span => [...span.classList].filter(name => /^mtk\d+$/.test(name)))).size;
  });
}
async function squiggles(page: Page) {
  return page.evaluate(() => Object.fromEntries(['error', 'warning', 'info', 'hint'].map(kind => [kind, document.querySelectorAll(`.squiggly-${kind}`).length])));
}
async function cursorPlace(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.editor-group.focused .monaco-editor') ?? document.querySelector('.monaco-editor.focused') ?? document.querySelector('.monaco-editor');
    const cursor = editor?.querySelector('.cursors-layer .cursor');
    if (!editor || !cursor) return null;
    const box = cursor.getBoundingClientRect(), middle = box.y + box.height / 2;
    const line = [...editor.querySelectorAll('.view-line')].find(item => { const r = item.getBoundingClientRect(); return r.top <= middle && middle < r.bottom; });
    const number = [...editor.querySelectorAll('.margin .line-numbers')].find(item => { const r = item.getBoundingClientRect(); return r.top <= middle && middle < r.bottom; });
    return { x: box.x, y: box.y, height: box.height, text: (line?.textContent ?? '').replace(/ /g, ' ').slice(0, 160), number: number?.textContent ?? null };
  });
}
const textOf = async (locator: Locator, limit = 200) => await locator.count() ? flat(await locator.first().textContent(), limit) : '';
async function openPanel(page: Page) {
  const chip = chipOf(page);
  if (!await chip.count()) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await page.getByRole('dialog').count()) return true;
    await chip.click(); await page.waitForTimeout(900);
  }
  return !!await page.getByRole('dialog').count();
}
const selectedTab = async (page: Page) => flat(await page.locator('.editor-group.focused .document-tab[aria-selected="true"] .tab-name').first().textContent().catch(() => ''), 80);

for (const item of cases) {
  test(`audit ${item.name}`, async () => {
    test.setTimeout(((item.wait ?? 300) + 420) * 1000);
    const out = path.join(audit, 'runs', item.name), file = path.join(item.root, item.file), pass = process.env.AUDIT_PASS ?? 'first';
    await mkdir(out, { recursive: true });
    const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
    const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(audit, 'profile'), SETDOWN_LSP_INHERIT_ENV: '1' } });
    const started = Date.now(), notes: string[] = [];
    const live = path.join(out, `${pass}-notes.live.txt`);
    writeFileSync(live, '');
    const note = (line: string) => { const stamped = `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`; notes.push(stamped); console.log(stamped); appendFileSync(live, stamped + '\n'); };
    let shots = 0;
    const shot = async (page: Page, name: string) => { await page.screenshot({ path: path.join(out, `${pass}-${String(++shots).padStart(2, '0')}-${name}.png`) }).catch(() => {}); };
    const step = async (name: string, run: () => Promise<void>) => { try { await run(); } catch (error) { note(`STEP FAILED ${name}: ${String(error).split('\n')[0].slice(0, 300)}`); } };
    try {
      const page = await application.firstWindow(); await focusApplication(application);
      page.on('pageerror', error => note(`PAGE ERROR ${String(error).slice(0, 300)}`));
      const editor = editorOf(page);
      await editor.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => note('no code editor became visible'));
      await page.waitForTimeout(4000);
      note(`at rest: ${JSON.stringify(await hostState(page))} tab=${await selectedTab(page)} token colours=${await colours(page)}`);
      await shot(page, 'open');

      // What the button says, and what is behind it.
      const chip = chipOf(page);
      let installed = false;
      await step('panel', async () => {
        if (!await openPanel(page)) { note('no language button, or nothing opened behind it'); return; }
        note(`panel: ${JSON.stringify(await dialogs(page))}`);
        note(`panel buttons: ${JSON.stringify(await page.getByRole('dialog').getByRole('button').allInnerTexts().catch(() => []))}`);
        await shot(page, 'panel');
        const install = page.getByRole('dialog').getByRole('button', { name: /^Install .+ support$/ });
        if (await install.count()) { note(`clicking "${flat(await install.first().innerText())}"`); await install.first().click(); installed = true; }
      });
      // What happens while the tool is prepared, until it answers or the screen stops changing.
      await step('wait', async () => {
        let last = '', changed = Date.now(), busyShot = false;
        const limit = Date.now() + (item.wait ?? 300) * 1000;
        while (Date.now() < limit) {
          const state = await hostState(page), panel = (await dialogs(page))[0] ?? '(panel closed)';
          const now = JSON.stringify({ ...state, panel: panel.slice(0, 500) });
          if (now !== last) { note(`state: ${now}`); last = now; changed = Date.now(); if (state.turning && !busyShot) { busyShot = true; await shot(page, 'busy'); } }
          const quiet = Date.now() - changed;
          if (state.server === 'ready' && !state.turning && quiet > 6000) break;
          if (!state.turning && quiet > (installed ? 45_000 : 15_000)) break;
          await page.waitForTimeout(1500);
        }
        note(`settled: ${JSON.stringify(await hostState(page))}`);
        await shot(page, 'settled');
      });
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.waitForTimeout(8000);
      const ready = (await hostState(page)).server === 'ready';
      note(`after waiting: ${JSON.stringify(await hostState(page))} squiggles in view=${JSON.stringify(await squiggles(page))}`);

      await step('details', async () => {
        if (!await openPanel(page)) { note('the panel did not open'); return; }
        note(`panel now: ${JSON.stringify(await dialogs(page))}`);
        const more = page.getByRole('dialog').getByRole('button', { name: 'More…', exact: true });
        if (await more.count()) { await more.click(); await page.waitForTimeout(700); note(`details: ${JSON.stringify(await dialogs(page))}`); await shot(page, 'details'); }
        const log = page.getByRole('dialog').getByText('Show log', { exact: true });
        if (await log.count()) { await log.first().click(); await page.waitForTimeout(900); const text = (await page.getByRole('dialog').allInnerTexts()).join('\n'); note(`log (end): ${flat(text.slice(-2600), 2600)}`); await shot(page, 'log'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
        else note('no "Show log" in the details');
        const problems = page.getByRole('dialog').getByText('Problems', { exact: true });
        if (await problems.count()) { await problems.first().click().catch(() => {}); await page.waitForTimeout(700); note(`problems: ${JSON.stringify(await dialogs(page))}`); await shot(page, 'problems');
          const back = page.getByRole('dialog').getByRole('button', { name: /^(‹|Back)/ }); if (await back.count()) await back.first().click().catch(() => {}); await page.waitForTimeout(300); }
        for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
      });

      // The place a person asks about.
      const text = await readFile(file, 'utf8'), lineText = text.split('\n')[item.line - 1] ?? '', column = Math.max(0, lineText.indexOf(item.word));
      let place: Awaited<ReturnType<typeof cursorPlace>> = null;
      await step('cursor', async () => {
        const area = await page.evaluate(() => {
          const hosts = [...document.querySelectorAll('.editor-group.focused .editor-host .monaco-editor'), ...document.querySelectorAll('.editor-host .monaco-editor')];
          const box = hosts.map(host => host.getBoundingClientRect()).find(rect => rect.width > 200 && rect.height > 100);
          return box ? { x: box.x, y: box.y } : null;
        });
        if (area) await page.mouse.click(area.x + 300, area.y + 40); else note('the code editor was not found on screen');
        await page.waitForTimeout(200);
        note(`focus is in: ${await page.evaluate(() => { const el = document.activeElement; return el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.getAttribute('aria-label') ?? '').slice(0, 40)}"` : 'nothing'; })}`);
        await page.keyboard.press('Control+Home');
        // What one cursor key costs here: thirty lines down, timed.
        const before = Date.now();
        for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
        note(`arrow key: ${Math.round((Date.now() - before) / 30)} ms per press over 30 presses`);
        await page.keyboard.press('Control+Home');
        for (let i = 1; i < item.line; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Home'); await page.keyboard.press('Home');
        for (let i = 0; i < column + 1; i++) await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(400);
        place = await cursorPlace(page);
        note(`cursor: wanted line ${item.line} "${lineText.trim().slice(0, 80)}" word ${item.word}; got ${JSON.stringify(place)}`);
      });
      await step('hover', async () => {
        if (!place) return;
        await page.mouse.move(place.x + 2, place.y + place.height / 2); await page.mouse.move(place.x + 3, place.y + place.height / 2);
        const hover = page.locator('.monaco-hover:visible').first();
        await hover.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        note(`hover: ${await hover.count() ? flat(await hover.innerText(), 700) : '(nothing appeared)'}`);
        await shot(page, 'hover');
        await page.mouse.move(40, 400); await page.keyboard.press('Escape');
      });
      await step('menu', async () => {
        if (!place) return;
        await page.mouse.click(place.x + 3, place.y + place.height / 2, { button: 'right' }); await page.waitForTimeout(2500);
        const menu = page.getByRole('dialog', { name: 'Actions here', exact: true });
        if (await menu.count()) {
          const rows = await menu.getByRole('option').evaluateAll(list => list.map(row => `${row.querySelector('.group')?.textContent?.trim() ?? ''}:${row.querySelector('.label')?.textContent?.trim() ?? ''}${row.querySelector('kbd') ? ` [${row.querySelector('kbd')!.textContent}]` : ''}`));
          note(`menu at the cursor (${rows.length}): subject=${await textOf(menu.locator('.subject'), 120)} rows=${JSON.stringify(rows)} status=${await textOf(menu.getByRole('status'), 80)} hover still shown=${await page.locator('.monaco-hover:visible').count()}`);
        } else note(`menu at the cursor: not the app's menu; other menus: ${await textOf(page.locator('.context-view .monaco-menu, [role="menu"]'), 400) || '(none)'}`);
        await shot(page, 'menu');
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      });
      await step('completion', async () => {
        if (!place) return;
        await page.mouse.click(place.x + 3, place.y + place.height / 2); await page.waitForTimeout(300);
        await page.keyboard.press('Control+Space');
        const suggest = page.locator('.suggest-widget.visible').first();
        await suggest.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        const rows = await suggest.locator('.monaco-list-row').evaluateAll(list => list.slice(0, 8).map(row => row.getAttribute('aria-label')?.slice(0, 70))).catch(() => [] as (string | undefined)[]);
        note(`completion (Ctrl+Space) at ${JSON.stringify((await cursorPlace(page))?.text?.slice(0, 60))}: ${await suggest.count() ? JSON.stringify(rows) : '(no list)'} message=${await textOf(suggest.locator('.message'), 80)}`);
        await shot(page, 'completion');
        await page.keyboard.press('Escape');
      });
      await step('commands', async () => {
        if (place) await page.mouse.click(place.x + 3, place.y + place.height / 2);
        await page.waitForTimeout(300); await page.keyboard.press('F1'); await page.waitForTimeout(900);
        const list = page.getByRole('dialog', { name: 'Commands', exact: true });
        if (!await list.count()) { note(`F1: no command list; dialogs=${JSON.stringify(await dialogs(page))}`); return; }
        note(`F1, nothing typed: ${flat(await list.innerText(), 900)}`);
        await shot(page, 'commands');
        const input = list.getByRole('searchbox');
        for (const query of ['format', 'rename', 'symbol', 'restart']) { await input.fill(query); await page.waitForTimeout(400); note(`F1 "${query}": ${JSON.stringify((await list.getByRole('option').allInnerTexts()).slice(0, 6).map(row => flat(row, 70)))}`); }
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      });
      await step('definition', async () => {
        if (!place) return;
        await editor.press('F12'); await page.waitForTimeout(3500);
        const after = await cursorPlace(page);
        note(`go to definition (F12): tab=${await selectedTab(page)} cursor=${JSON.stringify(after)} peek=${await page.locator('.peekview-widget:visible').count()} message=${await textOf(page.locator('.monaco-editor-overlaymessage:visible'), 120)}`);
        await shot(page, 'definition');
        await page.keyboard.press('Escape');
      });
      await step('language support view', async () => {
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click(); await page.waitForTimeout(1800);
        const view = page.getByRole('region', { name: 'Language Support', exact: true });
        note(`Language Support view: ${await view.count() ? flat(await view.innerText(), 1500) : `(not found) dialogs=${JSON.stringify(await dialogs(page))}`}`);
        await shot(page, 'language-support');
      });
      note(`end: ready=${ready} ${JSON.stringify(await hostState(page))} squiggles in view=${JSON.stringify(await squiggles(page))}`);
    } finally {
      await writeFile(path.join(out, `${pass}-notes.txt`), notes.join('\n') + '\n');
      await disposeApplication(application);
    }
  });
}
