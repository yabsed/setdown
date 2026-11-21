import { test, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../test/support/electron/electron-app';

// A one-off look at what a person sees around a file of a language Setdown does not answer for
// itself: the tool comes from the imported Zed catalog and is installed only after they ask.
// Not a test of record. AUDIT_DIR holds `sources/` (real projects at fixed commits), the profile
// the tools are installed into, and the notes and screenshots this writes.
const audit = process.env.AUDIT_DIR!;
const bench = path.resolve(process.cwd(), '../lsp-benchmark/work/sources');
type Case = { name: string; root: string; file: string; line: number; word: string; wait?: number;
  /** A Markdown document opens in the reader: switch to its source first. */
  source?: boolean;
  /** Something a person does beyond looking: rename the word, write a type error after the line, or choose the project's tool. */
  flow?: 'rename' | 'type-error' | 'choose-tool' | 'default-tool' | 'notice-action'; tool?: RegExp };
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
  // The frameworks that sit on the TypeScript server: the framework's own file, and a script that imports one.
  { name: 'react', root: own('react-error-boundary'), file: 'lib/components/ErrorBoundary.tsx', line: 3, word: 'ErrorBoundaryContextProvider' },
  { name: 'svelte', root: path.join(bench, 'realworld'), file: 'src/routes/+layout.svelte', line: 4, word: 'Nav' },
  { name: 'vue-script', root: own('vue3-realworld-example-app'), file: 'src/components/ArticleDetail.vue', line: 58, word: 'useRoute' },
  { name: 'vue-template', root: own('vue3-realworld-example-app'), file: 'src/components/ArticleDetail.vue', line: 41, word: 'ArticleDetailMeta' },
  { name: 'vue-ts', root: own('vue3-realworld-example-app'), file: 'src/router.ts', line: 38, word: 'Article' },
  { name: 'angular', root: own('angular-realworld-example-app'), file: 'src/app/features/article/pages/article/article.component.html', line: 14, word: 'title' },
  { name: 'angular-ts', root: own('angular-realworld-example-app'), file: 'src/app/features/article/pages/article/article.component.ts', line: 6, word: 'ArticlesService' },
  { name: 'mdx', root: own('mdx'), file: 'docs/blog/shortcodes.mdx', line: 11, word: 'Note' },
  { name: 'marko', root: own('examples/examples/basic'), file: 'src/routes/+page.marko', line: 16, word: 'mouse-mask' },
  { name: 'deno', root: own('oak'), file: 'application.ts', line: 24, word: 'Context' },
  { name: 'ember', root: own('super-rentals'), file: 'app/components/rental.gjs', line: 7, word: 'RentalImage' },
  { name: 'marko-ts', root: own('examples/examples/app'), file: 'src/tags/char-count/stories.ts', line: 3, word: 'Template' },
  { name: 'vue-rename', root: own('vue3-realworld-example-app'), file: 'src/components/ArticleDetail.vue', line: 59, word: 'slug', flow: 'rename' },
  { name: 'vue-error', root: own('vue3-realworld-example-app'), file: 'src/components/ArticleDetail.vue', line: 59, word: 'slug', flow: 'type-error' },
  { name: 'deno-choose', root: own('oak'), file: 'application.ts', line: 569, word: 'Deno', flow: 'choose-tool', tool: /deno/i },
  { name: 'deno-default', root: own('oak'), file: 'application.ts', line: 569, word: 'Deno', flow: 'default-tool' },
  { name: 'mdx-source', root: own('mdx'), file: 'docs/blog/shortcodes.mdx', line: 1, word: 'Note', source: true },
  // The one button of the notice a Deno project gets.
  { name: 'deno-action', root: own('oak'), file: 'application.ts', line: 569, word: 'Deno', flow: 'notice-action', tool: /^Use Deno's tool$/ },
  { name: 'angular-url', root: own('angular-realworld-example-app'), file: 'src/app/features/article/pages/article/article.component.ts', line: 27, word: 'article.component.html' },
  { name: 'astro-ts', root: own('astro-paper'), file: 'src/utils/getSortedPosts.ts', line: 1, word: 'CollectionEntry' },
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
    // What the app's own process and the page's console say, kept beside the notes.
    const output = path.join(out, `${pass}-app-output.txt`);
    writeFileSync(output, '');
    const said = (from: string) => (text: unknown) => appendFileSync(output, String(text).split('\n').filter(Boolean).map(line => `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${from}: ${line.slice(0, 2000)}\n`).join(''));
    application.process().stdout?.on('data', said('out')); application.process().stderr?.on('data', said('err'));
    const note = (line: string) => { const stamped = `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`; notes.push(stamped); console.log(stamped); appendFileSync(live, stamped + '\n'); };
    let shots = 0;
    const shot = async (page: Page, name: string) => { await page.screenshot({ path: path.join(out, `${pass}-${String(++shots).padStart(2, '0')}-${name}.png`) }).catch(() => {}); };
    const step = async (name: string, run: () => Promise<void>) => { try { await run(); } catch (error) { note(`STEP FAILED ${name}: ${String(error).split('\n')[0].slice(0, 300)}`); } };
    try {
      const page = await application.firstWindow(); await focusApplication(application);
      page.on('pageerror', error => note(`PAGE ERROR ${String(error).slice(0, 300)}`));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) said('page')(message.text()); });
      const editor = editorOf(page);
      if (item.source) {
        const toggle = page.getByRole('button', { name: 'Switch to Editor', exact: true });
        await toggle.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => note('no "Switch to Editor" button'));
        await page.waitForTimeout(2500); await shot(page, 'reader');
        // The reader is a native view: only a picture of the whole display shows it.
        await promisify(execFile)('import', ['-window', 'root', path.join(out, `${pass}-reader-native.png`)]).catch(error => note(`native capture failed: ${String(error).slice(0, 120)}`));
        if (await toggle.count()) { await toggle.click(); note('clicked "Switch to Editor"'); }
      }
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
        if (item.flow === 'notice-action') {
          const action = page.getByRole('dialog').getByRole('button', { name: item.tool! });
          if (!await action.count()) { note(`the notice has no such button: ${JSON.stringify(await dialogs(page))}`); return; }
          note(`clicking "${flat(await action.first().innerText())}"`); await action.first().click(); await page.waitForTimeout(2500);
          note(`after the button: ${JSON.stringify(await dialogs(page))} ${JSON.stringify(await hostState(page))}`);
          await shot(page, 'after-action');
        }
        if (item.flow === 'choose-tool' || item.flow === 'default-tool') {
          let choose = page.getByRole('dialog').getByRole('button', { name: 'Choose analysis tool…', exact: true });
          if (!await choose.count()) { await page.getByRole('dialog').getByRole('button', { name: 'More…', exact: true }).click().catch(() => {}); await page.waitForTimeout(600); choose = page.getByRole('dialog').getByRole('button', { name: 'Choose analysis tool…', exact: true }); }
          // With a tool connected the button is on the tool's own page, one step further.
          if (!await choose.count()) { await page.getByRole('dialog').locator('.detail-block .analysis-row').last().click().catch(() => {}); await page.waitForTimeout(600); choose = page.getByRole('dialog').getByRole('button', { name: 'Choose analysis tool…', exact: true }); }
          if (!await choose.count()) { note(`no "Choose analysis tool…": ${JSON.stringify(await dialogs(page))}`); return; }
          await choose.first().click(); await page.waitForTimeout(800);
          const select = page.getByRole('dialog').getByRole('combobox', { name: 'Analysis provider', exact: true });
          const options = await select.locator('option').allInnerTexts();
          note(`chooser: ${JSON.stringify(await dialogs(page))} options=${JSON.stringify(options)} selected=${await select.inputValue().catch(() => '?')}`);
          await shot(page, 'chooser');
          const wanted = item.flow === 'default-tool' ? 'Use app default' : options.find(option => item.tool!.test(option));
          if (!wanted) { note('the wanted tool is not offered'); return; }
          await select.selectOption({ label: wanted }); note(`chose "${wanted}"`); await page.waitForTimeout(2500);
          note(`after choosing: ${JSON.stringify(await dialogs(page))} ${JSON.stringify(await hostState(page))}`);
          await shot(page, 'chosen');
          const back = page.getByRole('dialog').getByRole('button', { name: /^(‹|Back)/ }); if (await back.count()) await back.first().click().catch(() => {}); await page.waitForTimeout(600);
          note(`panel after choosing: ${JSON.stringify(await dialogs(page))}`);
        }
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
        const tools = await page.getByRole('dialog').locator('.detail-block').count();
        for (let index = 0; index < tools; index++) {
          const row = page.getByRole('dialog').locator('.detail-block').nth(index).locator('.analysis-row').first();
          const name = flat(await row.innerText().catch(() => ''), 80);
          await row.click().catch(() => {}); await page.waitForTimeout(600);
          const context = page.getByRole('dialog').locator('details').first();
          if (await context.count()) { await context.locator('summary').click().catch(() => {}); await page.waitForTimeout(300); note(`tool page (${name}): ${flat(await page.getByRole('dialog').first().innerText(), 2200)}`); await shot(page, `tool-${index + 1}`); }
          else note(`tool page (${name}): no context section; ${JSON.stringify(await dialogs(page))}`);
          const back = page.getByRole('dialog').getByRole('button', { name: /^(‹|Back)/ }); if (await back.count()) await back.first().click().catch(() => {}); await page.waitForTimeout(400);
        }
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
      await step('rename', async () => {
        if (!place || item.flow !== 'rename') return;
        await page.mouse.click(place.x + 3, place.y + place.height / 2); await page.waitForTimeout(300);
        await editor.press('F2'); await page.waitForTimeout(2500);
        const box = page.locator('.rename-box input:visible, .monaco-editor .rename-input:visible').first();
        note(`F2: ${await box.count() ? `rename box with "${await box.inputValue().catch(() => '?')}"` : 'no rename box'} message=${await textOf(page.locator('.monaco-editor-overlaymessage:visible'), 160)} dialogs=${JSON.stringify(await dialogs(page))}`);
        await shot(page, 'rename-box');
        if (!await box.count()) return;
        const renamed = `${item.word}Renamed`;
        await page.keyboard.press('Control+a'); await page.keyboard.type(renamed); await page.keyboard.press('Enter'); await page.waitForTimeout(5000);
        const lines = await page.evaluate(word => [...document.querySelectorAll('.editor-host .view-line')].map(line => (line.textContent ?? '').replace(/\u00a0/g, ' ')).filter(line => line.includes(word)).map(line => line.trim().slice(0, 110)), renamed);
        note(`after rename to ${renamed}: ${lines.length} lines in view have it: ${JSON.stringify(lines)} dialogs=${JSON.stringify(await dialogs(page))} tab=${await selectedTab(page)}`);
        await shot(page, 'renamed');
        for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(300); }
        note(`after undo: on disk ${(await readFile(file, 'utf8')) === text ? 'unchanged' : 'CHANGED'}; in view ${await page.evaluate(word => [...document.querySelectorAll('.editor-host .view-line')].filter(line => (line.textContent ?? '').includes(word)).length, renamed)} lines still have the new name`);
      });
      await step('type error', async () => {
        if (!place || item.flow !== 'type-error') return;
        await page.mouse.click(place.x + 3, place.y + place.height / 2); await page.waitForTimeout(300);
        await page.keyboard.press('End'); await page.keyboard.press('Enter');
        await page.keyboard.type(`const wrongNumber: number = ${item.word}`, { delay: 15 }); await page.keyboard.press('Escape');
        let seen = await squiggles(page);
        for (let waited = 0; waited < 20_000 && !seen.error; waited += 1000) { await page.waitForTimeout(1000); seen = await squiggles(page); }
        note(`after writing a wrong assignment: squiggles=${JSON.stringify(seen)}`);
        const typed = await cursorPlace(page);
        // The pointer goes onto the red line itself, wherever the tool drew it.
        const marked = await page.evaluate(() => { const box = [...document.querySelectorAll('.editor-host .squiggly-error')].map(mark => mark.getBoundingClientRect()).find(rect => rect.width > 2); return box ? { x: box.x + Math.min(box.width / 2, 12), y: box.y + box.height / 2 } : null; });
        if (marked) { await page.mouse.move(marked.x - 1, marked.y); await page.mouse.move(marked.x, marked.y);
          const hover = page.locator('.monaco-hover:visible').first(); await hover.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
          note(`hover on the error: ${await hover.count() ? flat(await hover.innerText(), 600) : '(nothing appeared)'}`); }
        else note('no red line to point at');
        await shot(page, 'type-error');
        await page.mouse.move(40, 400); await page.keyboard.press('Escape');
        if (await openPanel(page)) {
          note(`panel with the error: ${JSON.stringify(await dialogs(page))}`);
          const problems = page.getByRole('dialog').getByText('Problems', { exact: true });
          if (!await problems.count()) { await page.getByRole('dialog').getByRole('button', { name: 'More…', exact: true }).click().catch(() => {}); await page.waitForTimeout(600); }
          if (await problems.count()) { await problems.first().click().catch(() => {}); await page.waitForTimeout(800); note(`problems with the error: ${JSON.stringify(await dialogs(page))}`); await shot(page, 'type-error-problems'); }
          for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
        }
        if (typed) await page.mouse.click(typed.x, typed.y + typed.height / 2);
        for (let i = 0; i < 60 && !((await page.evaluate(() => [...document.querySelectorAll('.editor-host .view-line')].some(line => (line.textContent ?? '').includes('wrongNumber')))) === false); i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }
        // The tools answer after the text has changed, so the red line is given time to go.
        const undone = Date.now(); let left = await squiggles(page);
        while (left.error && Date.now() - undone < 20_000) { await page.waitForTimeout(500); left = await squiggles(page); }
        note(`after undo: on disk ${(await readFile(file, 'utf8')) === text ? 'unchanged' : 'CHANGED'}; squiggles=${JSON.stringify(left)} after ${Date.now() - undone} ms`);
        if (place) await page.mouse.click(place.x + 3, place.y + place.height / 2);
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
