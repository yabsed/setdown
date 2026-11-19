import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

// JetBrains' Kotlin server is started for Setdown by the Zed Kotlin extension, which downloads
// it without a checksum and unpacks it straight into the folder it later takes as installed.
// This file puts a verified server into that folder first, so the extension downloads nothing.
// Where the server is published and where the extension looks are the extension's rules; how it
// is downloaded, verified and put in place are the VS Code Kotlin extension's. Each rule names
// the file it came from, so a newer version of either can be compared against it:
//   https://github.com/zed-extensions/kotlin at v0.3.4 (commit e94974ea06f6494f003efc3161691a59ea1b3300),
//   the version `catalog/zed.json` installs:
//     src/language_servers/kotlin_lsp.rs   the release list, the archive of a platform, the folder and the program
//     src/language_servers/util.rs         which older folders are removed
//   vendor/kotlin-lsp/vscode-extension-core/src/serverBundleDownload.ts    resuming, the checksum, the lock, unpacking
//   vendor/kotlin-lsp/vscode-extension-core/src/serverDownloadRecovery.ts  the words for a download that fails its checksum
//   vendor/kotlin-lsp/RELEASES.md                                          the list itself, with a checksum beside every archive

/** kotlin_lsp.rs `get_release`: where the extension reads the releases from. */
export const kotlinReleasesUrl = 'https://raw.githubusercontent.com/Kotlin/kotlin-lsp/refs/heads/main/RELEASES.md';
/** serverBundleDownload.ts `INSTALL_LOCK_RETRY_DELAY_MS`, `INSTALL_LOCK_STALE_MS` and
 * `DOWNLOAD_IDLE_TIMEOUT_MS`, in milliseconds. A lock is touched four times in `lockStale`. */
export const kotlinDownloadLimits = { lockRetry: 200, lockStale: 2 * 60 * 1000, idle: 2 * 60 * 1000 };

export type KotlinRelease = {
  version: string;
  /** The standalone archive for one platform. */
  url: string;
  /** JetBrains publishes the archive's SHA-256 beside it, in a file of the same name and `.sha256`. */
  checksumUrl: string;
  /** The name of the folder the Zed extension installs this release into, inside its work folder. */
  folder: string };

/** kotlin_lsp.rs `is_jetbrains_url`: an address the extension would download from. */
function jetbrainsUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'jetbrains.com' || url.hostname.endsWith('.jetbrains.com')); }
  catch { return false; }
}

/** kotlin_lsp.rs `extract_release_from_markdown` and `download_from_teamcity`: the newest
 * release is the first `### v` heading of RELEASES.md. Its archives are published where the
 * first link of that section which is on jetbrains.com and has the version as a path segment
 * points, or at the usual address when the section has no such link. The archive is named
 * after the version and the platform; there is none for 32-bit x86, or for a system other
 * than Linux, macOS and Windows.
 *
 * The version becomes a folder name, so one that could leave the work folder is not a release
 * (serverBundleDownload.ts `readServerBundleMetadata`, "bad version"). */
export function kotlinRelease(releasesMarkdown: string, platform: NodeJS.Platform, arch: string): KotlinRelease | undefined {
  const lines = releasesMarkdown.split(/\r?\n/), heading = lines.findIndex(line => line.startsWith('### v'));
  const version = heading < 0 ? '' : lines[heading].slice('### v'.length).trim();
  const suffix = arch === 'x64' ? '' : arch === 'arm64' ? '-aarch64' : undefined;
  const kind = platform === 'win32' ? '.win.zip' : platform === 'darwin' ? '.sit' : platform === 'linux' ? '.tar.gz' : undefined;
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version) || suffix === undefined || !kind) return undefined;
  const segment = `/${version}/`;
  let base: string | undefined;
  for (const line of lines.slice(heading + 1)) {
    if (base || line.startsWith('### ')) break;
    for (const link of line.split('](').slice(1)) {
      const url = link.includes(')') ? link.slice(0, link.indexOf(')')) : '', at = url.indexOf(segment);
      if (at >= 0 && jetbrainsUrl(url)) { base = url.slice(0, at + segment.length - 1); break; }
    }
  }
  const url = `${base ?? `https://download.jetbrains.com/language-server/kotlin-server/${version}`}/kotlin-server-${version}${suffix}${kind}`;
  return { version, url, checksumUrl: `${url}.sha256`, folder: `kotlin-lsp-${version}` };
}

/** kotlin_lsp.rs `download_from_teamcity`: the program the extension starts, given the folder
 * of a release. The Windows archive holds the server's own folders; the others hold one
 * folder named after the release, and the extension keeps it. */
export function kotlinLauncher(folder: string, version: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.join(folder, 'bin', 'intellij-server.exe') : path.join(folder, `kotlin-server-${version}`, 'bin', 'intellij-server');
}

/** serverBundleDownload.ts `ServerBundleChecksumError`, in the words serverDownloadRecovery.ts
 * shows a person. The VS Code extension then offers to download again; the file is gone by
 * then, so the next call starts from the beginning. */
export class KotlinChecksumError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`Could not verify the language server download: expected SHA-256 ${expected}, got ${actual}. The downloaded file was deleted.`);
    this.name = 'KotlinChecksumError';
  }
}

/** serverBundleDownload.ts `createAbortError`. */
const abortError = () => Object.assign(new Error('Language server download cancelled'), { name: 'AbortError' });
const throwIfAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** Ends a wait when `signal` fires, whether or not the `fetch` in use listens to it. */
function halting<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** A small text file: the release list, or a checksum. */
async function text(fetcher: typeof fetch, url: string, limit: number, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const late = AbortSignal.timeout(limit), either = signal ? AbortSignal.any([signal, late]) : late;
  try {
    const response = await halting(fetcher(url, { signal: either }), either);
    if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    return await halting(response.text(), either);
  } catch (error) {
    throwIfAborted(signal);
    throw late.aborted ? new Error(`Timed out downloading ${url}: no response received`) : error;
  }
}

/** serverBundleDownload.ts `downloadFile`, one request of it: the bytes go to `destination`,
 * after the part that is already there when the server continues from it. Answers true when
 * that part cannot be continued, and the download has to start again without it. */
async function receive(url: string, destination: string, fetcher: typeof fetch, options: Pick<KotlinServerOptions, 'signal' | 'progress' | 'idle'>, resume: boolean): Promise<boolean> {
  const { signal, progress } = options;
  throwIfAborted(signal);
  const existing = resume ? (await stat(destination).catch(() => undefined))?.size ?? 0 : 0;
  const stopped = new AbortController(), cancel = () => stopped.abort();
  let stalled = '', timer: NodeJS.Timeout | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  // The time limit is for a download that has stopped, not for a slow one: every byte starts it again.
  const waiting = (what: string) => { clearTimeout(timer); timer = setTimeout(() => { stalled = what; stopped.abort(); }, options.idle ?? kotlinDownloadLimits.idle); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    waiting('no response received');
    const response = await halting(fetcher(url, { ...(existing ? { headers: { Range: `bytes=${existing}-` } } : {}), signal: stopped.signal }), stopped.signal);
    reader = response.body?.getReader();
    const status = response.status, range = response.headers.get('content-range') ?? '';
    if (existing && status === 416) {
      // Nothing is left to send when the file ends where the saved part does.
      const whole = Number(/^bytes \*\/(\d+)$/.exec(range)?.[1]) === existing;
      if (whole) progress?.(existing, existing);
      return !whole;
    }
    // `resumedDownloadTotal`: the server continues only when it says so, from the very byte asked for.
    const [from, to, size] = (status === 206 ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)?.slice(1) ?? [] : []).map(Number);
    const append = existing > 0 && from === existing && to >= from && size > to;
    if (existing && status === 206 && !append) return true;
    // A plain 200 to a request for the rest is the whole file again, and replaces the saved part.
    if (status !== 200 && !append) throw new Error(`Failed to download ${url}: HTTP ${status}`);
    if (!reader) throw new Error(`Failed to download ${url}: the answer has no content`);
    const length = Number.parseInt(response.headers.get('content-length') ?? '', 10), total = append ? size : length > 0 ? length : undefined;
    const file = await open(destination, append ? 'a' : 'w');
    try {
      let received = append ? existing : 0;
      progress?.(received, total);
      for (;;) {
        waiting('no data received');
        const chunk = await halting(reader.read(), stopped.signal);
        if (chunk.done) break;
        await file.write(chunk.value);
        received += chunk.value.length;
        progress?.(received, total);
      }
    } finally { await file.close(); }
    return false;
  } catch (error) {
    throwIfAborted(signal);
    throw stalled ? new Error(`Timed out downloading ${url}: ${stalled}`) : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await reader?.cancel().catch(() => {});
  }
}

/** serverBundleDownload.ts `sha256`. */
async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** serverBundleDownload.ts `quarantineStaleInstallLock` and `quarantineIncompleteServerDir`:
 * moved aside in one step, so that nobody meets it half deleted, and then deleted. */
async function discard(target: string, why: 'stale' | 'incomplete'): Promise<void> {
  const aside = `${target}.${why}.${process.pid}.${Date.now()}`;
  try { await rename(target, aside); } catch (error) { if (errorCode(error) === 'ENOENT') return; throw error; }
  await rm(aside, { recursive: true, force: true });
}

/** serverBundleDownload.ts `withInstallLock`: one installer at a time. The lock is a folder,
 * which only one process can create, and holds a file that names its owner and is touched
 * while the owner works. A lock is taken over when its owner's process is gone, or when it was
 * not touched for `lockStale`, so a crashed installer does not keep the others out; behind a
 * live one the wait lasts as long as that one works, and ends without `action` when it leaves
 * the server installed. The VS Code extension's ten-minute limit is not carried over: it is
 * only reached when the lock disappears at that very moment. Its lock lies beside the server's
 * folder; this one lies in `server-downloads`, because the Zed extension removes every entry
 * of its work folder that starts with `kotlin-lsp` when it installs a release itself. */
async function withInstallLock(lock: string, installed: () => boolean, signal: AbortSignal | undefined, action: () => Promise<void>): Promise<void> {
  await mkdir(path.dirname(lock), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`, mine = path.join(lock, `owner.${token}.json`);
  for (;;) {
    throwIfAborted(signal);
    if (installed()) return;
    try {
      await mkdir(lock);
      await writeFile(mine, JSON.stringify({ token, pid: process.pid, createdAt: Date.now(), updatedAt: Date.now() }, null, 2));
      break;
    } catch (error) { if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ENOTEMPTY') throw error; }
    // `findInstallLockOwnerPath`: the newest owner file, or the lock folder itself before its owner has written one.
    let owner: string | undefined, touched = (await stat(lock).catch(() => undefined))?.mtimeMs;
    for (const name of (await readdir(lock).catch(() => [] as string[])).filter(name => name.startsWith('owner.') && name.endsWith('.json'))) {
      const found = await stat(path.join(lock, name)).catch(() => undefined);
      if (found?.isFile() && (!owner || found.mtimeMs > touched!)) { owner = path.join(lock, name); touched = found.mtimeMs; }
    }
    // `isInstallLockOwnerAlive`: only a process that is certainly gone gives its lock up at once.
    let gone = false;
    try { const pid: unknown = owner && JSON.parse(await readFile(owner, 'utf8')).pid; if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 0); }
    catch (error) { gone = errorCode(error) === 'ESRCH'; }
    if (gone || (touched !== undefined && Date.now() - touched > kotlinDownloadLimits.lockStale)) { await discard(lock, 'stale'); continue; }
    if (installed()) return;
    await halting(new Promise<void>(resolve => { setTimeout(resolve, kotlinDownloadLimits.lockRetry); }), signal);
  }
  const heartbeat = setInterval(() => { const now = new Date(); void utimes(mine, now, now).catch(() => {}); }, kotlinDownloadLimits.lockStale / 4);
  heartbeat.unref();
  try { await action(); }
  finally {
    clearInterval(heartbeat);
    await rm(mine, { force: true }).catch(() => {});
    // Only an empty folder is removed, so a lock that another installer took over stays its own.
    await rmdir(lock).catch(() => {});
  }
}

/** serverBundleDownload.ts `extractServerBundle`, `tarCommand` and `run`, without the
 * `--strip-components=1` and the promotion of a `.sit`'s only folder: the Zed extension keeps
 * the layout of the archive. `tar` reads the `.zip` and the `.sit` too where those are used. */
async function unpackWithTar(archive: string, into: string, signal?: AbortSignal): Promise<void> {
  const name = archive.toLowerCase(), tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const args = name.endsWith('.tar.gz') || name.endsWith('.tgz') ? ['-xzf', archive, '-C', into] : name.endsWith('.zip') || name.endsWith('.sit') ? ['-xf', archive, '-C', into] : undefined;
  if (!args) throw new Error(`Unsupported language server archive type: ${archive}`);
  await new Promise<void>((resolve, reject) => execFile(tar, args, { signal }, (error, _output, problems) =>
    error ? reject(signal?.aborted ? abortError() : new Error(`${tar} ${args.join(' ')} failed: ${String(problems).trim().slice(-2000) || error.message}`)) : resolve()));
}

export type KotlinServerOptions = {
  /** The Zed Kotlin extension's work folder, `…/extensions/work/kotlin`. Nothing is written outside it. */
  work: string;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  signal?: AbortSignal;
  /** The bytes of the archive that are on disk, and its size when the server states it. */
  progress?(received: number, total: number | undefined): void;
  /** Unpacks the verified archive into an empty folder and keeps the archive's layout. Without it, `tar` does. */
  unpack?(archive: string, into: string): Promise<void>;
  /** How long a download may receive nothing before it is given up, in milliseconds. */
  idle?: number };

/** serverBundleDownload.ts `downloadAndExtractServerBundle` and `publishExtractedServerBundle`.
 * The archive is kept in `server-downloads/<version>` until it is whole, so an interrupted
 * download continues where it stopped. It is unpacked only when its SHA-256 is the published
 * one, into a folder beside it, and that folder is renamed to the one the extension uses: the
 * extension never finds a half-unpacked server, which it would take as installed. */
async function install(release: KotlinRelease, work: string, platform: NodeJS.Platform, fetcher: typeof fetch, options: KotlinServerOptions): Promise<void> {
  const { signal } = options, folder = path.join(work, release.folder), downloads = path.join(work, 'server-downloads', release.version);
  const archive = path.join(downloads, path.posix.basename(new URL(release.url).pathname) || 'server-bundle');
  // Before the archive, so that a release without a checksum costs no download.
  const published = /^[0-9a-f]{64}(?=\s|$)/i.exec((await text(fetcher, release.checksumUrl, options.idle ?? kotlinDownloadLimits.idle, signal)).trim())?.[0].toLowerCase();
  if (!published) throw new Error(`No SHA-256 checksum was found at ${release.checksumUrl}, so the language server was not downloaded`);
  await mkdir(downloads, { recursive: true });
  const temporary = await mkdtemp(path.join(downloads, 'server-download-')), unpacked = path.join(temporary, 'server');
  try {
    if (await receive(release.url, archive, fetcher, options, true)) { await rm(archive, { force: true }); await receive(release.url, archive, fetcher, options, false); }
    throwIfAborted(signal);
    const actual = await sha256(archive);
    if (actual !== published) { await rm(archive, { force: true }); throw new KotlinChecksumError(published, actual); }
    await mkdir(unpacked);
    await (options.unpack ?? ((from, into) => unpackWithTar(from, into, signal)))(archive, unpacked);
    throwIfAborted(signal);
    const program = kotlinLauncher(unpacked, release.version, platform);
    if (!existsSync(program)) throw new Error(`Unpacked language server is missing its launcher: ${path.relative(unpacked, program)}`);
    // kotlin_lsp.rs `make_file_executable`: an archive format that keeps no permissions leaves the program unable to start.
    if (platform !== 'win32') await chmod(program, 0o755);
    // A folder without the program is what an interrupted install by the extension leaves; it would be used as it is.
    if (!existsSync(kotlinLauncher(folder, release.version, platform))) { await discard(folder, 'incomplete'); await rename(unpacked, folder); }
    await rm(downloads, { recursive: true, force: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** serverBundleDownload.ts `ensureServerLauncher`, for the folder of the Zed extension. The
 * release list is read first, as the extension reads it, because the newest version names the
 * folder. When that folder holds the program the extension starts, nothing more is done.
 * Otherwise the archive is downloaded, verified and unpacked into that folder, by one caller
 * at a time. Rejects, and leaves the extension's folder as it was, when the release list or
 * the checksum cannot be read, the checksum does not match (`KotlinChecksumError`), or
 * `signal` fires (an error named `AbortError`). */
export async function ensureKotlinServer(options: KotlinServerOptions): Promise<{ folder: string; version: string; downloaded: boolean }> {
  const { signal, platform = process.platform, arch = process.arch } = options, fetcher = options.fetch ?? fetch, work = path.resolve(options.work);
  const release = kotlinRelease(await text(fetcher, kotlinReleasesUrl, options.idle ?? kotlinDownloadLimits.idle, signal), platform, arch);
  if (!release) throw new Error(`No Kotlin language server for ${platform} ${arch} was found in ${kotlinReleasesUrl}`);
  const folder = path.join(work, release.folder), launcher = kotlinLauncher(folder, release.version, platform), installed = () => existsSync(launcher);
  let downloaded = false;
  if (!installed()) await withInstallLock(path.join(work, 'server-downloads', `${release.version}.lock`), installed, signal, async () => {
    if (installed()) return;
    await install(release, work, platform, fetcher, options);
    downloaded = true;
  });
  if (!installed()) throw new Error(`Downloaded language server is missing launcher: ${launcher}`);
  return { folder, version: release.version, downloaded };
}

/** util.rs `remove_outdated_versions`: the folders of other releases, which the extension
 * removes after a download of its own and so never does once `ensureKotlinServer` installs
 * for it; a release is 1.2 GB unpacked. Not part of `ensureKotlinServer`, because a running
 * extension remembers the program it started first and would be left with a removed one:
 * this is for a moment when the extension is not running. `keep` is a `KotlinRelease.folder`. */
export async function removeOutdatedKotlinServers(work: string, keep: string): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await readdir(work, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith('kotlin-lsp') || entry.name === keep) continue;
    await rm(path.join(work, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

type KotlinProgress = NonNullable<KotlinServerOptions['progress']>;
const runs = new Map<string, { found: ReturnType<typeof ensureKotlinServer>; listeners: Set<KotlinProgress> }>(), used = new Set<string>();

/** `ensureKotlinServer`, asked once in each run of the application for one work folder, as the
 * Zed extension reads the release list once and keeps what it found (kotlin_lsp.rs
 * `cached_binary_path`). Every caller hears the progress of the one download. A check that
 * failed is made again by the next caller, and `forgetKotlinServer` asks for a new one after
 * the extension could not start the server.
 *
 * util.rs `remove_outdated_versions` is applied here and only by the first check of a run:
 * no server of this run has been started from an older folder then, and one application at a
 * time uses a profile. A release that appears later in the run leaves the older folder in
 * place until the next run. */
export function kotlinServerForRun(options: KotlinServerOptions): ReturnType<typeof ensureKotlinServer> {
  const work = path.resolve(options.work);
  let run = runs.get(work);
  if (!run) {
    const first = !used.has(work), listeners = new Set<KotlinProgress>();
    used.add(work);
    const found = ensureKotlinServer({ ...options, work, progress: (received, total) => { for (const listener of listeners) listener(received, total); } }).then(async server => {
      if (first) await removeOutdatedKotlinServers(work, path.basename(server.folder)).catch(() => {});
      return server;
    });
    const started = run = { found, listeners };
    runs.set(work, started);
    found.catch(() => { if (runs.get(work) === started) runs.delete(work); });
  }
  const { found, listeners } = run, listener = options.progress;
  if (!listener) return found;
  listeners.add(listener);
  return found.finally(() => listeners.delete(listener));
}
export function forgetKotlinServer(work: string): void { runs.delete(path.resolve(work)); }
