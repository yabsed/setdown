import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectFolder } from '../../protocol/desktop-api';

/** Shared across windows; history never selects a workspace on startup. */
export class RecentFolders {
  private paths: string[] = [];
  private loaded = false;
  constructor(private readonly file?: string) {}

  list(): ProjectFolder[] {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const value: unknown = this.file ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
        if (Array.isArray(value)) this.paths = [...new Set(value.filter((item): item is string =>
          typeof item === 'string' && path.isAbsolute(item)).map(item => path.normalize(item)))].slice(0, 5);
      } catch { /* A new or damaged history starts empty. */ }
    }
    return this.paths.map(root => ({ path: root, name: path.basename(root) || root }));
  }

  visit(root: string): void {
    this.list();
    this.paths = [root, ...this.paths.filter(candidate => candidate !== root)].slice(0, 5);
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.paths));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { console.error('Could not save recent folders:', error); }
  }
}
