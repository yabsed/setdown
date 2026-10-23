import type { ResultEntry } from './result-history';
/** Parses data already emitted by a task; never starts a process or evaluates output. */
export function taskLocations(output: string, directory: string): { entries: ResultEntry[]; unparsed: string[] } {
  const entries: ResultEntry[] = [], unparsed: string[] = [];
  const lines = output.slice(-2 * 1024 * 1024).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split(/\r?\n/);
  for (const text of lines) {
    const trace = /^\s*File "([^"]+)", line (\d+)/.exec(text);
    const match = /^\s*(.+?):(\d+)(?::(\d+))?(?::|\s|$)\s*(.*)$/.exec(text);
    const file = trace?.[1] ?? match?.[1];
    if (!file || file.includes('\0') || /^https?:\/\//.test(file)) { if (text.trim()) unparsed.push(text); continue; }
    const path = /^(?:\/|[A-Za-z]:[\\/])/.test(file) ? file : `${directory.replace(/[\\/]$/, '')}/${file.replace(/^\.\//, '')}`;
    entries.push({ label: trace ? 'Python traceback' : match![4] || text, detail: text,
      location: { path, line: Math.max(1, Number(trace?.[2] ?? match?.[2])), column: Math.max(1, Number(match?.[3] ?? 1)) } });
    if (entries.length >= 1000) break;
  }
  return { entries, unparsed: unparsed.slice(-100) };
}
