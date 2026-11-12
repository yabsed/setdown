import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { rgPath } from '@vscode/ripgrep';

/**
 * Name search below a folder. ripgrep owns traversal (no symlink following,
 * streaming output); matching follows GNOME Files: every query word must be a
 * substring of the name (vendor/nautilus/src/nautilus-query.c:112-164), and
 * names that start with the query rank first. Folders are found from the
 * directories of listed files, so an empty folder is not a result.
 */
export function matchesQuery(name: string, words: string[]): boolean {
  const lower = name.normalize('NFC').toLocaleLowerCase();
  return words.every(word => lower.includes(word));
}
export const queryWords = (query: string) => query.normalize('NFC').toLocaleLowerCase().split(/\s+/).filter(Boolean);

export function collectMatches(root: string, relativeFiles: Iterable<string>, words: string[], limit: number,
  seen = new Set<string>(), results: string[] = []): string[] {
  for (const relative of relativeFiles) {
    if (results.length >= limit) break;
    const parts = relative.split(/[\\/]/);
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      if (seen.has(current)) continue;
      seen.add(current);
      if (matchesQuery(part, words)) { results.push(current); if (results.length >= limit) break; }
    }
  }
  return results;
}

// Electron runs packaged binaries from an asar path only through execFile; spawn needs the unpacked file.
const rg = rgPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

export class FileSearch {
  private readonly running = new Map<number, ChildProcess>();
  cancel(owner: number): void { this.running.get(owner)?.kill(); this.running.delete(owner); }
  /** One search per window; a new query replaces the previous one. */
  search(owner: number, root: string, query: string, showHidden: boolean, limit = 500): Promise<{ paths: string[]; limitHit: boolean }> {
    this.cancel(owner);
    const words = queryWords(query);
    if (!words.length) return Promise.resolve({ paths: [], limitHit: false });
    return new Promise((resolve, reject) => {
      const child = spawn(rg, ['--files', '--null', '--no-config', '--no-ignore', '--no-messages', ...(showHidden ? ['--hidden'] : []),
        '--glob', '!.git', '--glob', '!node_modules'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, RIPGREP_CONFIG_PATH: '' } });
      this.running.set(owner, child);
      const seen = new Set<string>(), paths: string[] = [];
      let rest = '', done = false;
      const finish = (limitHit: boolean) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (this.running.get(owner) === child) this.running.delete(owner);
        child.kill();
        const starts = (file: string) => Number(!path.basename(file).toLocaleLowerCase().startsWith(words[0]));
        resolve({ paths: paths.sort((a, b) => starts(a) - starts(b)), limitHit });
      };
      const timer = setTimeout(() => finish(true), 20_000);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        const items = (rest + chunk).split('\0');
        rest = items.pop() ?? '';
        collectMatches(root, items, words, limit, seen, paths);
        if (paths.length >= limit) finish(true);
      });
      child.on('error', error => { if (!done) { done = true; clearTimeout(timer); reject(error); } });
      child.on('close', () => { if (rest) collectMatches(root, [rest], words, limit, seen, paths); finish(paths.length >= limit); });
    });
  }
}
