import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DiskVersion } from '../../core/document/document';
import { positionForVersion, validReadingRecord, type ReadingRecord } from '../../core/reading/reading-position';

/** One main-process writer for all windows. Bounded, versioned, atomic on disk. */
export class ReadingPositionStore {
  private readonly records = new Map<string, ReadingRecord>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  constructor(private readonly file: string, private readonly limit = 1000) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.version === 1 && Array.isArray(data.records)) {
        for (const record of data.records.slice(-limit)) if (validReadingRecord(record)) this.records.set(record.path, record);
      }
    } catch { /* First launch or damaged history must not prevent opening files. */ }
  }
  get(file: string, disk: DiskVersion) {
    const record = this.records.get(file);
    return record ? positionForVersion(record, disk) : undefined;
  }
  save(value: unknown): boolean {
    if (!validReadingRecord(value)) return false;
    if ((this.records.get(value.path)?.observedAt ?? 0) > value.observedAt) return false;
    this.records.delete(value.path);
    this.records.set(value.path, structuredClone(value));
    while (this.records.size > this.limit) this.records.delete(this.records.keys().next().value!);
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 500);
    return true;
  }
  move(from: string, to: string) {
    for (const [key, record] of [...this.records]) {
      if (key !== from && !key.startsWith(from + path.sep)) continue;
      this.records.delete(key);
      this.save({ ...record, path: to + key.slice(from.length) });
    }
  }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.dirty) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp';
      writeFileSync(temporary, JSON.stringify({ version: 1, records: [...this.records.values()] }), { mode: 0o600 });
      renameSync(temporary, this.file);
      this.dirty = false;
    } catch (error) { console.error('Could not save reading positions', error); }
  }
}
