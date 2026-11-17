#!/usr/bin/env node
// Measures what Setdown's notebook analysis reports on public notebooks. See README.md.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configurations, standard } from './configurations.mjs';
import { analyze, projectFile } from './lib/analyzer.mjs';
import { directory, fetchCorpus, importedModules, prepare, readManifest } from './lib/corpus.mjs';
import { createEnvironment, fingerprint, interpreter, searchPaths } from './lib/environment.mjs';
import { app, repository as checkout, work } from './lib/paths.mjs';
import { product } from './lib/product.mjs';
import { category, delta, errors, groups, pack, place, repository, sample, scoreLabels, summarize, unpack } from './lib/results.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const options = {}, names = [];
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) names.push(rest[i]);
  else if (['repin', 'force'].includes(rest[i].slice(2))) options[rest[i].slice(2)] = true;
  else options[rest[i].slice(2)] = rest[++i];
}
const only = options.only ? new RegExp(options.only) : undefined;
const runFolder = path.join(work, 'runs', options.run ?? 'current');
const baselineFile = path.join(app, 'results', `${options.baseline ?? 'baseline'}.json`);
const labels = JSON.parse(readFileSync(path.join(app, 'labels.json'), 'utf8')).labels;
/** The labels a run can be scored with: those whose judged line is still in the corpus. */
const judgedIn = meta => labels.filter(label => !meta.labels?.stale.includes(place(label)));
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => i ? '---:' : '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const fail = message => { console.error(message); process.exit(1); };

/** The analyzer settings of one configuration for one repository, with what the product said about stubs. */
async function settingsFor(name, entry, tools, search) {
  const configuration = configurations[name];
  if (configuration.product === false) return { settings: { typeCheckingMode: configuration.level, ...configuration.settings }, evidence: [] };
  const { analysis, stubs } = tools.notebookAnalysis(directory(entry.repo), search, tools.stubs, configuration.level);
  const settings = projectFile(analysis);
  const dropped = (configuration.withoutStubs ?? []).map(library => path.join(tools.stubs, library));
  settings.extraPaths = (settings.extraPaths ?? []).filter(item => !dropped.some(folder => item === folder || item.startsWith(folder + path.sep)));
  if (configuration.stubs) {
    const folder = path.join(work, 'candidates', name);
    await rm(folder, { recursive: true, force: true }); await mkdir(folder, { recursive: true });
    for (const [seen, source] of Object.entries(configuration.stubs)) await symlink(path.join(checkout, source), path.join(folder, seen), 'dir');
    settings.extraPaths.push(folder);
  }
  return { settings: { ...settings, ...configuration.settings }, evidence: stubs.evidence };
}

async function run() {
  const chosen = names.length ? names : standard;
  for (const name of chosen) if (!configurations[name]) fail(`Unknown configuration ${name}. Known: ${Object.keys(configurations).join(', ')}`);
  const manifest = await readManifest(), python = interpreter(options.python), tools = await product(), search = await searchPaths(python);
  const prepared = new Map(), skipped = [];
  for (const entry of manifest.repositories) {
    if (!existsSync(directory(entry.repo))) fail(`${entry.repo} is not downloaded. Run \`npm run bench:notebooks -- fetch\`.`);
    const result = await prepare(entry, tools);
    prepared.set(entry.repo, result.notebooks); skipped.push(...result.skipped.map(item => ({ notebook: `${entry.repo}/${item.notebook}`, reason: item.reason })));
  }
  const everything = [...prepared.values()].flat();
  // A label judges one source line. After a repin another line can stand in its place.
  const written = new Map(everything.map(item => [item.notebook, item.cells]));
  const stale = labels.filter(label => written.get(label.notebook)?.[label.cell]?.split('\n')[label.line - 1]?.trim() !== label.source).map(place);
  const environment = await fingerprint(python, importedModules(everything).keys());
  await mkdir(runFolder, { recursive: true });
  const metaFile = path.join(runFolder, 'run.json'), previous = existsSync(metaFile) ? JSON.parse(await readFile(metaFile, 'utf8')) : { configurations: {} };
  const commit = execFileSync('git', ['-C', checkout, 'describe', '--always', '--dirty'], { encoding: 'utf8' }).trim();
  const meta = { ...previous, date: new Date().toLocaleDateString('sv'), commit, analyzer: `basedpyright ${tools.analyzer.version}`, defaultLevel: tools.defaultLevel, environment,
    stubs: (await settingsFor('basic', { repo: 'none/none' }, tools, search)).evidence, labels: { judged: labels.length - stale.length, stale },
    corpus: { repositories: manifest.repositories.length, notebooks: manifest.repositories.reduce((sum, entry) => sum + entry.notebooks.length, 0), analysed: everything.length, skipped } };
  console.log(`${everything.length} notebooks from ${manifest.repositories.length} repositories (${skipped.length} skipped), ${meta.analyzer}, Python ${environment.python}, default level ${tools.defaultLevel}`);
  for (const line of meta.stubs) console.log(`  ${line}`);
  if (stale.length) console.log(`Note: ${stale.length} of ${labels.length} labels no longer point at the line they judged and are left out of the scores. Judge them again or remove them from labels.json:\n  ${stale.join('\n  ')}`);
  // One analyzer at a time: each can hold gigabytes while it reads the libraries.
  for (const name of chosen) {
    const folder = path.join(runFolder, name), written = configurations[name].product === false;
    await mkdir(folder, { recursive: true });
    let seconds = 0, shown;
    for (const entry of manifest.repositories) {
      const notebooks = prepared.get(entry.repo).map(item => ({ notebook: item.notebook, file: written ? item.written : item.host }));
      if (!notebooks.length || only && !only.test(entry.repo)) continue;
      const { settings } = await settingsFor(name, entry, tools, search); shown ??= settings;
      const signature = digest({ settings, analyzer: meta.analyzer, environment, sha: entry.sha, files: notebooks.map(item => digest(readFileSync(item.file, 'utf8'))) });
      const file = path.join(folder, `${entry.repo.replace('/', '__')}.json`);
      let result = existsSync(file) && !options.force ? JSON.parse(await readFile(file, 'utf8')) : undefined;
      const cached = result?.signature === signature;
      if (!cached) {
        result = { signature, ...await analyze({ analyzer: tools.analyzer.entry, python, folder: directory(entry.repo), name, settings, notebooks, cwd: runFolder }) };
        await writeFile(file, JSON.stringify(result));
      }
      seconds += result.seconds;
      console.log(`${name.padEnd(12)} ${entry.repo.padEnd(44)} ${String(errors(result.rows).length).padStart(5)} errors ${String(result.rows.length - errors(result.rows).length).padStart(5)} warnings  ${cached ? 'unchanged' : `${result.seconds}s`}`);
    }
    const relative = value => JSON.parse(JSON.stringify(value).replaceAll(work, '<work>').replaceAll(checkout, '<repository>'));
    meta.configurations[name] = { ...configurations[name], settings: relative(shown ?? {}), seconds: Math.round(seconds) };
    await writeFile(metaFile, JSON.stringify(meta, null, 2) + '\n');
  }
}

async function load(folder = runFolder) {
  const metaFile = path.join(folder, 'run.json');
  if (!existsSync(metaFile)) fail(`No results in ${folder}. Run \`npm run bench:notebooks -- run\` first.`);
  const meta = JSON.parse(await readFile(metaFile, 'utf8')), rows = {};
  for (const name of Object.keys(meta.configurations)) {
    rows[name] = [];
    for (const file of (await readdir(path.join(folder, name))).sort()) rows[name].push(...JSON.parse(await readFile(path.join(folder, name, file), 'utf8')).rows);
  }
  return { meta, rows };
}

const judged = (rows, valid) => {
  const score = scoreLabels(rows, valid), of = verdict => `${score.verdicts[verdict]?.marked ?? 0} of ${score.verdicts[verdict]?.of ?? 0}`;
  return { score, cells: [of('real'), of('hazard'), of('false')] };
};

function summary({ meta, rows }, chosen) {
  const list = (chosen.length ? chosen : Object.keys(rows)).filter(name => rows[name]);
  const counts = Object.fromEntries(list.map(name => [name, summarize(rows[name], meta.corpus.analysed)]));
  const lines = (count, name) => count[name]?.lines ?? 0, valid = judgedIn(meta);
  const text = [
    `Run of ${meta.date} at ${meta.commit}: ${meta.corpus.analysed} notebooks from ${meta.corpus.repositories} repositories (${meta.corpus.skipped.length} of ${meta.corpus.notebooks} skipped), ${meta.analyzer}, Python ${meta.environment.python}. Setdown's default level for notebooks is \`${meta.defaultLevel}\`.`,
    '', 'Lines marked red (errors) and yellow (warnings):', '',
    table(['configuration', 'notebooks with red lines', 'red lines', 'errors', 'yellow lines', 'warnings', 'seconds'], list.map(name => [name === meta.defaultLevel ? `**${name}** (default)` : name,
      `${counts[name].notebooksWithErrors} of ${counts[name].notebooks}`, counts[name].errorLines, counts[name].errors, counts[name].warningLines, counts[name].warnings, meta.configurations[name].seconds])),
    '', 'Red lines by cause, with yellow lines in parentheses:', '',
    table(['configuration', 'syntax', 'undefined name', 'unresolved import', 'type'], list.map(name => [name, ...['syntax', 'undefined-name', 'missing-import', 'type']
      .map(cause => `${lines(counts[name].errorCategories, cause)} (${lines(counts[name].warningCategories, cause)})`)])),
    '', `Of the ${valid.length} lines judged by hand in labels.json, how many each configuration marks red:`, '',
    table(['configuration', 'real problems', 'hazards', 'false reports', 'real share of marked'], list.map(name => {
      const { score, cells } = judged(rows[name], valid);
      return [name, ...cells, score.precision === undefined ? '–' : `${Math.round(score.precision * 100)}%`];
    })),
  ].join('\n');
  return { counts, text };
}

async function report() { console.log(summary(await load(), names).text); }

async function save() {
  const current = await load(), { counts, text } = summary(current, []);
  const valid = judgedIn(current.meta);
  const saved = { ...current.meta, configurations: Object.fromEntries(Object.entries(current.meta.configurations).map(([name, configuration]) => [name,
    { ...configuration, summary: counts[name], judged: scoreLabels(current.rows[name], valid), ...(configuration.summaryOnly ? {} : { diagnostics: pack(current.rows[name]) }) }])) };
  await mkdir(path.dirname(baselineFile), { recursive: true });
  // One diagnostic per line keeps the file reviewable in a diff.
  await writeFile(baselineFile, JSON.stringify(saved, (key, value) => key === 'rows' ? value.map(row => `\u0000${JSON.stringify(row)}\u0000`) : value, 1)
    .replace(/"\\u0000(.*?)\\u0000"/g, (_, row) => JSON.parse(`"${row}"`)) + '\n');
  await writeFile(baselineFile.replace(/\.json$/, '.md'), `# Notebook analysis benchmark: ${path.basename(baselineFile, '.json')}\n\n${text}\n\nAnalysis environment: ${Object.entries(current.meta.environment.installed).map(([name, version]) => `${name} ${version}`).join(', ')}.\n\nImported by the notebooks but not installed: ${current.meta.environment.missing.join(', ')}.\n`);
  console.log(`Saved ${path.relative(checkout, baselineFile)} and its .md summary.`);
}

async function compare() {
  if (!existsSync(baselineFile)) fail(`No baseline at ${baselineFile}. Save one with \`npm run bench:notebooks -- save\`.`);
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8')), current = await load(), count = Number(options.groups ?? 8), valid = judgedIn(current.meta);
  for (const [name, was, now] of [['analyzer', baseline.analyzer, current.meta.analyzer], ['Python', baseline.environment.python, current.meta.environment.python],
    ['libraries', digest(baseline.environment.installed), digest(current.meta.environment.installed)], ['default level', baseline.defaultLevel, current.meta.defaultLevel]])
    if (was !== now) console.log(`Note: ${name} differs from the baseline (${was} → ${now}); differences below may come from that.`);
  for (const name of (names.length ? names : Object.keys(current.rows)).filter(name => baseline.configurations[name]?.diagnostics && current.rows[name])) {
    const before = unpack(baseline.configurations[name].diagnostics), change = delta(before, current.rows[name]);
    console.log(`\n## ${name}: ${change.before.lines} → ${change.after.lines} red lines (${change.before.diagnostics} → ${change.after.diagnostics} errors); gone from ${change.removedLines} lines, new on ${change.addedLines}`);
    console.log(`judged lines still marked — real, hazard, false: ${judged(before, valid).cells.join(', ')} → ${judged(current.rows[name], valid).cells.join(', ')}`);
    for (const [title, rows] of [['Gone', change.removed], ['New', change.added]]) for (const group of groups(rows).slice(0, count))
      console.log(`${title.padEnd(5)}${String(group.rows.length).padStart(4)} in ${String(group.notebooks).padStart(3)} notebooks  ${group.name}\n            e.g. ${place(group.rows[0])}  ${group.rows[0].message.slice(0, 130)}`);
  }
}

/** The source lines around a place, from the notebook as written. */
function context(row, before = 2, after = 1) {
  const [owner, name, ...file] = row.notebook.split('/'), notebook = JSON.parse(readFileSync(path.join(directory(`${owner}/${name}`), ...file), 'utf8'));
  const cell = notebook.cells.filter(item => item.cell_type === 'code')[row.cell], lines = (Array.isArray(cell.source) ? cell.source.join('') : cell.source).split('\n');
  return lines.slice(Math.max(0, row.line - 1 - before), row.line + after).map((text, i) => `   ${Math.max(0, row.line - 1 - before) + i === row.line - 1 ? '>' : ' '} ${text.slice(0, 150)}`).join('\n');
}

async function selected() {
  const { rows } = await load(), name = names[0] ?? 'basic';
  if (!rows[name]) fail(`The run has no configuration ${name}.`);
  return rows[name].filter(row => row.severity === (options.severity ?? 'error') && (!options.category || category(row) === options.category) && (!only || only.test(repository(row))));
}

async function listGroups() {
  const rows = await selected();
  console.log(`${rows.length} diagnostics on ${new Set(rows.map(place)).size} lines`);
  for (const group of groups(rows).slice(0, Number(options.count ?? 40)))
    console.log(`${String(group.rows.length).padStart(5)} in ${String(group.notebooks).padStart(3)} notebooks, ${String(group.repositories).padStart(2)} repositories  ${group.name}\n${context(group.rows[0], 0, 0)}`);
}

async function drawSample() {
  const rows = await selected(), known = new Map(judgedIn((await load()).meta).map(label => [place(label), label]));
  for (const [i, items] of sample(rows, Number(options.count ?? 40), Number(options.seed ?? 1)).entries()) {
    const label = known.get(place(items[0]));
    console.log(`#${i + 1} ${JSON.stringify({ notebook: items[0].notebook, cell: items[0].cell, line: items[0].line })}${label ? `  judged ${label.verdict}: ${label.cause}` : ''}\n${context(items[0])}`);
    for (const row of items.slice(0, 3)) console.log(`     [${row.rule.replace(/^report/, '')}] ${row.message.slice(0, 210)}`);
  }
}

const commands = { fetch: () => fetchCorpus({ only, repin: options.repin }), environment: () => createEnvironment(options.python), run, report, save, compare, groups: listGroups, sample: drawSample };
if (!commands[command]) {
  console.log(`Usage: npm run bench:notebooks -- <command>

  fetch [--only <regex>] [--repin]      download the pinned notebooks; --repin samples each repository's current HEAD again
  environment [--python <python3>]      create work/venv with the libraries of requirements.txt
  run [configuration…] [--run <name>] [--python <interpreter>] [--only <regex>] [--force]
                                        analyse; without names: ${standard.join(', ')}
  report [configuration…] [--run <name>]
  compare [configuration…] [--baseline <name>] [--groups <n>]
                                        what changed since results/<name>.json
  save [--baseline <name>]              keep the run as results/<name>.json and .md
  groups [configuration] [--category syntax|undefined-name|missing-import|type] [--severity warning] [--only <regex>] [--count <n>]
  sample [configuration] [--category …] [--count <n>] [--seed <n>]
                                        random marked lines with their source, to judge by hand

Configurations: ${Object.keys(configurations).join(', ')}`);
  process.exit(command === 'help' ? 0 : 1);
}
await commands[command]();
