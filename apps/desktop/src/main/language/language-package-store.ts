import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extract } from 'tar';
import { parse } from 'smol-toml';

export type ExtensionPackage = { id: string; version: string; url: string; sha256: string };
/** Published, pinned packages only. Installation commits after verification/extraction. */
export class LanguagePackageStore {
  private readonly installing = new Map<string, Promise<void>>();
  private readonly packages = new Map<string, Promise<void>>();
  constructor(private readonly directory: string, private readonly download: typeof fetch = fetch) {}
  ensure(pkg: ExtensionPackage): Promise<void> {
    const key = `${pkg.id}@${pkg.version}:${pkg.sha256}`;
    let pending = this.installing.get(key);
    if (!pending) {
      pending = (this.packages.get(pkg.id) ?? Promise.resolve()).catch(() => {}).then(() => this.install(pkg)).finally(() => {
        this.installing.delete(key);
        if (this.packages.get(pkg.id) === pending) this.packages.delete(pkg.id);
      });
      this.installing.set(key, pending); this.packages.set(pkg.id, pending);
    }
    return pending;
  }
  private async install(pkg: ExtensionPackage): Promise<void> {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(pkg.id) || !/^[a-f0-9]{64}$/.test(pkg.sha256)) throw Error('Invalid language package identity.');
    const destination = path.join(this.directory, pkg.id), receipt = JSON.stringify({ version: pkg.version, sha256: pkg.sha256 });
    if (await readFile(path.join(destination, '.setdown-package'), 'utf8').catch(() => '') === receipt
      && await readFile(path.join(destination, 'extension.toml'), 'utf8').catch(() => '')) return;
    await mkdir(this.directory, { recursive: true });
    const staging = path.join(this.directory, `.staging-${pkg.id}-${randomUUID()}`), archive = staging + '.tar.gz';
    await mkdir(staging);
    try {
      const cached = await readFile(path.join(this.directory,'..','archives',pkg.sha256+'.tar.gz')).catch(()=>undefined);
      const response = cached ? new Response(cached) : await this.download(pkg.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error(`Language package download failed (${response.status}).`);
      if (Number(response.headers.get('content-length')) > 128 * 1024 * 1024) throw Error('Language package is too large.');
      const reader = response.body?.getReader(); if (!reader) throw Error('Empty language package.');
      const chunks: Uint8Array[] = []; let length = 0;
      try { for (;;) { const {value,done} = await reader.read(); if (done) break; length += value.length;
        if (length > 128 * 1024 * 1024) throw Error('Language package is too large.'); chunks.push(value); }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks);
      if (createHash('sha256').update(bytes).digest('hex') !== pkg.sha256) throw Error('Language package checksum mismatch.');
      await writeFile(archive, bytes);
      let expanded = 0;
      await extract({ file: archive, cwd: staging, strict: true, preservePaths: false, filter(name, entry) {
        if (name.split(/[\\/]/).includes('..') || path.isAbsolute(name) || /^[a-z]:/i.test(name)
          || !('type' in entry) || !['File', 'Directory'].includes(entry.type)) throw Error('Unsafe language package entry.');
        expanded += entry.size; if (expanded > 512 * 1024 * 1024) throw Error('Expanded language package is too large.');
        return true;
      } });
      const manifest = parse(await readFile(path.join(staging, 'extension.toml'), 'utf8'));
      if (manifest.id !== pkg.id || manifest.version !== pkg.version) throw Error('Language package manifest does not match its catalog identity.');
      await writeFile(path.join(staging, '.setdown-package'), receipt);
      // A stale installation is preserved until its replacement is completely prepared.
      const old = destination + '.previous';
      await rm(old, { recursive: true, force: true });
      let moved = false;
      try { await rename(destination, old); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      try { await rename(staging, destination); } catch (error) { if (moved) await rename(old, destination); throw error; }
      await rm(old, { recursive: true, force: true });
    } finally { await rm(staging, { recursive: true, force: true }); await rm(archive, { force: true }); }
  }
}
