import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readPdfMetadata, readPdfRange } from '../documents/pdf-file';

/** One immutable download per navigation. PDF.js reads bounded ranges from it;
 * the renderer never receives a filesystem path or a general-purpose fetch API. */
export class BrowserPdf {
  private readonly abort = new AbortController();
  private directory?: string;
  private file?: string;
  private version?: Awaited<ReturnType<typeof readPdfMetadata>>['diskVersion'];
  private disposed = false;
  async open(url: string, fetch: (url: string, init: RequestInit) => Promise<Response>): Promise<number> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]);
    const response = await fetch(url, { signal, credentials: 'include' });
    if (!response.ok || !response.body) throw Error(`Could not download PDF (HTTP ${response.status}).`);
    const limit = 256 * 1024 * 1024;
    const reader = response.body.getReader();
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      if (Number(response.headers.get('content-length')) > limit) throw Error('This PDF exceeds the 256 MiB reading limit. Save it to read locally.');
      this.directory = await fs.mkdtemp(path.join(tmpdir(), 'setdown-web-pdf-'));
      this.file = path.join(this.directory, 'document.pdf');
      handle = await fs.open(this.file, 'wx', 0o600);
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw Error('This PDF exceeds the 256 MiB reading limit. Save it to read locally.');
        await handle.writeFile(value);
      }
      await handle.close(); handle = undefined;
      signal.throwIfAborted();
      this.version = (await readPdfMetadata(this.file)).diskVersion;
      if (this.disposed) throw Error('This PDF navigation was canceled.');
      return this.version.size;
    } catch (error) {
      await handle?.close();
      await this.dispose();
      throw error;
    } finally { await reader.cancel().catch(() => {}); }
  }
  async read(begin: number, end: number): Promise<Uint8Array> {
    if (this.disposed || !this.file || !this.version) throw Error('This PDF is no longer available.');
    const bytes = await readPdfRange(this.file, begin, end, this.version);
    if (this.disposed) throw Error('This PDF navigation was canceled.');
    return bytes;
  }
  async save(destination: string): Promise<void> {
    if (this.disposed || !this.file || !this.version) throw Error('This PDF is no longer available.');
    await fs.copyFile(this.file, destination);
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.abort.abort();
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
  }
}
