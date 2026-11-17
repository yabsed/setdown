import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The notebook host's language-server settings as the analyzer's project file. Both are
 * read by the same analyzer; a setting only the server understands is left out. */
export function projectFile(analysis) {
  const { diagnosticSeverityOverrides = {}, autoSearchPaths: _server, diagnosticMode: _open, ...settings } = analysis;
  const known = ['typeCheckingMode', 'extraPaths', 'useLibraryCodeForTypes'];
  const unknown = Object.keys(settings).filter(name => !known.includes(name));
  if (unknown.length) throw Error(`The notebook host sends analyzer settings this benchmark does not carry over: ${unknown.join(', ')}. Add them to lib/analyzer.mjs.`);
  return { ...settings, ...diagnosticSeverityOverrides };
}

/** One analyzer process over one repository's notebooks. Reads files; runs none of them. */
export async function analyze({ analyzer, python, folder, name, settings, notebooks, cwd }) {
  const project = path.join(folder, `.setdown-benchmark-${name}.json`), started = Date.now(), files = new Map(notebooks.map(item => [item.file, item.notebook]));
  await writeFile(project, JSON.stringify(settings));
  return new Promise((resolve, reject) => {
    // English messages, and a heap that leaves room for the rest of the desktop.
    const child = spawn(process.execPath, [analyzer, '--project', project, '--pythonpath', python, '--outputjson', ...files.keys()],
      { cwd, env: { ...process.env, LC_ALL: 'C', LANG: 'C', NODE_OPTIONS: '--max-old-space-size=3072' }, stdio: ['ignore', 'pipe', 'pipe'] });
    // When memory runs out, Linux should end the analyzer and not the editor beside it.
    try { writeFileSync(`/proc/${child.pid}/oom_score_adj`, '1000'); } catch { /* not Linux, or already gone */ }
    const output = [], problems = [];
    child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => problems.push(chunk));
    child.on('error', reject);
    child.on('exit', () => {
      let report;
      try { report = JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch { reject(Error(`The analyzer produced no report for ${name}: ${Buffer.concat(problems).toString('utf8').trim().split('\n').at(-1) ?? 'no output'}`)); return; }
      const rows = [];
      for (const item of report.generalDiagnostics) {
        // Cell 0 is the host's hidden first cell, whose diagnostics the product drops.
        if (!files.has(item.file) || !item.cell || !['error', 'warning'].includes(item.severity)) continue;
        rows.push({ notebook: files.get(item.file), cell: item.cell - 1, line: item.range.start.line + 1, column: item.range.start.character,
          endLine: item.range.end.line + 1, endColumn: item.range.end.character, severity: item.severity, rule: item.rule ?? 'syntax', message: item.message.split('\n')[0] });
      }
      resolve({ seconds: Math.round((Date.now() - started) / 100) / 10, notebooks: notebooks.length, rows });
    });
  });
}
