import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Linux integration gate: Zed's project engine in the host, on the real projects of
// apps/lsp-benchmark (`npm run bench:lsp -- fetch`). Setdown's part is only to say which
// folder is open and what a file contains. Zed chooses the server, its root, environment
// and settings, and keeps it told about the text; requests cross unchanged.
//
//   node project.mjs [host]                 the scenarios
//   node project.mjs [host] --scan <folder> what opening a large folder costs
assert.equal(process.platform, 'linux');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const scan = args.includes('--scan') ? path.resolve(args.splice(args.indexOf('--scan'), 2)[1]) : undefined;
const binary = path.resolve(args[0] ?? path.join(repo, 'apps/desktop/dist-electron/language-host/setdown-language-host'));
const sources = process.env.SETDOWN_PROJECT_SOURCES ?? path.join(repo, 'apps/lsp-benchmark/work/sources');
const prepared = path.join(repo, 'apps/lsp-benchmark/work/profile/language-packages/servers');
const prefix = 'SETDOWN-LANGUAGE/1 ';
const sha = text => createHash('sha256').update(text).digest('hex');
// SETDOWN_PROJECT_TRACE=1 prints when the host said what, to see where a slow start spends its time.
const trace = !!process.env.SETDOWN_PROJECT_TRACE;

class Host {
  events = []; pending = new Map(); listeners = new Set(); sequence = 0; errors = ''; started = Date.now();
  constructor(data) {
    this.child = spawn(binary, [data], { stdio: 'pipe' });
    this.child.stderr.setEncoding('utf8'); this.child.stderr.on('data', text => { this.errors = (this.errors + text).slice(-16384); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      if (!line.startsWith(prefix)) return;
      const message = JSON.parse(line.slice(prefix.length));
      if (message.event) {
        if (trace && !['project.diagnostics', 'project.progress'].includes(message.event)) console.log(`  ${String(Date.now() - this.started).padStart(6)} ms ${message.event} ${JSON.stringify({ ...message, event: undefined, workspace: undefined }).slice(0, 160)}`);
        this.events.push(message); for (const listener of this.listeners) listener(); return;
      }
      const waiter = this.pending.get(message.id); this.pending.delete(message.id);
      if ('error' in message) waiter?.reject(Error(message.error)); else waiter?.resolve(message.result);
    });
    this.exited = new Promise(resolve => this.child.on('exit', resolve));
  }
  call(op, values = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(JSON.stringify({ id, op, ...values }) + '\n'); });
  }
  /** The first event, already received or still to come, that `matches`. */
  event(label, matches, seconds = 60) {
    return new Promise((resolve, reject) => {
      const look = () => { const found = this.events.find(matches); if (found) { finish(); resolve(found); } };
      const finish = () => { clearTimeout(timer); this.listeners.delete(look); };
      const timer = setTimeout(() => { finish(); reject(Error(`Timed out waiting for ${label}.\n${this.errors.slice(-2000)}`)); }, seconds * 1000);
      this.listeners.add(look); look();
    });
  }
  /** Resident memory of the host and of every process it started, in MiB. */
  memory() {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/));
    const short = words => words.map(word => path.basename(word)).filter(word => !word.startsWith('-')).slice(0, 3).join(' ');
    const tree = [], walk = pid => { for (const [child, parent, rss, ...words] of rows) if (Number(parent) === pid) { tree.push({ name: short(words), mib: Math.round(rss / 1024) }); walk(Number(child)); } };
    const own = rows.find(row => Number(row[0]) === this.child.pid); walk(this.child.pid);
    return { host: Math.round(own[2] / 1024), servers: tree };
  }
  async stop() { this.child.stdin.end(); await Promise.race([this.exited, new Promise(resolve => setTimeout(resolve, 5000))]); this.child.kill('SIGKILL'); }
}

/** A place is named by text found there, as in the benchmark's cases. */
function place(text, at, on = at) {
  const index = text.indexOf(at); assert.notEqual(index, -1, `"${at}" is not in the file`);
  const offset = index + at.indexOf(on), line = text.slice(0, offset).split('\n').length - 1;
  return { line, character: offset - (text.lastIndexOf('\n', offset - 1) + 1) };
}
const end = text => ({ line: text.split('\n').length - 1, character: text.length - (text.lastIndexOf('\n') + 1) });
const hoverText = result => JSON.stringify(result?.contents ?? '');

async function waitForServer(host, workspace, file, name, seconds) {
  for (const deadline = Date.now() + seconds * 1000; ;) {
    const state = await host.call('project.servers', { workspace, path: file });
    const server = state.servers.find(server => server.name === name);
    if (server) return { ...state, server };
    assert.ok(Date.now() < deadline, `${name} did not start for ${file} (running: ${state.servers.map(s => s.name)}).\n${host.errors.slice(-3000)}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function scenario(host, { name, project, file, server: serverName, hover, mistake, patience = 120 }) {
  const root = path.join(sources, project), target = path.join(root, file), workspace = `window-${name}`;
  assert.ok(existsSync(target), `${target} is missing: run \`npm run bench:lsp -- fetch\``);
  const original = await readFile(target, 'utf8'), digest = sha(original), started = Date.now();
  host.started = started;
  await host.call('project.folder', { workspace, root });
  const opened = await host.call('project.open', { workspace, path: target, text: original, revision: 1 });
  const { server } = await waitForServer(host, workspace, target, serverName, patience);
  const ready = Date.now() - started;

  // A request crosses unchanged; the server may still be reading the project.
  const uri = pathToFileURL(target).href, position = place(original, hover.at, hover.on);
  let answer;
  for (const deadline = Date.now() + patience * 1000; ;) {
    answer = hoverText(await host.call('project.request', { workspace, path: target, server: server.server, method: 'textDocument/hover', params: { textDocument: { uri }, position } }).catch(error => ({ contents: String(error) })));
    if (hover.expect.test(answer)) break;
    assert.ok(Date.now() < deadline, `${name}: hover answered ${answer.slice(0, 300)}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const answered = Date.now() - started;

  // Unsaved text: a first line with Korean and an emoji, then a mistake at the end. Both
  // are sent as ranges in UTF-16 units, the way the editor sends them.
  const comment = name === 'python' ? '# 한글 😀 주석\n' : '// 한글 😀 주석\n';
  let text = comment + original, revision = 2;
  await host.call('project.change', { workspace, path: target, revision, length: text.length,
    changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: comment }] });
  const tail = (text.endsWith('\n') ? '' : '\n') + mistake + '\n', at = end(text);
  text += tail; revision = 3;
  await host.call('project.change', { workspace, path: target, revision, length: text.length, changes: [{ range: { start: at, end: at }, text: tail }] });
  const mistakeLine = text.split('\n').length - 2;
  const marked = await host.event(`${name}: the unsaved mistake to be marked`, event => event.event === 'project.diagnostics' && event.workspace === workspace
    && event.revision === 3 && event.synced && event.diagnostics.some(d => d.range.start.line === mistakeLine && d.severity === 1), patience);
  const found = marked.diagnostics.filter(d => d.range.start.line === mistakeLine).sort((a, b) => a.severity - b.severity)[0];
  assert.equal(sha(await readFile(target, 'utf8')), digest, `${name}: the file on disk changed`);

  // Taking the mistake back clears it, and nothing here ever disagreed with the editor's text.
  revision = 4;
  await host.call('project.change', { workspace, path: target, revision, text: original, length: original.length });
  await host.event(`${name}: the mistake to be cleared`, event => event.event === 'project.diagnostics' && event.workspace === workspace
    && event.revision === 4 && event.server === marked.server && !event.diagnostics.some(d => d.range.start.line >= mistakeLine), patience);
  assert.equal(host.events.some(event => event.event === 'project.diverged' && event.workspace === workspace), false, `${name}: the copy diverged`);
  assert.equal(sha(await readFile(target, 'utf8')), digest, `${name}: the file on disk changed`);
  const memory = host.memory();
  await host.call('project.close', { workspace, path: target });
  return { name, language: opened.language, server: serverName, binary: server.binary, folders: server.folders, readyMs: ready, hoverMs: answered,
    mistake: `${found.source ?? ''} ${found.code ?? ''}: ${found.message.split('\n')[0].slice(0, 80)}`, memory };
}

/** A server's own `workspace/applyEdit` must reach the editor and change nothing here. */
async function serverEdit(host, folder) {
  const workspace = 'window-edit', file = path.join(folder, 'a.yaml'), created = path.join(folder, 'created.txt'), original = 'name: setdown\n';
  await writeFile(file, original);
  await host.call('project.folder', { workspace, root: folder });
  await host.call('project.open', { workspace, path: file, text: original, revision: 1 });
  const { server } = await waitForServer(host, workspace, file, 'yaml-language-server', 30);
  const command = host.call('project.request', { workspace, path: file, server: server.server, method: 'workspace/executeCommand',
    params: { command: 'setdown.edit', arguments: [pathToFileURL(file).href, pathToFileURL(created).href] } });
  const asked = await host.event('the server edit to reach the editor', event => event.event === 'project.applyEdit' && event.workspace === workspace, 20);
  assert.equal(asked.workspaceEdit.documentChanges.length, 2);
  assert.equal(existsSync(created), false, 'the host created a file for a server');
  await host.call('project.applyEditResult', { edit: asked.edit, applied: false, failureReason: 'refused by the editor' });
  assert.deepEqual(await command, { applied: false, failureReason: 'refused by the editor' });
  // The copy still holds the editor's text: a change measured against it fits.
  const next = original + 'more: text\n';
  await host.call('project.change', { workspace, path: file, revision: 2, length: next.length, changes: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: 'more: text\n' }] });
  assert.equal(host.events.some(event => event.event === 'project.diverged' && event.workspace === workspace), false, 'a server edit changed the copy');
  assert.equal(await readFile(file, 'utf8'), original); assert.equal(existsSync(created), false);
  // Saving is the editor's: it writes, then says so, and the server hears `didSave`.
  await writeFile(file, next);
  assert.deepEqual(await host.call('project.saved', { workspace, path: file, revision: 2 }), { saved: true });
  assert.deepEqual(await host.call('project.saved', { workspace, path: file, revision: 1 }), { saved: false });
  await host.call('project.close', { workspace, path: file });
}

const work = await mkdtemp(path.join(os.tmpdir(), 'setdown zed project '));
const data = process.env.SETDOWN_PROJECT_DATA ?? path.join(work, 'data');
const host = new Host(data);
try {
  await mkdir(path.join(data, 'servers'), { recursive: true });
  if (scan) {
    const before = host.memory().host, started = Date.now();
    await host.call('project.folder', { workspace: 'scan', root: scan });
    let last = 0, steady = 0, peak = 0;
    while (steady < 5 && Date.now() - started < 300_000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const now = host.memory().host; peak = Math.max(peak, now); steady = Math.abs(now - last) <= 2 ? steady + 1 : 0; last = now;
    }
    console.log(JSON.stringify({ folder: scan, beforeMiB: before, afterMiB: last, peakMiB: peak, seconds: Math.round((Date.now() - started) / 1000) - 5 }));
  } else {
    // rust-analyzer is 40 MB: reuse the benchmark's copy when it has one, otherwise Zed downloads it.
    if (!process.env.SETDOWN_PROJECT_DATA && existsSync(path.join(prepared, 'rust-analyzer'))) await cp(path.join(prepared, 'rust-analyzer'), path.join(data, 'servers/rust-analyzer'), { recursive: true });
    const node = process.execPath, modules = path.join(repo, 'node_modules');
    // Setdown's choices as Zed settings: its tools for Python and TypeScript, at the copies
    // the app ships, and a stand-in for the YAML server.
    await host.call('project.settings', { defaults: JSON.stringify({
      // Zed installs Prettier for its own formatting and lets TypeScript fetch typings; Setdown downloads neither.
      formatter: 'language_server',
      languages: { Python: { language_servers: ['pyright'] }, TypeScript: { language_servers: ['typescript-language-server'] }, YAML: { language_servers: ['yaml-language-server'] } },
      lsp: {
        pyright: { binary: { path: node, arguments: [path.join(modules, 'pyright/langserver.index.js'), '--stdio'] } },
        'typescript-language-server': { binary: { path: node, arguments: [path.join(modules, 'typescript-language-server/lib/cli.mjs'), '--stdio'] },
          initialization_options: { disableAutomaticTypingAcquisition: true } },
        'yaml-language-server': { binary: { path: node, arguments: [fileURLToPath(new URL('edit-server.mjs', import.meta.url))] } },
      },
    }) });
    const folder = path.join(work, 'edit'); await mkdir(folder);
    await serverEdit(host, folder);
    console.log('PASS: a server edit reaches the editor, changes neither the copy nor the disk, and saving stays the editor\'s.');
    const results = [];
    for (const each of [
      { name: 'typescript', project: 'p-queue', file: 'source/index.ts', server: 'typescript-language-server', mistake: "const setdownMistake: number = 'three';",
        hover: { at: 'this.#queue.enqueue(run, options)', on: 'enqueue', expect: /enqueue: \(run: RunFunction/ } },
      { name: 'python', project: 'flask', file: 'src/flask/app.py', server: 'pyright', mistake: 'setdown_mistake: int = "three"',
        hover: { at: 'MapAdapter | None:', expect: /\(class\) MapAdapter|class MapAdapter/ } },
      { name: 'rust', project: 'walkdir', file: 'src/lib.rs', server: 'rust-analyzer', mistake: 'fn setdown_mistake() { setdown_mistake(1); }', patience: 300,
        hover: { at: 'pub struct WalkDir', on: 'WalkDir', expect: /WalkDir/ } },
    ].filter(each => !process.env.SETDOWN_PROJECT_ONLY || new RegExp(process.env.SETDOWN_PROJECT_ONLY).test(each.name))) {
      const result = await scenario(host, each); results.push(result);
      console.log(`PASS ${result.name}: ${result.language} by ${result.server} (${path.relative(repo, result.binary)}), ready ${result.readyMs} ms, hover ${result.hoverMs} ms, marked "${result.mistake.trim()}", host ${result.memory.host} MiB, started ${result.memory.servers.map(s => `[${s.name}] ${s.mib}`).join(', ')}`);
    }
    if (process.env.SETDOWN_PROJECT_RESULT) await writeFile(process.env.SETDOWN_PROJECT_RESULT, JSON.stringify(results, null, 2));
  }
} finally {
  await host.stop();
  await rm(work, { recursive: true, force: true });
}
