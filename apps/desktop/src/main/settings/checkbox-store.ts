import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Persists one menu checkbox in its own file, separate from theme and zoom settings. */
export class CheckboxStore {
  enabled: boolean;

  constructor(private readonly file: string, private readonly initial: boolean) { this.enabled = initial; }

  load(): boolean {
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as { enabled?: unknown };
      this.enabled = typeof stored.enabled === 'boolean' ? stored.enabled : this.initial;
    } catch { /* First launch or invalid settings. */ this.enabled = this.initial; }
    return this.enabled;
  }

  set(enabled: boolean): void {
    this.enabled = enabled;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify({ enabled }));
      renameSync(this.file + '.tmp', this.file);
    } catch (error) { console.error(`Could not save ${this.file}`, error); }
  }
}
