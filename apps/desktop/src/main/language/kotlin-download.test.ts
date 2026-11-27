import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareKotlinBuilds, ensureKotlinServer, forgetKotlinServer, installedKotlinServers, kotlinBundleFile, kotlinBundleRelease, KotlinChecksumError, kotlinDownloadLimits, kotlinExtensionUrl, kotlinLauncher, kotlinRelease, kotlinReleasesUrl, kotlinServerForRun, kotlinSourceLimits, removeOutdatedKotlinServers, zipEntry, type KotlinServerOptions } from './kotlin-download';
import { deflateRawSync } from 'node:zlib';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-kotlin-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const version = '271.2085.0', published = `https://download.jetbrains.com/language-server/kotlin-server/${version}`;
const archiveUrl = `${published}/kotlin-server-${version}.tar.gz`, archiveName = `kotlin-server-${version}.tar.gz`;
const link = (label: string, url: string) => `  * [Download for ${label}](${url})&nbsp;&nbsp;|&nbsp;&nbsp;[SHA-256 checksum](${url}.sha256)`;
/** RELEASES.md as JetBrains writes it, cut down to what is read. */
const releases = ['### Kotlin LSP and VSC extension releases', '', `### v${version}`, '- :test_tube: "Kotlin by JetBrains" extension v0.0.86 for VS Code',
  '  The extension is also available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JetBrains.kotlin-server).',
  link('Linux-x64', `${published}/kotlin-server-0.0.86-linux-amd64.vsix`), '- :card_index_dividers: **Standalone Kotlin LSP Archive**', link('Linux-x64', archiveUrl),
  '##### Changelog', '#### 🐛 Bug fixes', '### v263.7084.0', link('Linux-x64', 'https://download.jetbrains.com/language-server/kotlin-server/263.7084.0/kotlin-server-263.7084.0.tar.gz'), ''].join('\n');
const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const content = 'the bytes of the archive';

type Asked = { url: string; range?: string };
/** A `fetch` that has the release list and the checksum JetBrains would publish for `content`,
 * in the form of the real file, and answers a request for the archive with `archive`. */
function publisher(archive: (asked: Asked) => Response | Promise<Response>, checksum: string | Response = `${digest(content)} *${archiveName}`) {
  const asked: Asked[] = [];
  const fetcher = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = { url: String(input), range: new Headers(init?.headers).get('range') ?? undefined };
    // The registry of JetBrains' extension does not answer here: these tests are about a listed build.
    if (request.url.startsWith(kotlinExtensionUrl)) return new Response('not found', { status: 404 });
    asked.push(request);
    if (request.url === kotlinReleasesUrl) return new Response(releases);
    if (request.url === `${archiveUrl}.sha256`) return typeof checksum === 'string' ? new Response(checksum) : checksum;
    return request.url === archiveUrl ? archive(request) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetcher, asked, archives: () => asked.filter(request => request.url === archiveUrl) };
}
const whole = () => new Response(content, { headers: { 'content-length': String(content.length) } });
/** A connection that delivers `first` and then goes quiet without closing. */
const stalled = (first: string) => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(first)); } }), { headers: { 'content-length': String(content.length) } });

const work = () => path.join(directory, 'work');
const folder = () => path.join(work(), `kotlin-lsp-${version}`);
const launcher = () => path.join(folder(), `kotlin-server-${version}`, 'bin', 'intellij-server');
const partial = () => path.join(work(), 'server-downloads', version, archiveName);
const lock = () => path.join(work(), 'server-downloads', `${version}.lock`);
/** What `tar` makes of the Linux archive: one folder named after the release. The program is given the archive's bytes, to show what was unpacked. */
const unpack = async (archive: string, into: string) => {
  await mkdir(path.join(into, `kotlin-server-${version}`, 'bin'), { recursive: true });
  await writeFile(path.join(into, `kotlin-server-${version}`, 'bin', 'intellij-server'), await readFile(archive));
};
const options = (server: { fetch: typeof fetch }, more: Partial<KotlinServerOptions> = {}): KotlinServerOptions => ({ work: work(), fetch: server.fetch, platform: 'linux', arch: 'x64', unpack, ...more });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Nothing of an attempt is left where the extension, or the next attempt, would trip over it. */
async function expectNothingInstalled(): Promise<void> {
  expect(existsSync(folder())).toBe(false);
  expect(existsSync(lock())).toBe(false);
  expect((await readdir(path.join(work(), 'server-downloads', version)).catch(() => [] as string[])).filter(name => name !== archiveName)).toEqual([]);
}

test('the newest release is the first version heading, and its archive is named after the platform', () => {
  expect(kotlinRelease(releases, 'linux', 'x64')).toEqual({ version, url: archiveUrl, checksumUrl: `${archiveUrl}.sha256`, folder: `kotlin-lsp-${version}` });
  expect(kotlinRelease(releases.replaceAll('\n', '\r\n'), 'linux', 'x64')?.url).toBe(archiveUrl);
  const names = ([['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64'], ['win32', 'arm64']] as const).map(([platform, arch]) => kotlinRelease(releases, platform, arch)?.url.slice(published.length));
  expect(names).toEqual([`/${archiveName}`, `/kotlin-server-${version}-aarch64.tar.gz`, `/kotlin-server-${version}.sit`, `/kotlin-server-${version}-aarch64.sit`, `/kotlin-server-${version}.win.zip`, `/kotlin-server-${version}-aarch64.win.zip`]);
  // The extension has no server for 32-bit x86, and knows three systems.
  expect([kotlinRelease(releases, 'linux', 'ia32'), kotlinRelease(releases, 'win32', 'arm'), kotlinRelease(releases, 'freebsd', 'x64')]).toEqual([undefined, undefined, undefined]);
  expect([kotlinRelease('', 'linux', 'x64'), kotlinRelease('### Kotlin LSP and VSC extension releases\n## v1.0\n', 'linux', 'x64'), kotlinRelease('### v\n', 'linux', 'x64')]).toEqual([undefined, undefined, undefined]);
  // A version is a folder name. One that would lead out of the work folder is no release.
  expect([kotlinRelease('### v../../outside\n', 'linux', 'x64'), kotlinRelease('### v1.0/x\n', 'linux', 'x64'), kotlinRelease('### v.hidden\n', 'linux', 'x64')]).toEqual([undefined, undefined, undefined]);
  expect([kotlinLauncher('/w/kotlin-lsp-1.0', '1.0', 'linux'), kotlinLauncher('/w/kotlin-lsp-1.0', '1.0', 'darwin')]).toEqual(Array(2).fill(path.join('/w/kotlin-lsp-1.0', 'kotlin-server-1.0', 'bin', 'intellij-server')));
  expect(kotlinLauncher('/w/kotlin-lsp-1.0', '1.0', 'win32')).toBe(path.join('/w/kotlin-lsp-1.0', 'bin', 'intellij-server.exe'));
});

// kotlin_lsp.rs, test `extracts_release_with_base_url`
test('the address comes from the first jetbrains.com link of the newest section that has the version in its path', () => {
  const markdown = ['### Kotlin LSP and VSC extension releases', '', '### v263.6379.0', '- :test_tube: "Kotlin by JetBrains" extension v0.0.13 for VS Code', '',
    '  The extension is also available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JetBrains.kotlin-server) and [OpenVSX Registry](https://open-vsx.org/extension/JetBrains/kotlin-server).',
    '    * [Download for macOS-x64](https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-0.0.13-mac-amd64.vsix)&nbsp;&nbsp;|&nbsp;&nbsp;[SHA-256 checksum](https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-0.0.13-mac-amd64.vsix.sha256)',
    '', '- :card_index_dividers: **Standalone Kotlin LSP Archive**', '',
    '    * [Download for macOS-x64](https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-263.6379.0.sit)&nbsp;&nbsp;|&nbsp;&nbsp;[SHA-256 checksum](https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-263.6379.0.sit.sha256)',
    '', '### v263.4702.0', ''].join('\n');
  expect(kotlinRelease(markdown, 'darwin', 'x64')).toEqual({ version: '263.6379.0', folder: 'kotlin-lsp-263.6379.0',
    url: 'https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-263.6379.0.sit',
    checksumUrl: 'https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-263.6379.0.sit.sha256' });
  // A link to another site, to another release, or over plain HTTP is not followed; the usual address is used.
  const usual = 'https://download.jetbrains.com/language-server/kotlin-server/1.0/kotlin-server-1.0.sit';
  expect(kotlinRelease('### v1.0\n* [x](https://jetbrains.com.evil.com/1.0/kotlin-server-1.0.sit)\n', 'darwin', 'x64')?.url).toBe(usual);
  expect(kotlinRelease('### v1.0\n* [x](http://download.jetbrains.com/a/1.0/kotlin-server-1.0.sit) [y](https://download.jetbrains.com/a/0.9/k.sit) [z](not a link\n', 'darwin', 'x64')?.url).toBe(usual);
  expect(kotlinRelease('### v1.0\nno links\n### v0.9\n* [x](https://cdn.jetbrains.com/old/1.0/k.sit)\n', 'darwin', 'x64')?.url).toBe(usual);
  expect(kotlinRelease('### v1.0\n#### Notes\n* [x](https://cdn.jetbrains.com/moved/1.0/k.sit)\n', 'linux', 'arm64')?.url).toBe('https://cdn.jetbrains.com/moved/1.0/kotlin-server-1.0-aarch64.tar.gz');
});

test('a server that is not installed is downloaded, verified and put where the extension looks', async () => {
  const server = publisher(whole), progress: [number, number | undefined][] = [];
  const result = await ensureKotlinServer(options(server, { progress: (received, total) => { progress.push([received, total]); } }));
  expect(result).toEqual({ folder: folder(), version, program: launcher(), downloaded: true });
  expect(await readFile(launcher(), 'utf8')).toBe(content);
  expect(launcher()).toBe(kotlinLauncher(result.folder, result.version, 'linux'));
  if (process.platform !== 'win32') expect((await stat(launcher())).mode & 0o111).toBe(0o111);
  expect(server.asked).toEqual([{ url: kotlinReleasesUrl }, { url: `${archiveUrl}.sha256` }, { url: archiveUrl }]);
  expect([progress[0], progress.at(-1)]).toEqual([[0, content.length], [content.length, content.length]]);
  // The archive and the lock are gone, and nothing was written beside the work folder.
  expect(await readdir(path.join(work(), 'server-downloads'))).toEqual([]);
  expect((await readdir(work())).sort()).toEqual([`kotlin-lsp-${version}`, 'server-downloads']);
  expect(await readdir(directory)).toEqual(['work']);
});

test('an installed server is left alone and nothing is downloaded', async () => {
  await mkdir(path.dirname(launcher()), { recursive: true }); await writeFile(launcher(), 'installed by the extension');
  const server = publisher(whole);
  expect(await ensureKotlinServer(options(server))).toEqual({ folder: folder(), version, program: launcher(), downloaded: false });
  expect(server.asked).toEqual([{ url: kotlinReleasesUrl }]);
  expect(await readFile(launcher(), 'utf8')).toBe('installed by the extension');
  expect(await readdir(work())).toEqual([`kotlin-lsp-${version}`]);
  // The Windows archive has no folder of its own, so the program is looked for one level up.
  await mkdir(path.join(folder(), 'bin'), { recursive: true }); await writeFile(path.join(folder(), 'bin', 'intellij-server.exe'), '');
  const windows = publisher(whole);
  expect((await ensureKotlinServer(options(windows, { platform: 'win32' }))).downloaded).toBe(false);
  expect(windows.asked.length).toBe(1);
});

test('a folder without the program, as an interrupted install leaves it, is replaced', async () => {
  await mkdir(path.join(folder(), `kotlin-server-${version}`, 'lib'), { recursive: true }); await writeFile(path.join(folder(), `kotlin-server-${version}`, 'lib', 'half.jar'), '');
  expect((await ensureKotlinServer(options(publisher(whole)))).downloaded).toBe(true);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
  expect(await readdir(path.join(folder(), `kotlin-server-${version}`))).toEqual(['bin']);
  expect((await readdir(work())).sort()).toEqual([`kotlin-lsp-${version}`, 'server-downloads']);
});

// serverBundleDownload.test.ts, 'resumes a partial download with an HTTP range request'
test('an interrupted download continues from the bytes that are already there', async () => {
  await mkdir(path.dirname(partial()), { recursive: true }); await writeFile(partial(), content.slice(0, 10));
  const server = publisher(() => new Response(content.slice(10), { status: 206, headers: { 'content-length': String(content.length - 10), 'content-range': `bytes 10-${content.length - 1}/${content.length}` } }));
  const progress: [number, number | undefined][] = [];
  expect((await ensureKotlinServer(options(server, { progress: (received, total) => { progress.push([received, total]); } }))).downloaded).toBe(true);
  expect(server.archives()).toEqual([{ url: archiveUrl, range: 'bytes=10-' }]);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
  expect([progress[0], progress.at(-1)]).toEqual([[10, content.length], [content.length, content.length]]);
});

// serverBundleDownload.test.ts, 'restarts a partial download when the server ignores the range request'
test('a server that ignores the range sends the whole file, which replaces the saved part', async () => {
  const stale = 'stale bytes of another file, longer than the archive';
  await mkdir(path.dirname(partial()), { recursive: true }); await writeFile(partial(), stale);
  const server = publisher(whole);
  expect((await ensureKotlinServer(options(server))).downloaded).toBe(true);
  expect(server.archives()).toEqual([{ url: archiveUrl, range: `bytes=${stale.length}-` }]);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

test('a range the server answers with other bytes, or refuses, starts the download again', async () => {
  for (const answer of [
    () => new Response(content.slice(4), { status: 206, headers: { 'content-range': `bytes 4-${content.length - 1}/${content.length}` } }),
    () => new Response(content.slice(10), { status: 206 }),
    () => new Response(null, { status: 416, headers: { 'content-range': `bytes */${content.length}` } })]) {
    await rm(work(), { recursive: true, force: true });
    await mkdir(path.dirname(partial()), { recursive: true }); await writeFile(partial(), 'x'.repeat(10));
    const server = publisher(asked => asked.range ? answer() : whole());
    expect((await ensureKotlinServer(options(server))).downloaded).toBe(true);
    expect(server.archives()).toEqual([{ url: archiveUrl, range: 'bytes=10-' }, { url: archiveUrl }]);
    expect(await readFile(launcher(), 'utf8')).toBe(content);
  }
});

// serverBundleDownload.test.ts, 'keeps a completed download when the range starts at the end of the file'
test('a whole archive that could not be unpacked is not downloaded again', async () => {
  const first = publisher(whole);
  await expect(ensureKotlinServer(options(first, { unpack: async () => { throw new Error('tar: not found'); } }))).rejects.toThrow('tar: not found');
  await expectNothingInstalled();
  expect(await readFile(partial(), 'utf8')).toBe(content);
  // An archive that holds something else than the server is not put in place either.
  await expect(ensureKotlinServer(options(publisher(() => new Response(null, { status: 416, headers: { 'content-range': `bytes */${content.length}` } })), { unpack: async (_archive, into) => { await writeFile(path.join(into, 'README'), ''); } })))
    .rejects.toThrow(`Unpacked language server is missing its launcher: ${path.join(`kotlin-server-${version}`, 'bin', 'intellij-server')}`);
  await expectNothingInstalled();
  const second = publisher(() => new Response(null, { status: 416, headers: { 'content-range': `bytes */${content.length}` } }));
  expect((await ensureKotlinServer(options(second))).downloaded).toBe(true);
  expect(second.archives()).toEqual([{ url: archiveUrl, range: `bytes=${content.length}-` }]);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

// serverBundleDownload.test.ts, 'removes the bad archive after a checksum mismatch'
test('a download with another checksum than the published one is deleted and never unpacked', async () => {
  let unpacked = 0;
  const server = publisher(() => new Response('invalid', { headers: { 'content-length': '7' } }));
  const failure = await ensureKotlinServer(options(server, { unpack: async () => { unpacked += 1; } })).catch(error => error);
  expect(failure).toBeInstanceOf(KotlinChecksumError);
  expect(failure).toMatchObject({ name: 'KotlinChecksumError', expected: digest(content), actual: digest('invalid') });
  expect(failure.message).toBe(`Could not verify the language server download: expected SHA-256 ${digest(content)}, got ${digest('invalid')}. The downloaded file was deleted.`);
  expect([unpacked, existsSync(partial())]).toEqual([0, false]);
  await expectNothingInstalled();
  // A saved part that was damaged fails the same way, and the next attempt starts from the first byte.
  await writeFile(partial(), 'THE BYTES ');
  const resumed = publisher(asked => asked.range ? new Response(content.slice(10), { status: 206, headers: { 'content-range': `bytes 10-${content.length - 1}/${content.length}` } }) : whole());
  await expect(ensureKotlinServer(options(resumed))).rejects.toBeInstanceOf(KotlinChecksumError);
  expect(existsSync(partial())).toBe(false);
  expect((await ensureKotlinServer(options(resumed))).downloaded).toBe(true);
  expect(resumed.archives()).toEqual([{ url: archiveUrl, range: 'bytes=10-' }, { url: archiveUrl }]);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

test('without a published checksum nothing is downloaded', async () => {
  for (const [checksum, message] of [[new Response('not found', { status: 404 }), `Failed to download ${archiveUrl}.sha256: HTTP 404`], ['<html>moved</html>', `No SHA-256 checksum was found at ${archiveUrl}.sha256`],
    [digest(content).slice(1), 'No SHA-256 checksum was found'], [`${digest(content)}0`, 'No SHA-256 checksum was found']] as const) {
    const server = publisher(whole, checksum);
    await expect(ensureKotlinServer(options(server))).rejects.toThrow(message);
    expect(server.archives()).toEqual([]);
    await expectNothingInstalled();
  }
  // The file JetBrains publishes is the checksum, a space and the name; `sha256sum` writes two spaces, and upper case is the same number.
  for (const checksum of [`${digest(content)}  ${archiveName}\n`, digest(content).toUpperCase(), `${digest(content)}\r\n`]) {
    await rm(work(), { recursive: true, force: true });
    expect((await ensureKotlinServer(options(publisher(whole, checksum)))).downloaded).toBe(true);
  }
});

test('a release list or an archive that cannot be fetched is an error a person can read', async () => {
  const none = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  await expect(ensureKotlinServer(options({ fetch: none }))).rejects.toThrow(`Failed to download ${kotlinReleasesUrl}: HTTP 404`);
  const empty = (async () => new Response('# Releases\n')) as typeof fetch;
  await expect(ensureKotlinServer(options({ fetch: empty }))).rejects.toThrow(`No Kotlin language server for linux x64 was found in ${kotlinReleasesUrl}`);
  await expect(ensureKotlinServer(options(publisher(whole), { arch: 'ia32' }))).rejects.toThrow('No Kotlin language server for linux ia32');
  expect(existsSync(work())).toBe(false);
  await expect(ensureKotlinServer(options(publisher(() => new Response('busy', { status: 503 }))))).rejects.toThrow(`Failed to download ${archiveUrl}: HTTP 503`);
  await expectNothingInstalled();
});

test('two installers at once download the archive once', async () => {
  const server = publisher(async () => { await pause(50); return whole(); });
  const results = await Promise.all([ensureKotlinServer(options(server)), ensureKotlinServer(options(server))]);
  expect(results.map(result => result.downloaded).sort()).toEqual([false, true]);
  expect(server.archives().length).toBe(1);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
  expect(await readdir(path.join(work(), 'server-downloads'))).toEqual([]);
});

// serverBundleDownload.test.ts, 'waits for the active installer before discarding a partial download'
test('an installer waits behind the lock of one that is alive', async () => {
  await mkdir(lock(), { recursive: true }); await writeFile(path.join(lock(), 'owner.test.json'), JSON.stringify({ pid: process.pid }));
  const server = publisher(whole), waiting = ensureKotlinServer(options(server));
  await pause(kotlinDownloadLimits.lockRetry + 100);
  expect(server.asked).toEqual([{ url: kotlinReleasesUrl }]);
  // The other installer finishes: its server is used, and nothing is downloaded.
  await mkdir(path.dirname(launcher()), { recursive: true }); await writeFile(launcher(), 'installed by the other window');
  expect(await waiting).toEqual({ folder: folder(), version, program: launcher(), downloaded: false });
  expect(server.asked).toEqual([{ url: kotlinReleasesUrl }]);
  // The other installer gives up: the lock is free, and this one downloads.
  await rm(folder(), { recursive: true });
  const next = ensureKotlinServer(options(server));
  await pause(kotlinDownloadLimits.lockRetry + 100);
  expect(server.archives()).toEqual([]);
  await rm(lock(), { recursive: true });
  expect((await next).downloaded).toBe(true);
});

// serverBundleDownload.test.ts, 'recovers immediately when the previous extension host left its install lock'
test('a lock whose owner is gone, or has not touched it for two minutes, does not keep an installer out', async () => {
  const old = new Date(Date.now() - kotlinDownloadLimits.lockStale - 60 * 1000);
  const locks: (() => Promise<void>)[] = [
    // The process that took it has ended.
    async () => { await writeFile(path.join(lock(), 'owner.abandoned.json'), JSON.stringify({ pid: 2_147_483_647 })); },
    // The process is alive, or another one has its number, and the lock has not been touched.
    async () => { await writeFile(path.join(lock(), 'owner.asleep.json'), JSON.stringify({ pid: process.pid })); await utimes(path.join(lock(), 'owner.asleep.json'), old, old); },
    // It was taken and its owner never wrote its name.
    async () => { await utimes(lock(), old, old); },
    async () => { await writeFile(path.join(lock(), 'owner.torn.json'), '{"pid":'); await utimes(path.join(lock(), 'owner.torn.json'), old, old); }];
  for (const leave of locks) {
    await rm(work(), { recursive: true, force: true }); await mkdir(lock(), { recursive: true }); await leave();
    const started = Date.now();
    expect((await ensureKotlinServer(options(publisher(whole)))).downloaded).toBe(true);
    expect(Date.now() - started).toBeLessThan(kotlinDownloadLimits.lockStale / 100);
    expect(await readdir(path.join(work(), 'server-downloads'))).toEqual([]);
  }
});

// serverBundleDownload.test.ts, 'aborts an in-progress download' and 'removes the temporary extraction directory after cancellation'
test('a cancelled download keeps what it received, and the next one continues from there', async () => {
  const controller = new AbortController();
  const failure = await ensureKotlinServer(options(publisher(() => stalled(content.slice(0, 10))), { signal: controller.signal, progress: received => { if (received) controller.abort(); } })).catch(error => error);
  expect(failure).toMatchObject({ name: 'AbortError', message: 'Language server download cancelled' });
  expect(await readFile(partial(), 'utf8')).toBe(content.slice(0, 10));
  await expectNothingInstalled();
  const server = publisher(() => new Response(content.slice(10), { status: 206, headers: { 'content-range': `bytes 10-${content.length - 1}/${content.length}` } }));
  expect((await ensureKotlinServer(options(server))).downloaded).toBe(true);
  expect(server.archives()).toEqual([{ url: archiveUrl, range: 'bytes=10-' }]);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

test('cancelling ends the wait for the release list, for the lock and for the archive', async () => {
  const cancelled = { name: 'AbortError', message: 'Language server download cancelled' };
  const before = publisher(whole);
  await expect(ensureKotlinServer(options(before, { signal: AbortSignal.abort() }))).rejects.toMatchObject(cancelled);
  expect([before.asked, existsSync(work())]).toEqual([[], false]);
  // A `fetch` that never answers, and does not listen to the signal either.
  const silent = new AbortController(), never = (() => new Promise<Response>(() => {})) as typeof fetch;
  setTimeout(() => silent.abort(), 20);
  await expect(ensureKotlinServer(options({ fetch: never }, { signal: silent.signal }))).rejects.toMatchObject(cancelled);
  const quiet = new AbortController();
  setTimeout(() => quiet.abort(), 20);
  await expect(ensureKotlinServer(options(publisher(() => new Promise<Response>(() => {})), { signal: quiet.signal }))).rejects.toMatchObject(cancelled);
  await expectNothingInstalled();
  // Behind another installer's lock, which is left as it is.
  await mkdir(lock(), { recursive: true }); await writeFile(path.join(lock(), 'owner.test.json'), JSON.stringify({ pid: process.pid }));
  const queued = new AbortController();
  setTimeout(() => queued.abort(), 20);
  await expect(ensureKotlinServer(options(publisher(whole), { signal: queued.signal }))).rejects.toMatchObject(cancelled);
  expect(await readdir(lock())).toEqual(['owner.test.json']);
});

test('a download that stops arriving is given up, and what arrived is kept', async () => {
  await expect(ensureKotlinServer(options(publisher(() => stalled(content.slice(0, 10))), { idle: 40 }))).rejects.toThrow(`Timed out downloading ${archiveUrl}: no data received`);
  expect(await readFile(partial(), 'utf8')).toBe(content.slice(0, 10));
  await expectNothingInstalled();
  await expect(ensureKotlinServer(options(publisher(() => new Promise<Response>(() => {})), { idle: 40 }))).rejects.toThrow(`Timed out downloading ${archiveUrl}: no response received`);
  const never = (() => new Promise<Response>(() => {})) as typeof fetch;
  await expect(ensureKotlinServer(options({ fetch: never }, { idle: 40 }))).rejects.toThrow(`Timed out downloading ${kotlinReleasesUrl}: no response received`);
  // Slow is not stopped: every chunk starts the wait again, so this download may take twice the limit.
  const slow = () => new Response(new ReadableStream<Uint8Array>({ async start(controller) {
    for (const piece of content.match(/.{1,3}/g)!) { await pause(30); controller.enqueue(new TextEncoder().encode(piece)); }
    controller.close();
  } }));
  const started = Date.now();
  expect((await ensureKotlinServer(options(publisher(slow), { idle: 120 }))).downloaded).toBe(true);
  expect(Date.now() - started).toBeGreaterThan(120);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

test.skipIf(process.platform === 'win32')('the archive is unpacked with tar into the layout the extension expects', async () => {
  // The Linux archive as JetBrains packs it: everything in one folder named after the release.
  const packed = path.join(directory, 'packed'), root = path.join(packed, `kotlin-server-${version}`);
  await mkdir(path.join(root, 'bin'), { recursive: true }); await mkdir(path.join(root, 'lib'));
  await writeFile(path.join(root, 'bin', 'intellij-server'), '#!/bin/sh\n', { mode: 0o644 }); await writeFile(path.join(root, 'lib', 'app.jar'), 'jar');
  execFileSync('tar', ['-czf', path.join(directory, archiveName), '-C', packed, `kotlin-server-${version}`]);
  const bytes = await readFile(path.join(directory, archiveName));
  const server = publisher(() => new Response(bytes), `${digest(bytes)} *${archiveName}`);
  expect(await ensureKotlinServer({ work: work(), fetch: server.fetch, platform: 'linux', arch: 'x64' })).toEqual({ folder: folder(), version, program: launcher(), downloaded: true });
  expect(await readFile(launcher(), 'utf8')).toBe('#!/bin/sh\n');
  expect((await stat(launcher())).mode & 0o111).toBe(0o111);
  expect(await readFile(path.join(folder(), `kotlin-server-${version}`, 'lib', 'app.jar'), 'utf8')).toBe('jar');
  expect(await readdir(folder())).toEqual([`kotlin-server-${version}`]);
  // A file that is not an archive fails in tar, with what tar said.
  await rm(work(), { recursive: true });
  const broken = publisher(() => new Response('not an archive'), digest('not an archive'));
  await expect(ensureKotlinServer({ work: work(), fetch: broken.fetch, platform: 'linux', arch: 'x64' })).rejects.toThrow(/^tar -xzf .* failed: /);
  await expectNothingInstalled();
});

test('the folders of other releases are removed on request, and nothing else', async () => {
  for (const name of ['kotlin-lsp-263.7084.0', `kotlin-lsp-${version}`, `kotlin-lsp-${version}.incomplete.1.2`, 'kotlin-language-server-1.3.13', 'server-downloads']) await mkdir(path.join(work(), name, 'bin'), { recursive: true });
  await writeFile(path.join(work(), 'kotlin-lsp-notes.txt'), '');
  expect((await removeOutdatedKotlinServers(work(), `kotlin-lsp-${version}`)).sort()).toEqual(['kotlin-lsp-263.7084.0', `kotlin-lsp-${version}.incomplete.1.2`]);
  expect((await readdir(work())).sort()).toEqual(['kotlin-language-server-1.3.13', `kotlin-lsp-${version}`, 'kotlin-lsp-notes.txt', 'server-downloads']);
  expect(await removeOutdatedKotlinServers(path.join(directory, 'missing'), `kotlin-lsp-${version}`)).toEqual([]);
});

// What was carried over is compared with the copies in `vendor`, so a newer submodule that
// changes it fails here and not on someone's computer. The Zed extension is not in `vendor`;
// what it does with the release list is pinned through the list it reads.
const upstream = fileURLToPath(new URL('../../../../../vendor/kotlin-lsp', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'RELEASES.md')))('the newest release in vendor/kotlin-lsp parses to the archives JetBrains lists, each with its checksum', () => {
  const markdown = readFileSync(path.join(upstream, 'RELEASES.md'), 'utf8'), newest = /^### v(\S+)$/m.exec(markdown)![1];
  const section = markdown.slice(markdown.indexOf(`### v${newest}`), markdown.indexOf('\n### v', markdown.indexOf(`### v${newest}`) + 1));
  for (const [platform, arch, label, name] of [['linux', 'x64', 'Linux-x64', '.tar.gz'], ['linux', 'arm64', 'Linux-arm64', '-aarch64.tar.gz'], ['darwin', 'x64', 'macOS-x64', '.sit'],
    ['darwin', 'arm64', 'macOS-arm64', '-aarch64.sit'], ['win32', 'x64', 'Windows-x64', '.win.zip'], ['win32', 'arm64', 'Windows-arm64', '-aarch64.win.zip']] as const) {
    const release = kotlinRelease(markdown, platform, arch)!;
    expect(release).toEqual({ version: newest, folder: `kotlin-lsp-${newest}`, url: `https://download.jetbrains.com/language-server/kotlin-server/${newest}/kotlin-server-${newest}${name}`, checksumUrl: `${release.url}.sha256` });
    // The standalone archive of this platform, and the checksum JetBrains links right beside it.
    expect(section).toContain(`[Download for ${label}](${release.url})&nbsp;&nbsp;|&nbsp;&nbsp;[SHA-256 checksum](${release.checksumUrl})`);
  }
});

test.skipIf(!existsSync(path.join(upstream, 'vscode-extension-core/src/serverBundleDownload.ts')))('the copied limits and wording are the ones vendor/kotlin-lsp states', () => {
  const client = readFileSync(path.join(upstream, 'vscode-extension-core/src/serverBundleDownload.ts'), 'utf8'), recovery = readFileSync(path.join(upstream, 'vscode-extension-core/src/serverDownloadRecovery.ts'), 'utf8');
  const milliseconds = (name: string) => new RegExp(`const ${name} = (\\d+(?: \\* \\d+)*);`).exec(client)?.[1].split(' * ').map(Number).reduce((a, b) => a * b);
  expect({ lockRetry: milliseconds('INSTALL_LOCK_RETRY_DELAY_MS'), lockStale: milliseconds('INSTALL_LOCK_STALE_MS'), idle: milliseconds('DOWNLOAD_IDLE_TIMEOUT_MS') }).toEqual(kotlinDownloadLimits);
  for (const rule of ['const INSTALL_LOCK_HEARTBEAT_MS = INSTALL_LOCK_STALE_MS / 4;', '`${downloadedServerDir}.lock`', "path.join(serverRoot, 'server-downloads', metadata.version)", "path.join(downloadRoot, 'server-download-')",
    "const INSTALL_LOCK_OWNER_FILE_PREFIX = 'owner.';", "const INSTALL_LOCK_OWNER_FILE_SUFFIX = '.json';", '`${lockDir}.stale.${process.pid}.${Date.now()}`', '`${serverDir}.incomplete.${process.pid}.${Date.now()}`',
    'Range: `bytes=${existingBytes}-`', '/^bytes (\\d+)-(\\d+)\\/(\\d+)$/', '/^bytes \\*\\/(\\d+)$/', 'start === expectedStart && end >= start && total > end', '`Failed to download ${url}: HTTP ${status}`',
    '`Timed out downloading ${url}: no data received`', '`Timed out downloading ${url}: no response received`', "new Error('Language server download cancelled')", "error.name = 'AbortError'",
    '/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(metadata.version)', "os.platform() === 'win32' ? 'intellij-server.exe' : 'intellij-server'", "path.join(serverDir, 'bin', launcherName)",
    "['-xzf', archivePath, '--strip-components=1', '-C', serverDir]", "['-xf', archivePath, '-C', serverDir]", "path.join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'tar.exe')",
    '`Unsupported language server archive type: ${archivePath}`', '`Downloaded language server is missing launcher: ${downloadedLauncher}`', 'await fsp.rm(archivePath, { force: true });']) expect(client).toContain(rule);
  const words = /showErrorMessage\(\s*'([^']+)'/.exec(recovery)?.[1];
  expect(words).toBe('Could not verify the language server download');
  expect(new KotlinChecksumError('a', 'b').message.startsWith(`${words}: `)).toBe(true);
});

test('one run of the application reads the release list once, and every caller hears the one download', async () => {
  const server = publisher(whole), older = path.join(work(), 'kotlin-lsp-263.7084.0'), other = path.join(work(), 'kotlin-language-server-1.3.13');
  await mkdir(older, { recursive: true }); await mkdir(other);
  const first: number[] = [], second: number[] = [];
  const [one, two] = await Promise.all([kotlinServerForRun(options(server, { progress: received => { first.push(received); } })), kotlinServerForRun(options(server, { progress: received => { second.push(received); } }))]);
  expect(one).toEqual({ folder: folder(), version, program: launcher(), downloaded: true });
  expect(two).toBe(one);
  expect([first.at(-1), second.at(-1)]).toEqual([content.length, content.length]);
  expect(await kotlinServerForRun(options(server))).toBe(one);
  expect(server.asked.map(request => request.url)).toEqual([kotlinReleasesUrl, `${archiveUrl}.sha256`, archiveUrl]);
  // The first check of a run is when no server of the run is in use: older releases go, as
  // util.rs `remove_outdated_versions` removes them, and the extension's other server stays.
  expect((await readdir(work())).sort()).toEqual(['kotlin-language-server-1.3.13', `kotlin-lsp-${version}`, 'server-downloads']);
});

test('a later check of the same run removes nothing, because a server may be running from an older folder', async () => {
  const server = publisher(whole), older = path.join(work(), 'kotlin-lsp-263.7084.0');
  await kotlinServerForRun(options(server));
  await mkdir(older);
  // The extension could not start the server: the list is read again by the next caller.
  forgetKotlinServer(work());
  expect(await kotlinServerForRun(options(server))).toEqual({ folder: folder(), version, program: launcher(), downloaded: false });
  expect(server.asked.filter(request => request.url === kotlinReleasesUrl)).toHaveLength(2);
  expect(existsSync(older)).toBe(true);
});

test('a check that failed is made again by the next caller, and then removes nothing either', async () => {
  const server = publisher(whole), older = path.join(work(), 'kotlin-lsp-263.7084.0');
  await mkdir(older, { recursive: true });
  let reachable = false;
  const fetcher = ((input, init) => reachable ? server.fetch(input, init) : Promise.resolve(new Response('unavailable', { status: 503 }))) as typeof fetch;
  await expect(kotlinServerForRun(options({ fetch: fetcher }))).rejects.toThrow('HTTP 503');
  // The older server may have been started meanwhile, from what was installed before.
  reachable = true;
  expect((await kotlinServerForRun(options({ fetch: fetcher }))).downloaded).toBe(true);
  expect(existsSync(older)).toBe(true);
  expect(await readFile(launcher(), 'utf8')).toBe(content);
});

// ---- The newest build, asked of JetBrains' own extension as well as of the release list ----

const newer = '271.3588.0', newerUrl = `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}.tar.gz`;
/** `extension/server-bundle.json` of "Kotlin by JetBrains" 0.0.162 for each platform, as the Open VSX registry served the packages on 2026-11-27. */
const bundles = {
  'linux-x64': { url: newerUrl, version: newer, archiveName: `kotlin-server-${newer}.tar.gz`, sha256: '0232cf959ff59e138c7ce2e8665018ca4622cad1088d63aa727e5b4f6ce73717' },
  'linux-arm64': { url: `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}-aarch64.tar.gz`, version: newer, archiveName: `kotlin-server-${newer}-aarch64.tar.gz`, sha256: 'a31835754904fb6286a974bb415edbde971a19fb81646fd431601f57cf33ff52' },
  'darwin-x64': { url: `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}.sit`, version: newer, archiveName: `kotlin-server-${newer}.sit`, sha256: '75685e727b7bb0adcc9d17d9a955d108e4bf6e6c19a6ec838d97315da50cb85a' },
  'darwin-arm64': { url: `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}-aarch64.sit`, version: newer, archiveName: `kotlin-server-${newer}-aarch64.sit`, sha256: 'db72f02b4a70936133d66ffbe7540bbed1da3740ab4822dc6684edd04e51b296' },
  'win32-x64': { url: `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}.win.zip`, version: newer, archiveName: `kotlin-server-${newer}.win.zip`, sha256: 'ef08ed2c0453e34a99214e6f1185de300c83a11971ad232762cad745f37f46ec' },
  'win32-arm64': { url: `https://download.jetbrains.com/language-server/kotlin-server/${newer}/kotlin-server-${newer}-aarch64.win.zip`, version: newer, archiveName: `kotlin-server-${newer}-aarch64.win.zip`, sha256: '854479efc0dca4b79812f44259fce14933346f990cb1187e8edc3ed914590fdd' },
} as const;
/** A zip as the registry's packages are written: deflated, the sizes after the data (flag bit 3) and in the directory. */
function zipOf(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), packed = deflateRawSync(raw), file = Buffer.from(name), local = Buffer.alloc(30), entry = Buffer.alloc(46), sizes = Buffer.alloc(16);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(file.length, 26);
    sizes.writeUInt32LE(0x08074b50, 0); sizes.writeUInt32LE(packed.length, 8); sizes.writeUInt32LE(raw.length, 12);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x808, 8); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(file.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, file, packed, sizes); directory.push(entry, file);
    offset += local.length + file.length + packed.length + sizes.length;
  }
  const list = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(list.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, list, end]);
}
const packageUrl = 'https://open-vsx.org/api/JetBrains/kotlin-server/linux-x64/0.0.162/file/JetBrains.kotlin-server-0.0.162@linux-x64.vsix';
/** Both places a build is named in. `list` and `registry` say what each answers; the archive of either build is `content`. */
function sources(answer: { list?: 'down'; registry?: 'down' | 'no bundle'; extension?: string; bundle?: unknown; checksum?: string } = {}) {
  const asked: string[] = [], extension = answer.extension ?? '0.0.162', bundle = answer.bundle ?? bundles['linux-x64'];
  const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    asked.push(url);
    if (url === kotlinReleasesUrl) return answer.list === 'down' ? new Response('unavailable', { status: 503 }) : new Response(releases);
    if (url === `${kotlinExtensionUrl}/linux-x64/latest`) return answer.registry === 'down' ? new Response('unavailable', { status: 503 })
      : new Response(JSON.stringify({ version: extension, targetPlatform: 'linux-x64', files: { download: packageUrl } }));
    if (url === packageUrl) return new Response(new Uint8Array(zipOf(answer.registry === 'no bundle' ? { 'extension/package.json': '{}' } : { 'extension/package.json': '{}', [kotlinBundleFile]: JSON.stringify(bundle) })));
    if (url === `${archiveUrl}.sha256`) return new Response(`${digest(content)} *${archiveName}`);
    if (url === `${newerUrl}.sha256`) return new Response(`${answer.checksum ?? digest(content)} *kotlin-server-${newer}.tar.gz`);
    return url === archiveUrl || url === newerUrl ? whole() : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetcher, asked };
}
/** What `tar` makes of either archive: the folder is named after the release that was asked for. */
const unpackAny = async (archive: string, into: string) => {
  const release = /kotlin-server-(.+)\.tar\.gz$/.exec(path.basename(archive))![1];
  await mkdir(path.join(into, `kotlin-server-${release}`, 'bin'), { recursive: true });
  await writeFile(path.join(into, `kotlin-server-${release}`, 'bin', 'intellij-server'), await readFile(archive));
};
const newerFolder = () => path.join(work(), `kotlin-lsp-${newer}`), newerLauncher = () => path.join(newerFolder(), `kotlin-server-${newer}`, 'bin', 'intellij-server');
// The checksum the test's archive has stands in for the one of the real archive, in both statements about it.
const stated = { ...bundles['linux-x64'], sha256: digest(content) };

test("the build JetBrains' own extension runs is this platform's archive on JetBrains' server", () => {
  for (const [target, bundle] of Object.entries(bundles)) {
    const [platform, arch] = target.split('-') as [NodeJS.Platform, string];
    expect(kotlinBundleRelease(bundle, platform, arch)).toEqual({ version: newer, url: bundle.url, checksumUrl: `${bundle.url}.sha256`, folder: `kotlin-lsp-${newer}`, sha256: bundle.sha256 });
    // The same archive the Zed extension's rule names for a listed build of that number.
    expect(kotlinRelease(`### v${newer}\n`, platform, arch)!.url).toBe(bundle.url);
  }
  // Another platform's archive, another server, a version that could leave the folder, a checksum that is none.
  expect(kotlinBundleRelease(bundles['darwin-arm64'], 'linux', 'x64')).toBeUndefined();
  expect(kotlinBundleRelease({ ...bundles['linux-x64'], url: `https://jetbrains.com.evil.example/${newer}/kotlin-server-${newer}.tar.gz` }, 'linux', 'x64')).toBeUndefined();
  expect(kotlinBundleRelease({ url: 'https://download.jetbrains.com/x/kotlin-server-...tar.gz', version: '../..' }, 'linux', 'x64')).toBeUndefined();
  expect(kotlinBundleRelease({ ...bundles['linux-x64'], sha256: 'abc' }, 'linux', 'x64')).toBeUndefined();
  expect(kotlinBundleRelease(null, 'linux', 'x64')).toBeUndefined();
  expect([compareKotlinBuilds(newer, version) > 0, compareKotlinBuilds('263.7084.0', version) < 0, compareKotlinBuilds(version, version)]).toEqual([true, true, 0]);
});

test('a file is read out of a package, and what is no package holds none', () => {
  const zip = zipOf({ 'extension/package.json': '{"name":"kotlin-server"}', [kotlinBundleFile]: JSON.stringify(bundles['linux-x64']) });
  expect(JSON.parse(zipEntry(zip, kotlinBundleFile)!.toString())).toEqual(bundles['linux-x64']);
  expect(zipEntry(zip, 'extension/missing.json')).toBeUndefined();
  expect(zipEntry(zip, kotlinBundleFile, 10)).toBeUndefined();
  expect(zipEntry(Buffer.from('<html>not a package</html>'), kotlinBundleFile)).toBeUndefined();
  expect(zipEntry(zip.subarray(0, zip.length - 40), kotlinBundleFile)).toBeUndefined();
});

test('a build the release list does not name yet is installed, because the extension runs it', async () => {
  const server = sources({ bundle: stated });
  expect(await ensureKotlinServer(options(server, { unpack: unpackAny }))).toEqual({ folder: newerFolder(), version: newer, program: newerLauncher(), downloaded: true });
  expect(await readFile(newerLauncher(), 'utf8')).toBe(content);
  expect(server.asked).toEqual(expect.arrayContaining([kotlinReleasesUrl, `${kotlinExtensionUrl}/linux-x64/latest`, packageUrl, `${newerUrl}.sha256`, newerUrl]));
  // The listed, older build is not downloaded beside it.
  expect([server.asked.includes(archiveUrl), existsSync(folder())]).toEqual([false, false]);
  // The package is read once for a version of the extension: the next check asks only which version is the newest.
  const again = sources({ bundle: stated });
  expect(await ensureKotlinServer(options(again, { unpack: unpackAny }))).toMatchObject({ version: newer, downloaded: false });
  expect(again.asked.sort()).toEqual([kotlinReleasesUrl, `${kotlinExtensionUrl}/linux-x64/latest`].sort());
  // A newer extension is read again.
  const next = sources({ bundle: stated, extension: '0.0.163' });
  await ensureKotlinServer(options(next, { unpack: unpackAny }));
  expect(next.asked).toContain(packageUrl);
});

test('one place that does not answer is no obstacle while the other names a build', async () => {
  // The registry is down, or its package names no build: the listed one is installed, as before.
  for (const registry of ['down', 'no bundle'] as const) {
    const server = sources({ registry });
    expect(await ensureKotlinServer(options(server))).toMatchObject({ version, downloaded: true });
    await rm(work(), { recursive: true, force: true });
  }
  // The list is down: the build of the extension is installed.
  expect(await ensureKotlinServer(options(sources({ list: 'down', bundle: stated }), { unpack: unpackAny }))).toMatchObject({ version: newer, downloaded: true });
});

test('without a network the newest server that is already here is used, and without one there is an error to read', async () => {
  const offline = sources({ list: 'down', registry: 'down' });
  await expect(ensureKotlinServer(options(offline))).rejects.toThrow(`Failed to download ${kotlinReleasesUrl}: HTTP 503`);
  for (const release of [version, newer, '263.7084.0']) {
    await mkdir(path.join(work(), `kotlin-lsp-${release}`, `kotlin-server-${release}`, 'bin'), { recursive: true });
    await writeFile(path.join(work(), `kotlin-lsp-${release}`, `kotlin-server-${release}`, 'bin', 'intellij-server'), 'installed');
  }
  // A folder without its program, as an interrupted install leaves it, is no server.
  await mkdir(path.join(work(), 'kotlin-lsp-999.1.0'));
  expect((await installedKotlinServers(work(), 'linux')).map(found => found.version)).toEqual([newer, version, '263.7084.0']);
  expect(await ensureKotlinServer(options(offline))).toEqual({ folder: newerFolder(), version: newer, program: newerLauncher(), downloaded: false });
});

test("a build whose published checksum is not the one the extension names gives way to the listed build", async () => {
  // The extension states the real archive's checksum; the server publishes another for it.
  const server = sources({ bundle: bundles['linux-x64'] });
  expect(await ensureKotlinServer(options(server, { unpack: unpackAny }))).toMatchObject({ version, downloaded: true });
  expect([server.asked.includes(newerUrl), existsSync(newerFolder())]).toEqual([false, false]);
});

test.skipIf(!existsSync(path.join(upstream, 'vscode-extension-core/src/serverBundleDownload.ts')))("the file of the extension's package and its fields are the ones vendor/kotlin-lsp reads", () => {
  const client = readFileSync(path.join(upstream, 'vscode-extension-core/src/serverBundleDownload.ts'), 'utf8');
  for (const rule of ["export const SERVER_BUNDLE_METADATA_FILE = 'server-bundle.json';", "typeof metadata.url !== 'string'", "typeof metadata.version !== 'string'", '/^[0-9a-fA-F]{64}$/.test(metadata.sha256)']) expect(client).toContain(rule);
  expect(kotlinBundleFile).toBe('extension/server-bundle.json');
  // The release list itself says where the extension is published for editors other than VS Code.
  expect(readFileSync(path.join(upstream, 'RELEASES.md'), 'utf8')).toContain('https://open-vsx.org/extension/JetBrains/kotlin-server');
  expect(kotlinSourceLimits.extension).toBeLessThan(kotlinDownloadLimits.idle);
});
