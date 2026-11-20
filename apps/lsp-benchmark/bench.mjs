#!/usr/bin/env node
// Opens files of real projects through Setdown's own language manager and records what
// each language's tool answers. See README.md.
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.mjs';
import { after, at, completionLabels, definitionTargets, diagnosticSummary, errorsAbove, hoverText, leadsTo, marksLine, offers, shorten, withMistake } from './lib/checks.mjs';
import { results, work } from './lib/paths.mjs';
import { product } from './lib/product.mjs';
import { failures, table } from './lib/report.mjs';
import { prepare } from './lib/sources.mjs';
import { projects } from './projects.mjs';

const [command = 'run', ...rest] = process.argv.slice(2);
const option = name => { const index = rest.indexOf(`--${name}`); return index < 0 ? undefined : rest[index + 1]; };
const flag = name => rest.includes(`--${name}`);
const latest = path.join(results, `${option('run') ?? 'latest'}.json`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (command === 'report') {
  const run = JSON.parse(await readFile(latest, 'utf8'));
  console.log(table(run)); process.exit(failures(run).length ? 1 : 0);
} else if (command !== 'run' && command !== 'fetch') {
  console.error('Usage: bench.mjs run [--only <regex>] [--tool <id> [--program <file>]] [--fresh] [--run <name>] | fetch [--only <regex>] | report [--run <name>]'); process.exit(2);
}

const only = option('only') ? new RegExp(option('only')) : undefined;
const selected = cases.filter(item => !only || only.test(item.id));
// The projects come first and one after another: a library download is not a tool's time.
const roots = new Map();
for (const name of new Set(selected.map(item => item.project)))
  roots.set(name, await prepare(name, projects[name], { note: line => process.stderr.write(`${line}\n`) }));
if (command === 'fetch') process.exit(0);

const profile = path.join(work, 'profile');
// A fresh profile has no tool in it: every tool is prepared the way a first file open prepares it.
if (flag('fresh')) await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });

const { start, supportedLanguages } = await product();
const host = start(profile);
const expected = new Map(supportedLanguages.flatMap(entry => entry.languages.map(language => [language, entry.tool])));
const outcomes = [];
// `--tool` puts another tool in the place of the supported one, the way a person chooses it in
// Language Support, to compare two tools on the same files. The choice is taken back afterwards.
const candidate = option('tool');
const choose = (language, value) => host.window(work, []).invoke('set-default', language, value);
// `--program` names that tool's program file, as "Choose program…" does, for a tool this
// computer already has somewhere Setdown does not look.
const program = candidate && option('program');
if (program) { host.pick(path.resolve(program)); if (!await host.window(work, []).invoke('choose-executable', candidate)) throw Error(`${candidate} takes no program file.`); }

for (const item of selected) {
  const root = roots.get(item.project), file = path.join(root, item.file);
  if (candidate) for (const language of new Set(selected.map(other => other.languageId))) await choose(language, 'automatic');
  // The file as it is in the project, with one line a person has just typed wrong at its end.
  const original = await readFile(file, 'utf8');
  const { text, line: mistakeLine } = item.mistake ? withMistake(original, item.mistake) : { text: original, line: original.split('\n').length };
  const window = host.window(root, [file]);
  const outcome = { id: item.id, language: item.language, project: `${projects[item.project].repo}@${projects[item.project].commit.slice(0, 10)}`,
    file: item.file, expectedTool: candidate ?? expected.get(item.languageId), checks: [] };
  outcomes.push(outcome);
  if (candidate) await choose(item.languageId, candidate);
  process.stderr.write(`${item.language}: opening ${item.project}/${item.file}\n`);
  // Setdown writes a receipt for a tool it installs; a receipt that appears during this open is a download.
  const receipt = path.join(profile, 'language-packages/installations', `${outcome.expectedTool}.json`);
  const installed = () => access(receipt).then(() => true, () => false);
  const before = await installed(), started = Date.now();
  let opened;
  try {
    // The first open of a language downloads its tool; nothing else here may take minutes.
    opened = await Promise.race([window.invoke('open', { id: item.id, generation: `run-${item.id}`, path: file, text, version: 1 }),
      sleep(35 * 60_000).then(() => { throw Error('The tool was not ready after 35 minutes.'); })]);
  } catch (error) {
    const status = window.received.map(entry => entry.event).findLast(event => event.type === 'status' && event.state === 'failed');
    outcome.start = { ok: false, seconds: (Date.now() - started) / 1000, reason: String(error?.message ?? error), issue: status?.issue, tool: status?.server?.id };
    process.stderr.write(`  did not start: ${outcome.start.reason}\n`); continue;
  }
  const seconds = (Date.now() - started) / 1000, downloaded = !before && await installed();
  if ('unavailable' in opened) {
    outcome.start = { ok: false, seconds, reason: opened.message ?? 'No tool was started.', issue: opened.issue, tool: opened.server?.id };
    process.stderr.write(`  no tool: ${JSON.stringify(opened.issue ?? opened.message ?? null)}\n`); continue;
  }
  // Where the program came from, as Language Support would show it on the tool's page.
  const entry = (await window.invoke('catalog', undefined, opened.server)).entries.find(candidate => candidate.id === opened.server);
  const source = entry?.bundled ? 'included' : entry?.preparation?.state === 'ready' ? 'installed by Setdown' : entry?.chosen ? 'chosen program' : 'found on this computer';
  outcome.start = { ok: opened.server === outcome.expectedTool, seconds, tool: opened.server, name: opened.name, source, downloaded, context: opened.context };
  process.stderr.write(`  ${opened.name} ready after ${seconds.toFixed(1)} s, ${downloaded ? 'downloaded now' : source}\n`);

  let capabilities = opened.capabilities, requests = 0;
  const request = async (method, params) => {
    const requestId = `${item.id}-${++requests}`;
    // An answer that never comes must not hold the run: the question is withdrawn and asked again.
    const result = await Promise.race([window.invoke('request', item.id, 1, requestId, method, params),
      sleep(30_000).then(() => { window.send('cancel', requestId); throw Error('No answer within 30 seconds.'); })]);
    if (result && typeof result === 'object' && '$setdownError' in result) throw Error(result.$setdownError.message);
    return result;
  };
  const diagnostics = async () => {
    for (const entry of window.received) if (entry.event.type === 'capabilities' && entry.event.id === item.id) capabilities = entry.event.capabilities;
    const pushed = window.received.map(entry => entry.event).findLast(event => event.type === 'diagnostics' && event.id === item.id)?.diagnostics ?? [];
    // Tools that are asked for diagnostics instead of sending them are asked, as the editor does.
    const pulled = capabilities.diagnosticProvider ? (await request('textDocument/diagnostic', {}))?.items ?? [] : [];
    return [...pushed, ...pulled];
  };
  const questions = [
    ...(!item.mistake ? [] : [{ kind: 'mistake', what: item.mistake, async ask() {
      const all = await diagnostics();
      return { ok: marksLine(all, mistakeLine), expected: 'the added line is marked',
        observed: all.filter(d => d.range.start.line >= mistakeLine).map(diagnosticSummary).map(d => `${d.severity}: ${d.message}`).join('; ') || 'not marked' };
    } }]),
    ...(item.hover ?? []).map(check => ({ kind: 'hover', what: check.on ?? check.at, async ask() {
      const answer = hoverText(await request('textDocument/hover', { position: at(text, check.at, check.on) }));
      return { ok: check.expect.test(answer), expected: `text matching ${check.expect}`, observed: shorten(answer) || 'no answer' };
    } })),
    ...(item.completion ?? []).map(check => ({ kind: 'completion', what: `${check.after.trim()}|`, async ask() {
      const answer = await request('textDocument/completion', { position: after(text, check.after), context: { triggerKind: 1 } });
      const labels = completionLabels(answer);
      return { ok: offers(answer, check.expect), expected: `"${check.expect}" offered`,
        observed: labels.length ? `${labels.length} offered, first: ${labels.slice(0, 6).join(', ')}` : 'nothing offered' };
    } })),
    // Code the build leaves out is shown faded, so that it is not read as code that runs.
    ...(item.faded ?? []).map(check => ({ kind: 'faded', what: check.at, async ask() {
      const { line } = at(text, check.at), all = (await diagnostics()).filter(d => d.tags?.includes(1));
      return { ok: all.some(d => d.range.start.line <= line && d.range.end.line >= line), expected: 'the line is marked as left out',
        observed: all.length ? `${all.length} region${all.length === 1 ? '' : 's'} left out: lines ${all.slice(0, 8).map(d => `${d.range.start.line + 1}-${d.range.end.line + 1}`).join(', ')}` : 'nothing marked as left out' };
    } })),
    ...(item.definition ?? []).map(check => ({ kind: 'definition', what: check.on ?? check.at, async ask() {
      const targets = definitionTargets(await request('textDocument/definition', { position: at(text, check.at, check.on) }));
      return { ok: leadsTo(targets, check.to), expected: `leads to ${check.to}`,
        observed: targets.map(target => `${path.relative(root, decodeURIComponent(new URL(target.uri).pathname))}:${target.line + 1}`).join(', ') || 'no target' };
    } })),
    // What the tool's own editor extension asks beyond the protocol: expand this macro, show
    // the other file of the pair, the compiled component. The answer is judged as text.
    ...(item.own ?? []).map(check => ({ kind: 'own', what: check.what ?? check.method, async ask() {
      const more = typeof check.params === 'function' ? check.params({ at: (needle, on) => at(text, needle, on), after: needle => after(text, needle), uri: pathToFileURL(file).href }) : check.params;
      // A command makes the tool propose an edit to the editor. The benchmark changes no file:
      // it reads the proposal and declines it, which the tool then reports as a failed command.
      const from = window.received.length; let proposed;
      const declining = check.edit ? setInterval(() => {
        for (const { event } of window.received.slice(from)) if (event.type === 'apply-edit' && event.id === item.id && !event.declined) {
          event.declined = true; proposed = JSON.stringify(event.edit); window.send('edit-applied', event.requestId, false, 'The benchmark changes no file.');
        }
      }, 25) : undefined;
      let answer;
      try { answer = await request(check.method, { ...(check.at ? { position: at(text, check.at, check.on) } : {}), ...more }); }
      catch (error) { if (!check.edit) throw error; answer = `the command ended with: ${String(error?.message ?? error)}`; }
      finally { clearInterval(declining); }
      const seen = typeof answer === 'string' ? answer : JSON.stringify(answer ?? null);
      if (check.edit) return { ok: check.edit.test(proposed ?? ''), expected: `a proposed edit matching ${check.edit}`, observed: proposed ? shorten(proposed) : `no edit was proposed; ${shorten(seen)}` };
      return { ok: check.expect.test(seen), expected: `an answer matching ${check.expect}`, observed: shorten(seen) || 'no answer' };
    } })),
  ];
  // A tool may ask the person something before it reads the project; Setdown shows the question
  // in the document's panel. The case says what a person working on this project answers.
  const asked = new Map();
  const answerTool = async () => {
    const messages = [...(opened.messages ?? []), ...window.received.map(entry => entry.event).filter(event => event.type === 'context' && event.id === item.id).flatMap(event => event.messages ?? [])];
    for (const message of messages) {
      if (asked.has(message.id)) continue;
      const reply = (item.answer ?? []).find(entry => entry.ask.test(message.message)), index = reply ? message.actions.indexOf(reply.choose) : -1;
      asked.set(message.id, { question: shorten(message.message), choices: message.actions, chose: index < 0 ? null : reply.choose });
      if (index >= 0) await window.invoke('answer-message', file, opened.server, message.id, index);
      process.stderr.write(`  the tool asks: ${shorten(message.message, 100)} ${index < 0 ? '(left unanswered)' : `-> ${reply.choose}`}\n`);
    }
  };
  // A tool answers "nothing yet" while it reads the project. Each question is asked again
  // until its answer is the expected one or the case's patience runs out; the time is recorded.
  const connected = Date.now(), deadline = connected + (item.patience ?? 60) * 1000;
  const pending = new Set(questions), answers = new Map();
  for (;;) {
    await answerTool();
    for (const question of pending) {
      let result;
      try { result = await question.ask(); } catch (error) { result = { ok: false, observed: `error: ${String(error?.message ?? error)}` }; }
      answers.set(question, { kind: question.kind, what: question.what, ...result, seconds: (Date.now() - connected) / 1000 });
      if (result.ok) pending.delete(question);
    }
    if (!pending.size || Date.now() > deadline) break;
    await sleep(1000);
  }
  // The project's own lines are judged last, after the tool has had its say about the file:
  // a tool that has not reported anything yet has not found the code correct either.
  await sleep(3000);
  let clean;
  try {
    const all = await diagnostics(), accepted = (item.accept ?? []).map(entry => ({ ...entry, line: at(text, entry.at).line }));
    const errors = errorsAbove(all, mistakeLine), wrong = errors.filter(d => !accepted.some(entry => entry.line === d.range.start.line)).map(diagnosticSummary);
    const excused = accepted.filter(entry => errors.some(d => d.range.start.line === entry.line)).map(entry => `line ${entry.line + 1} accepted: ${entry.because}`);
    // Without a report on the added line there is no sign that the tool has read the file at all.
    const read = item.mistake ? marksLine(all, mistakeLine) : [...answers.values()].some(answer => answer.ok);
    clean = { kind: 'clean', what: 'the project\'s own lines', ok: wrong.length ? false : read ? true : null, expected: 'no error above the added line',
      observed: [wrong.length ? `${wrong.length} error${wrong.length === 1 ? '' : 's'}: ${wrong.slice(0, 5).map(d => `line ${d.line} ${d.message}`).join('; ')}`
        : read ? 'no error' : 'no error, but the tool reported nothing at all', ...excused].join('; ') };
  } catch (error) { clean = { kind: 'clean', what: 'the project\'s own lines', ok: null, observed: `error: ${String(error?.message ?? error)}` }; }
  outcome.checks = [{ ...clean, seconds: (Date.now() - connected) / 1000 }, ...questions.map(question => answers.get(question))];
  if (asked.size) outcome.asked = [...asked.values()];
  for (const check of outcome.checks) process.stderr.write(`  ${check.ok ? 'ok  ' : check.ok === null ? '?   ' : 'FAIL'} ${check.kind} ${shorten(check.what, 40)} (${check.seconds.toFixed(1)} s)${check.ok ? '' : `: ${shorten(check.observed, 200)}`}\n`);
  window.send('close', item.id);
}

if (candidate) for (const language of new Set(selected.map(item => item.languageId))) await choose(language, 'automatic');
if (program) await host.window(work, []).invoke('automatic', candidate);
await Promise.race([host.stop(), sleep(20_000)]);
const run = { date: new Date().toISOString(), platform: `${process.platform} ${process.arch}`, profile: flag('fresh') ? 'fresh' : 'kept', ...(candidate ? { tool: candidate } : {}), outcomes };
await mkdir(results, { recursive: true });
await writeFile(latest, JSON.stringify(run, null, 2) + '\n');
await writeFile(latest.replace(/\.json$/, '.md'), table(run) + '\n');
console.log(table(run));
// Tools started by the manager are children of this process; none may outlive the run.
process.exit(failures(run).length ? 1 : 0);
