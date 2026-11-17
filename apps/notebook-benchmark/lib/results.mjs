/** Pure functions over diagnostics. A row is one diagnostic:
 * { notebook, cell, line, column, endLine, endColumn, severity, rule, message }
 * with `notebook` as owner/repository/path, `cell` counted over code cells from 0 and
 * `line` from 1. A place is one source line; several diagnostics can share it. */

export const repository = row => row.notebook.split('/').slice(0, 2).join('/');
export const place = row => `${row.notebook}#${row.cell}:${row.line}`;
export const key = row => `${place(row)}:${row.column}-${row.endLine}:${row.endColumn} ${row.rule}`;
export const errors = rows => rows.filter(row => row.severity === 'error');

/** Why a line is marked: the code cannot be read, a name or module is missing, or types disagree. */
export function category(row) {
  if (row.rule === 'syntax') return 'syntax';
  if (row.rule === 'reportMissingImports' || row.rule === 'reportMissingModuleSource') return 'missing-import';
  if (row.rule === 'reportUndefinedVariable') return 'undefined-name';
  return 'type';
}

const lines = rows => new Set(rows.map(place)).size;
const tally = (rows, name) => {
  const result = {};
  for (const row of rows) (result[name(row)] ??= []).push(row);
  return Object.fromEntries(Object.entries(result).map(([group, items]) => [group, { diagnostics: items.length, lines: lines(items) }])
    .sort((a, b) => b[1].diagnostics - a[1].diagnostics));
};

/** Counts for one configuration. Red is what a reader sees as an error, yellow as a warning. */
export function summarize(rows, notebooks) {
  const red = errors(rows), yellow = rows.filter(row => row.severity === 'warning');
  return {
    notebooks, notebooksWithErrors: new Set(red.map(row => row.notebook)).size,
    errors: red.length, errorLines: lines(red), warnings: yellow.length, warningLines: lines(yellow),
    errorCategories: tally(red, category), warningCategories: tally(yellow, category),
    errorRules: tally(red, row => row.rule), repositories: tally(red, repository),
  };
}

/** Errors that only one of two configurations reports, over the repositories both analysed. */
export function delta(before, after) {
  const shared = new Set(before.map(repository)).intersection(new Set(after.map(repository)));
  const a = errors(before).filter(row => shared.has(repository(row))), b = errors(after).filter(row => shared.has(repository(row)));
  const inA = new Set(a.map(key)), inB = new Set(b.map(key));
  const removed = a.filter(row => !inB.has(key(row))), added = b.filter(row => !inA.has(key(row)));
  return { before: { diagnostics: a.length, lines: lines(a) }, after: { diagnostics: b.length, lines: lines(b) },
    removed, added, removedLines: lines(removed), addedLines: lines(added) };
}

/** The same report with its quoted names removed, so reports of one kind fall together. */
export const kind = message => message.replace(/"[^"]*"/g, '"…"').slice(0, 110);

export function groups(rows) {
  const result = new Map();
  for (const row of rows) {
    const name = `[${row.rule.replace(/^report/, '')}] ${kind(row.message)}`;
    result.set(name, [...result.get(name) ?? [], row]);
  }
  return [...result].map(([name, items]) => ({ name, rows: items, notebooks: new Set(items.map(row => row.notebook)).size,
    repositories: new Set(items.map(repository)).size })).sort((a, b) => b.rows.length - a.rows.length);
}

/** A repeatable random choice of places. */
export function sample(rows, count, seed) {
  const places = [...new Set(rows.map(place))].sort();
  let state = seed >>> 0;
  const random = () => { state = state + 0x6D2B79F5 >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
  const chosen = new Set(places.slice(0, count));
  return [...chosen].map(item => rows.filter(row => place(row) === item));
}

/** How many hand-judged lines a configuration still marks red, by verdict. Among the
 * judged lines it marks, `precision` is the share that are real problems. */
export function scoreLabels(rows, labels) {
  const marked = new Set(errors(rows).map(place)), result = {};
  for (const label of labels) {
    const verdict = result[label.verdict] ??= { marked: 0, of: 0 };
    verdict.of++;
    if (marked.has(place(label))) verdict.marked++;
  }
  const total = Object.values(result).reduce((sum, verdict) => sum + verdict.marked, 0);
  return { verdicts: result, marked: total, precision: total ? (result.real?.marked ?? 0) / total : undefined };
}

/** Rows as arrays over shared string tables, one row per line, for a baseline kept in git. */
export function pack(rows) {
  const tables = { notebooks: [], rules: [], messages: [] }, index = { notebooks: new Map(), rules: new Map(), messages: new Map() };
  const id = (table, value) => { if (!index[table].has(value)) { index[table].set(value, tables[table].length); tables[table].push(value); } return index[table].get(value); };
  const packed = rows.map(row => [id('notebooks', row.notebook), row.cell, row.line, row.column, row.endLine, row.endColumn,
    row.severity === 'error' ? 1 : 2, id('rules', row.rule), id('messages', row.message)]);
  return { ...tables, rows: packed };
}

export function unpack({ notebooks, rules, messages, rows }) {
  return rows.map(([notebook, cell, line, column, endLine, endColumn, severity, rule, message]) => ({ notebook: notebooks[notebook], cell, line, column,
    endLine, endColumn, severity: severity === 1 ? 'error' : 'warning', rule: rules[rule], message: messages[message] }));
}
