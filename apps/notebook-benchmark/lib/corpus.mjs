import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, corpus } from './paths.mjs';

const execute = promisify(execFile);
const manifestFile = path.join(app, 'corpus.json');
export const directory = repo => path.join(corpus, repo.replace('/', '__'));
export const readManifest = async () => JSON.parse(await readFile(manifestFile, 'utf8'));

// Checked-out files are data. Symbolic links arrive as plain files and hooks never run.
const git = (cwd, ...args) => execute('git', ['-c', 'core.symlinks=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' } });

/** An even spread over the repository's notebooks in path order, without translated copies. */
export function chooseNotebooks(files, count) {
  const notebooks = files.filter(file => file.endsWith('.ipynb') && !file.includes('.ipynb_checkpoints')
    && !file.includes('/translations/') && !file.startsWith('translations/')).sort();
  const step = Math.max(1, notebooks.length / count);
  const chosen = Array.from({ length: Math.min(count, notebooks.length) }, (_, i) => notebooks[Math.min(notebooks.length - 1, Math.floor(i * step))]);
  return { total: notebooks.length, chosen: [...new Set(chosen)].sort() };
}

/** Python modules a chosen notebook may import: at the repository root or under a notebook's folder. */
export function nearbyModules(files, notebooks) {
  const folders = [...new Set(notebooks.map(file => path.posix.dirname(file)).filter(folder => folder !== '.'))];
  return files.filter(file => file.endsWith('.py') && (!file.includes('/') || folders.some(folder => file.startsWith(`${folder}/`)))).slice(0, 300);
}

/** Downloads the pinned notebooks, a partial clone per repository. An entry without a
 * commit, or every entry with `repin`, is pinned to the remote's current HEAD and sampled. */
export async function fetchCorpus({ only, repin = false, log = console.log } = {}) {
  const manifest = await readManifest();
  let pinned = false;
  for (const entry of manifest.repositories) {
    if (only && !only.test(entry.repo)) continue;
    const folder = directory(entry.repo), pin = repin || !entry.sha;
    try {
      if (!existsSync(path.join(folder, '.git'))) {
        await mkdir(folder, { recursive: true });
        await git(folder, 'init', '--quiet');
        await git(folder, 'remote', 'add', 'origin', `https://github.com/${entry.repo}.git`);
      }
      await git(folder, 'fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', pin ? 'HEAD' : entry.sha);
      const sha = (await git(folder, 'rev-parse', 'FETCH_HEAD')).stdout.trim();
      const files = (await git(folder, 'ls-tree', '-r', '--name-only', '-z', sha)).stdout.split('\0').filter(Boolean);
      if (pin) {
        const { total, chosen } = chooseNotebooks(files, manifest.sample);
        Object.assign(entry, { sha, date: (await git(folder, 'log', '-1', '--format=%cs', sha)).stdout.trim(), notebooksInRepository: total, notebooks: chosen });
        pinned = true;
      }
      const modules = nearbyModules(files, entry.notebooks), list = path.join(folder, '.git', 'benchmark-paths');
      await writeFile(list, [...entry.notebooks, ...modules].join('\0'));
      await git(folder, 'checkout', '--quiet', sha, `--pathspec-from-file=${list}`, '--pathspec-file-nul');
      log(`${entry.repo}: ${entry.notebooks.length} of ${entry.notebooksInRepository} notebooks, ${modules.length} modules @ ${sha.slice(0, 9)} ${entry.date}`);
    } catch (error) {
      log(`${entry.repo}: FAILED ${String(error.stderr || error.message).trim().split('\n').at(-1)}`);
      process.exitCode = 1;
    }
  }
  if (pinned) await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

const text = cell => Array.isArray(cell.source) ? cell.source.join('') : typeof cell.source === 'string' ? cell.source : '';

/** Why a notebook is not analysed as Python 3, or undefined. */
function unsuitable(notebook) {
  const metadata = notebook.metadata ?? {};
  const language = String(metadata.kernelspec?.language ?? metadata.language_info?.name ?? 'python').toLowerCase();
  if (!(notebook.nbformat >= 4) || !Array.isArray(notebook.cells)) return 'notebook format older than 4';
  if (!['python', 'ipython'].includes(language)) return `language ${language}`;
  if (String(metadata.language_info?.version ?? '3').startsWith('2') || metadata.kernelspec?.name === 'python2') return 'Python 2';
}

/** Writes the copies the analyzer reads, next to each original so its local imports
 * resolve: `.setdown.ipynb` with cells as the notebook host sends them, and
 * `.setdown-written.ipynb` with cells as written. Both begin with the host's hidden
 * first cell and carry no outputs. Nothing in a notebook is executed. */
export async function prepare(entry, { notebookAnalysisSource, notebookPrelude }) {
  const folder = directory(entry.repo), notebooks = [], skipped = [];
  const hidden = { cell_type: 'code', metadata: {}, outputs: [], execution_count: null, source: notebookPrelude };
  for (const name of entry.notebooks) {
    const file = path.join(folder, name);
    let notebook;
    try { notebook = JSON.parse(await readFile(file, 'utf8')); } catch { skipped.push({ notebook: name, reason: existsSync(file) ? 'unreadable' : 'not fetched' }); continue; }
    const reason = unsuitable(notebook);
    if (reason) { skipped.push({ notebook: name, reason }); continue; }
    const code = notebook.cells.filter(cell => cell?.cell_type === 'code').map(text);
    const copy = source => JSON.stringify({ ...notebook, cells: [hidden, ...code.map(item => ({ ...hidden, source: source(item) }))] });
    const host = file.replace(/\.ipynb$/, '.setdown.ipynb'), written = file.replace(/\.ipynb$/, '.setdown-written.ipynb');
    await writeFile(host, copy(notebookAnalysisSource));
    await writeFile(written, copy(item => item));
    notebooks.push({ notebook: `${entry.repo}/${name}`, root: folder, folder: path.dirname(file), host, written, cells: code });
  }
  return { notebooks, skipped };
}

/** Top-level modules the notebooks import that are not files next to them. */
export function importedModules(prepared) {
  const modules = new Map();
  for (const item of prepared) {
    const local = name => [item.folder, item.root].some(folder => existsSync(path.join(folder, `${name}.py`)) || existsSync(path.join(folder, name)));
    const names = new Set();
    for (const line of item.cells.flatMap(cell => cell.split('\n'))) {
      const from = /^\s*from\s+([A-Za-z_]\w*)[\w.]*\s+import\b/.exec(line), plain = /^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)\s*(?:#.*)?$/.exec(line);
      if (from) names.add(from[1]);
      for (const part of plain?.[1].split(',') ?? []) names.add(part.trim().split(/[.\s]/)[0]);
    }
    for (const name of names) if (!local(name)) modules.set(name, (modules.get(name) ?? 0) + 1);
  }
  return modules;
}
