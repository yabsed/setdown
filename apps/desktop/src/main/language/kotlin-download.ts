import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

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
// A `kotlin-lsp` on PATH comes before this folder: Setdown's own search finds it first, and from
// v0.3.5 the extension itself starts it first (the Zed project engine installs the registry's
// newest extension, not the catalog's). One that says its build is outdated is set aside
// (`program-health.ts`, the host's `skipPrograms`) and the server of this folder is started.
// Which build is the newest is asked of two places, because the list is written by hand and has
// stayed behind (see `kotlinExtensionUrl`): the list, and the package of JetBrains' own extension.

/** kotlin_lsp.rs `get_release`: where the extension reads the releases from. */
export const kotlinReleasesUrl = 'https://raw.githubusercontent.com/Kotlin/kotlin-lsp/refs/heads/main/RELEASES.md';
/** serverBundleDownload.ts `INSTALL_LOCK_RETRY_DELAY_MS`, `INSTALL_LOCK_STALE_MS` and
 * `DOWNLOAD_IDLE_TIMEOUT_MS`, in milliseconds. A lock is touched four times in `lockStale`. */
export const kotlinDownloadLimits = { lockRetry: 200, lockStale: 2 * 60 * 1000, idle: 2 * 60 * 1000 };
/** Setdown's own, in milliseconds: how long the extension's package may take to answer, so that a slow registry
 * does not hold a file back, and how long an answer about the newest build is kept within one run of the application. */
export const kotlinSourceLimits = { extension: 20 * 1000, recheck: 30 * 60 * 1000 };

export type KotlinRelease = {
  version: string;
  /** The standalone archive for one platform. */
  url: string;
  /** JetBrains publishes the archive's SHA-256 beside it, in a file of the same name and `.sha256`. */
  checksumUrl: string;
  /** The name of the folder the Zed extension installs this release into, inside its work folder. */
  folder: string;
  /** The SHA-256 JetBrains' extension states for the archive. It has to be the one published beside the archive. */
  sha256?: string };

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
  const version = heading < 0 ? '' : lines[heading].slice('### v'.length).trim(), archive = kotlinArchive(version, platform, arch);
  if (!archive) return undefined;
  const segment = `/${version}/`;
  let base: string | undefined;
  for (const line of lines.slice(heading + 1)) {
    if (base || line.startsWith('### ')) break;
    for (const link of line.split('](').slice(1)) {
      const url = link.includes(')') ? link.slice(0, link.indexOf(')')) : '', at = url.indexOf(segment);
      if (at >= 0 && jetbrainsUrl(url)) { base = url.slice(0, at + segment.length - 1); break; }
    }
  }
  const url = `${base ?? `https://download.jetbrains.com/language-server/kotlin-server/${version}`}/${archive}`;
  return { version, url, checksumUrl: `${url}.sha256`, folder: `kotlin-lsp-${version}` };
}
/** kotlin_lsp.rs `download_from_teamcity`: the name of the archive of a version for a platform.
 * None for a version that could not be a folder name, or a platform JetBrains builds none for. */
export function kotlinArchive(version: string, platform: NodeJS.Platform, arch: string): string | undefined {
  const suffix = arch === 'x64' ? '' : arch === 'arm64' ? '-aarch64' : undefined;
  const kind = platform === 'win32' ? '.win.zip' : platform === 'darwin' ? '.sit' : platform === 'linux' ? '.tar.gz' : undefined;
  return /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version) && suffix !== undefined && kind ? `kotlin-server-${version}${suffix}${kind}` : undefined;
}

/** RELEASES.md is written by hand and has stayed behind the builds JetBrains publishes. On
 * 2026-11-27 its newest entry was 271.2085.0, a build that had reached its end date and ended
 * at every start ("This build of kotlin-server has expired"), while 271.3588.0 lay on the same
 * server (Kotlin/kotlin-lsp issue 302 reports the same for the entry before it).
 *
 * JetBrains' own VS Code extension names the build it runs in a file of its package
 * (serverBundleDownload.ts `SERVER_BUNDLE_METADATA_FILE`, `readServerBundleMetadata`), and
 * RELEASES.md says where that extension is published for editors other than VS Code: the Open
 * VSX registry. `<target>/latest` answers with the newest version for a platform and the
 * address of its package, which is a zip of about 1.5 MB.
 *
 * Only the number of the build is taken from there. The archive has to be the one the Zed
 * extension's rule names, on JetBrains' server, and its checksum is read from that server as
 * for a listed build, so the registry cannot make Setdown start anything but a JetBrains build. */
export const kotlinExtensionUrl = 'https://open-vsx.org/api/JetBrains/kotlin-server';
export const kotlinBundleFile = 'extension/server-bundle.json';
/** The registry's name for a platform, as VS Code names it. */
export function kotlinExtensionTarget(platform: NodeJS.Platform, arch: string): string | undefined {
  return (platform === 'linux' || platform === 'darwin' || platform === 'win32') && (arch === 'x64' || arch === 'arm64') ? `${platform}-${arch}` : undefined;
}
/** serverBundleDownload.ts `readServerBundleMetadata`, for the content of `server-bundle.json`:
 * the release it names, when that is this platform's archive on JetBrains' server. */
export function kotlinBundleRelease(bundle: unknown, platform: NodeJS.Platform, arch: string): KotlinRelease | undefined {
  const { url, version, sha256 } = (bundle && typeof bundle === 'object' ? bundle : {}) as Record<string, unknown>;
  if (typeof url !== 'string' || typeof version !== 'string') return undefined;
  if (sha256 !== undefined && (typeof sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sha256))) return undefined;
  const archive = kotlinArchive(version, platform, arch);
  let named = '';
  try { named = path.posix.basename(new URL(url).pathname); } catch { return undefined; }
  if (!archive || named !== archive || !jetbrainsUrl(url)) return undefined;
  return { version, url, checksumUrl: `${url}.sha256`, folder: `kotlin-lsp-${version}`, ...(typeof sha256 === 'string' ? { sha256: sha256.toLowerCase() } : {}) };
}
/** Build numbers compare part by part as numbers: 271.3588.0 is newer than 271.2085.0 and than 263.7084.0. */
export function compareKotlinBuilds(a: string, b: string): number {
  const parts = (version: string) => version.split(/[._-]/), left = parts(a), right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index] ?? '0', y = right[index] ?? '0';
    const order = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (order) return order;
  }
  return 0;
}
/** One file out of a zip that is held in memory: the end record, the directory, the file's
 * bytes. Sizes are read from the directory, because a package writes them after the data. */
export function zipEntry(zip: Buffer, name: string, limit = 1024 * 1024): Buffer | undefined {
  try {
    // The end record is the last one; a comment of up to 65535 bytes may follow it.
    let end = -1;
    for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) if (zip.readUInt32LE(at) === 0x06054b50) { end = at; break; }
    if (end < 0) return undefined;
    let at = zip.readUInt32LE(end + 16);
    for (let index = zip.readUInt16LE(end + 10); index > 0; index--) {
      if (zip.readUInt32LE(at) !== 0x02014b50) return undefined;
      const method = zip.readUInt16LE(at + 10), packed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24);
      const nameLength = zip.readUInt16LE(at + 28), local = zip.readUInt32LE(at + 42);
      if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
        if (size > limit || zip.readUInt32LE(local) !== 0x04034b50) return undefined;
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), data = zip.subarray(start, start + packed);
        if (data.length !== packed) return undefined;
        const content = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: limit }) : undefined;
        return content && content.length === size ? Buffer.from(content) : undefined;
      }
      at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
  } catch { /* Not a zip this reads: the answer is that the file is not in it. */ }
  return undefined;
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

/** A file that is held in memory: the package of the extension. More than `most` bytes is not one. */
async function bytes(fetcher: typeof fetch, url: string, limit: number, most: number, signal?: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal);
  const late = AbortSignal.timeout(limit), either = signal ? AbortSignal.any([signal, late]) : late;
  try {
    const response = await halting(fetcher(url, { signal: either }), either);
    if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') ?? 0) > most) throw new Error(`Failed to download ${url}: larger than ${most} bytes`);
    const content = Buffer.from(await halting(response.arrayBuffer(), either));
    if (content.length > most) throw new Error(`Failed to download ${url}: larger than ${most} bytes`);
    return content;
  } catch (error) {
    throwIfAborted(signal);
    throw late.aborted ? new Error(`Timed out downloading ${url}: no response received`) : error;
  }
}
/** An address of the registry the extension is published in. */
function registryUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'open-vsx.org' || url.hostname.endsWith('.open-vsx.org')); }
  catch { return false; }
}
/** The build the newest "Kotlin by JetBrains" extension runs (see `kotlinExtensionUrl`). The
 * package is downloaded once for each version of the extension: what it named is kept in
 * `server-downloads/extension.json` beside the downloads, and the next run asks only which
 * version is the newest. */
async function extensionRelease(fetcher: typeof fetch, work: string, platform: NodeJS.Platform, arch: string, limit: number, signal?: AbortSignal): Promise<KotlinRelease | undefined> {
  const target = kotlinExtensionTarget(platform, arch);
  if (!target) return undefined;
  const latest = JSON.parse(await text(fetcher, `${kotlinExtensionUrl}/${target}/latest`, limit, signal)) as { version?: unknown; files?: { download?: unknown } } | null;
  const extension = typeof latest?.version === 'string' ? latest.version : '', download = typeof latest?.files?.download === 'string' ? latest.files.download : '';
  if (!extension || !registryUrl(download)) throw new Error(`The registry named no package of the Kotlin extension for ${target}`);
  const memory = path.join(work, 'server-downloads', 'extension.json');
  const kept = await readFile(memory, 'utf8').then(saved => JSON.parse(saved) as { target?: unknown; extension?: unknown; bundle?: unknown }, () => undefined);
  const remembered = kept?.target === target && kept.extension === extension ? kotlinBundleRelease(kept.bundle, platform, arch) : undefined;
  if (remembered) return remembered;
  const file = zipEntry(await bytes(fetcher, download, limit, 32 * 1024 * 1024, signal), kotlinBundleFile);
  if (!file) throw new Error(`The Kotlin extension ${extension} holds no ${kotlinBundleFile}`);
  const bundle: unknown = JSON.parse(file.toString('utf8')), release = kotlinBundleRelease(bundle, platform, arch);
  if (!release) throw new Error(`The Kotlin extension ${extension} names no server archive of JetBrains for ${target}`);
  await mkdir(path.dirname(memory), { recursive: true });
  await writeFile(memory, JSON.stringify({ target, extension, bundle })).catch(() => {});
  return release;
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
  // Two statements about one archive, of JetBrains' server and of JetBrains' extension, have to agree.
  if (release.sha256 && release.sha256 !== published) throw new Error(`The SHA-256 at ${release.checksumUrl} is not the one the Kotlin extension names for this archive, so the language server was not downloaded`);
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

/** What is started: the folder of a release in the extension's work folder, and the program in it. */
export type KotlinServer = { folder: string; version: string; program: string; downloaded: boolean };

/** The servers that are in the work folder with their program, the newest build first. */
export async function installedKotlinServers(work: string, platform: NodeJS.Platform = process.platform): Promise<Omit<KotlinServer, 'downloaded'>[]> {
  const found: Omit<KotlinServer, 'downloaded'>[] = [];
  for (const entry of await readdir(work, { withFileTypes: true }).catch(() => [])) {
    const version = entry.isDirectory() && entry.name.startsWith('kotlin-lsp-') ? entry.name.slice('kotlin-lsp-'.length) : '';
    const folder = path.join(work, entry.name), program = version ? kotlinLauncher(folder, version, platform) : '';
    if (program && existsSync(program)) found.push({ folder, version, program });
  }
  return found.sort((a, b) => compareKotlinBuilds(b.version, a.version));
}

/** serverBundleDownload.ts `ensureServerLauncher`, for the folder of the Zed extension. Which
 * build is the newest is asked first, of the release list as the extension reads it and of
 * JetBrains' own extension (`kotlinExtensionUrl`), because the newest version names the folder.
 * One place that does not answer is no obstacle while the other does. When the folder of the
 * newest build holds the program, nothing more is done. Otherwise its archive is downloaded,
 * verified and unpacked into that folder, by one caller at a time; a build that cannot be put
 * in place gives way to the next older one that was named.
 *
 * When neither place answers, the newest server that is already in the work folder is used:
 * a computer without a network keeps the Kotlin support it had.
 *
 * Rejects, and leaves the extension's folder as it was, when no build could be named and none
 * is installed, a checksum cannot be read or does not match (`KotlinChecksumError`) for every
 * build named, or `signal` fires (an error named `AbortError`). */
export async function ensureKotlinServer(options: KotlinServerOptions): Promise<KotlinServer> {
  const { signal, platform = process.platform, arch = process.arch } = options, fetcher = options.fetch ?? fetch, work = path.resolve(options.work);
  const limit = options.idle ?? kotlinDownloadLimits.idle;
  const [listed, bundled] = await Promise.allSettled([
    text(fetcher, kotlinReleasesUrl, limit, signal).then(markdown => kotlinRelease(markdown, platform, arch)),
    extensionRelease(fetcher, work, platform, arch, Math.min(limit, kotlinSourceLimits.extension), signal)]);
  throwIfAborted(signal);
  const named = [listed, bundled].flatMap(found => found.status === 'fulfilled' && found.value ? [found.value] : []);
  const releases = named.filter((release, index) => named.findIndex(other => other.version === release.version) === index).sort((a, b) => compareKotlinBuilds(b.version, a.version));
  if (!releases.length) {
    const [present] = await installedKotlinServers(work, platform);
    if (present) return { ...present, downloaded: false };
    if (listed.status === 'rejected') throw listed.reason;
    throw new Error(`No Kotlin language server for ${platform} ${arch} was found in ${kotlinReleasesUrl}`);
  }
  let failure: unknown;
  for (const release of releases) {
    const folder = path.join(work, release.folder), launcher = kotlinLauncher(folder, release.version, platform), installed = () => existsSync(launcher);
    try {
      let downloaded = false;
      if (!installed()) await withInstallLock(path.join(work, 'server-downloads', `${release.version}.lock`), installed, signal, async () => {
        if (installed()) return;
        await install(release, work, platform, fetcher, options);
        downloaded = true;
      });
      if (!installed()) throw new Error(`Downloaded language server is missing launcher: ${launcher}`);
      return { folder, version: release.version, program: launcher, downloaded };
    } catch (error) {
      throwIfAborted(signal);
      failure ??= error;
    }
  }
  throw failure;
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
const runs = new Map<string, { found: ReturnType<typeof ensureKotlinServer>; listeners: Set<KotlinProgress>; at: number }>(), used = new Set<string>();

/** `ensureKotlinServer`, asked once for one work folder and then kept for `recheck`, as the Zed
 * extension reads the release list once and keeps what it found (kotlin_lsp.rs
 * `cached_binary_path`). The extension keeps it until Zed ends; an application that stays open
 * for days would not hear of a newer build, so the answer is asked for again after half an
 * hour. Every caller hears the progress of the one download. A check that failed is made again
 * by the next caller, and `forgetKotlinServer` asks for a new one after the server could not
 * be started.
 *
 * util.rs `remove_outdated_versions` is applied here and only by the first check of a run:
 * no server of this run has been started from an older folder then, and one application at a
 * time uses a profile. A release that appears later in the run leaves the older folder in
 * place until the next run. */
export function kotlinServerForRun(options: KotlinServerOptions): ReturnType<typeof ensureKotlinServer> {
  const work = path.resolve(options.work);
  let run = runs.get(work);
  if (run && Date.now() - run.at > kotlinSourceLimits.recheck) { runs.delete(work); run = undefined; }
  if (!run) {
    const first = !used.has(work), listeners = new Set<KotlinProgress>();
    used.add(work);
    const found = ensureKotlinServer({ ...options, work, progress: (received, total) => { for (const listener of listeners) listener(received, total); } }).then(async server => {
      if (first) await removeOutdatedKotlinServers(work, path.basename(server.folder)).catch(() => {});
      return server;
    });
    const started = run = { found, listeners, at: Date.now() };
    runs.set(work, started);
    found.catch(() => { if (runs.get(work) === started) runs.delete(work); });
  }
  const { found, listeners } = run, listener = options.progress;
  if (!listener) return found;
  listeners.add(listener);
  return found.finally(() => listeners.delete(listener));
}
export function forgetKotlinServer(work: string): void { runs.delete(path.resolve(work)); }
