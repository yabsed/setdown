import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const LIMIT = 32 * 1024 * 1024;
type Envelope = { version: 1; id: string; name: string; time: number; recovery: boolean; value: unknown };
/** Separate, bounded JSON artifacts. Reading a snapshot never opens or writes its resources. */
export class SnapshotStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  private file(id: string): string { if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error('Invalid snapshot identifier.'); return path.join(this.directory, `${id}.json`); }
  private async envelope(id: string): Promise<Envelope> {
    const file = this.file(id), stat = await fs.stat(file); if (stat.size > LIMIT) throw Error('Snapshot is too large.');
    const result = JSON.parse(await fs.readFile(file, 'utf8')) as Envelope;
    if (result.version !== 1 || result.id !== id || typeof result.name !== 'string' || !Number.isFinite(result.time)) throw Error('Unsupported or damaged snapshot.');
    return result;
  }
  private async metadata(id: string): Promise<Omit<Envelope, 'value' | 'version'>> {
    // The writer puts metadata before value. Listing a hundred 32 MiB artifacts
    // must not deserialize gigabytes of document text, especially at startup.
    const handle = await fs.open(this.file(id), 'r');
    try {
      if ((await handle.stat()).size > LIMIT) throw Error('Snapshot is too large.');
      const buffer = Buffer.alloc(4096), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const text = buffer.toString('utf8', 0, bytesRead), boundary = /,\s*"value"\s*:/.exec(text);
      if (!boundary) throw Error('Damaged snapshot header.');
      const header = JSON.parse(text.slice(0, boundary.index) + '}') as Envelope;
      if (header.version !== 1 || header.id !== id || typeof header.name !== 'string' || !Number.isFinite(header.time)) throw Error('Damaged snapshot header.');
      return { id, name: header.name, time: header.time, recovery: header.recovery === true };
    } finally { await handle.close(); }
  }
  async list(): Promise<Array<Omit<Envelope, 'value' | 'version'>>> {
    let files: string[]; try { files = await fs.readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const entries = await Promise.all(files.filter(file => /^[a-zA-Z0-9-]+\.json$/.test(file)).slice(0, 200).map(async file => {
      try { return await this.metadata(file.slice(0, -5)); }
      catch { return { id: file.slice(0, -5), name: `${file} (damaged; cannot restore)`, time: 0, recovery: false }; }
    }));
    return entries.sort((a, b) => b.time - a.time);
  }
  async read(id: string): Promise<unknown> { return (await this.envelope(id)).value; }
  write(name: string, value: unknown, recoveryId?: string): Promise<string> {
    const operation = this.queue.then(async () => {
      const id = recoveryId ?? randomUUID(), file = this.file(id);
      const data = JSON.stringify({ version: 1, id, name: String(name).slice(0, 120), time: Date.now(), recovery: !!recoveryId, value } satisfies Envelope);
      if (Buffer.byteLength(data) > LIMIT) throw Error('Snapshot exceeds 32 MiB. Save large documents before creating a snapshot.');
      await fs.mkdir(this.directory, { recursive: true });
      const files = (await fs.readdir(this.directory)).filter(file => /^[a-zA-Z0-9-]+\.json$/.test(file));
      if (files.length >= 100 && !files.includes(`${id}.json`)) throw Error('100 snapshots are retained. Remove an old snapshot first.');
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
      return id;
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async remove(id: string): Promise<void> { await this.queue; await fs.rm(this.file(id), { force: true }); }
}
