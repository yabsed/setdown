import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Persists the Edit > Auto Save checkbox; separate from theme and zoom settings. */
export class AutoSaveStore {
  enabled = false;

  constructor(private readonly file: string) {}

  load(): boolean {
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as { enabled?: unknown };
      this.enabled = stored.enabled === true;
    } catch { /* First launch or invalid settings. */ this.enabled = false; }
    return this.enabled;
  }

  set(enabled: boolean): void {
    this.enabled = enabled;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify({ enabled }));
      renameSync(this.file + '.tmp', this.file);
    } catch (error) { console.error('Could not save auto-save settings', error); }
  }
}
