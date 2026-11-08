import { mkdirSync, mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ByteCache } from '../../core/memory/byte-cache';

/** Navigation URLs outlive the RAM cache. Spilling to private temporary files
 * allows large documents and Git standby navigation without retaining their
 * complete HTML in main. In-flight navigation leases prevent early expiry. */
export class PreviewHtmlStore {
  private readonly cache: ByteCache<string, string>;
  private readonly entries = new Map<string, { file: string; ready: Promise<void>; leases: number }>();
  private directory?: string;
  private dead = false;
  constructor(capacity = 32 * 1024 * 1024, private readonly root = tmpdir()) { this.cache = new ByteCache(capacity, 64); }
  get bytes() { return this.cache.bytes; }
  get size() { return this.entries.size; }
  put(token: string, html: string): void {
    if (this.dead || !/^[\w.-]+$/.test(token)) throw Error('Invalid preview document');
    if (!this.directory) mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const directory = this.directory ??= mkdtempSync(path.join(this.root, 'setdown-preview-html-'));
    const file = path.join(directory, token);
    const ready = fs.writeFile(file, html, { mode: 0o600 });
    // Keep write errors observable on read, without an unhandled rejection.
    void ready.catch(() => undefined);
    this.entries.set(token, { file, ready, leases: 0 });
    this.cache.set(token, html, html.length * 2);
  }
  async get(token: string): Promise<string | null> {
    const entry = this.entries.get(token);
    if (!entry) return null;
    const cached = this.cache.get(token);
    if (cached !== undefined) return cached;
    entry.leases++;
    try { await entry.ready; return await fs.readFile(entry.file, 'utf8'); }
    finally { entry.leases--; }
  }
  lease(token: string): () => void {
    const entry = this.entries.get(token);
    if (!entry) return () => {};
    entry.leases++;
    let released = false;
    return () => { if (!released) { released = true; entry.leases--; } };
  }
  trim(protectedTokens: Set<string>, pressure = false): void {
    if (pressure) this.cache.clear();
    for (const [token, entry] of this.entries) {
      if (this.entries.size <= (pressure ? 1 : 64)) break;
      if (entry.leases || protectedTokens.has(token)) continue;
      this.entries.delete(token); this.cache.delete(token);
      void entry.ready.catch(() => undefined).then(() => fs.rm(entry.file, { force: true })).catch(() => undefined);
    }
  }
  async dispose(): Promise<void> {
    this.dead = true; this.cache.clear();
    await Promise.allSettled([...this.entries.values()].map(entry => entry.ready));
    this.entries.clear();
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
  }
  disposeOnExit(): void {
    // Synchronous will-quit, where no new HTML writes can begin. A subsequent
    // application startup removes any residue from interrupted writes.
    this.dead = true; this.cache.clear();
    if (this.directory) try { rmSync(this.directory, { recursive: true, force: true }); } catch { /* OS cleanup can finish later. */ }
  }
}
