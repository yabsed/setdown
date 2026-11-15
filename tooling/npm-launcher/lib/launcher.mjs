import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export const executableNames = { linux: 'setdown', win32: 'Setdown.exe' };
const DAY = 24 * 60 * 60 * 1000;

/** Where downloaded app versions live. The app can always be downloaded again,
 * so it is a cache; it never shares a directory with a system installation. */
export function installRoot(platform, env, home) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const absolute = value => (value && paths.isAbsolute(value) ? value : null);
  const base = platform === 'win32'
    ? absolute(env.LOCALAPPDATA) ?? paths.join(home, 'AppData', 'Local')
    : absolute(env.XDG_CACHE_HOME) ?? paths.join(home, '.cache');
  return paths.join(base, 'setdown-npm');
}

/** The archive for this machine. A mirror may replace the download location,
 * but never the checksum recorded in this package. */
export function selectAsset(release, platform, arch, env = {}) {
  const asset = release.assets?.[`${platform}-${arch}`];
  if (!asset) {
    const supported = Object.keys(release.assets ?? {}).join(', ') || 'none';
    throw Error(`Setdown ${release.version} has no build for ${platform}-${arch} (available: ${supported}).`);
  }
  const base = env.SETDOWN_DOWNLOAD_BASE_URL || release.baseUrl;
  return { ...asset, url: new URL(asset.file, base.endsWith('/') ? base : `${base}/`).href };
}

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

/** Archives hold the app either at their root (zip) or in one folder (tar.gz). */
export function findExecutable(directory, name) {
  if (isFile(path.join(directory, name))) return path.join(directory, name);
  let folders;
  try { folders = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()); } catch { return null; }
  const nested = folders.length === 1 ? path.join(directory, folders[0].name, name) : null;
  return nested && isFile(nested) ? nested : null;
}

/** Not fetch(): on Node 22 it aborts the whole process with an internal
 * assertion when an HTTP/1.0 server (a simple mirror) closes the connection
 * while a large body is still being written to disk. */
function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { headers: { 'user-agent': 'setdown-npm-launcher' } }, response => {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        if (!redirects) reject(Error(`Too many redirects: ${url}`));
        else resolve(get(new URL(headers.location, url).href, redirects - 1));
      } else if (statusCode !== 200) {
        response.resume();
        reject(Error(`Download failed (HTTP ${statusCode}): ${url}`));
      } else resolve(response);
    }).on('error', error => reject(Error(`Could not reach ${url}: ${error.message}`)));
  });
}

async function download(asset, destination, log) {
  const response = await get(asset.url);
  const total = Number(response.headers['content-length']) || 0;
  const megabytes = bytes => `${Math.round(bytes / 1048576)} MB`;
  const hash = createHash('sha256');
  let received = 0, shown = 0;
  await pipeline(response, async function* (chunks) {
    for await (const chunk of chunks) {
      hash.update(chunk);
      received += chunk.length;
      if (log.isTTY && Date.now() - shown >= 200) {
        shown = Date.now();
        log.write(`\r  ${megabytes(received)}${total ? ` of ${megabytes(total)}` : ''}  `);
      }
      yield chunk;
    }
  }, createWriteStream(destination));
  if (log.isTTY) log.write(`\r  ${megabytes(received)} downloaded.      \n`);
  const actual = hash.digest('hex');
  if (actual !== asset.sha256) {
    throw Error(`Checksum mismatch for ${asset.file}; nothing was installed.\n  expected ${asset.sha256}\n  received ${actual}`);
  }
}

function extract(archive, directory, platform, env) {
  // Windows ships bsdtar, which reads zip. Name it explicitly: a GNU tar found
  // earlier on PATH (Git Bash, MSYS) cannot.
  const tar = platform === 'win32' ? path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const result = spawnSync(tar, ['-xf', archive, '-C', directory], { stdio: ['ignore', 2, 2] });
  if (result.error) throw Error(`Could not run ${tar}: ${result.error.message}`);
  if (result.status !== 0) throw Error(`Could not unpack ${path.basename(archive)} (tar exited with ${result.status ?? result.signal}).`);
}

function runningFrom(directory) {
  let prefix;
  try { prefix = realpathSync(directory) + path.sep; } catch { return false; }
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { if (readlinkSync(`/proc/${pid}/exe`).startsWith(prefix)) return true; } catch { /* exited, or another user's */ }
  }
  return false;
}

/** Each version is well over a gigabyte unpacked, so remove the ones an update
 * replaced, but never one that is still running, and nothing this launcher did
 * not put here. */
export function pruneOtherVersions(root, keep, platform) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep) continue;
    const directory = path.join(root, entry.name);
    try {
      const leftover = /^\.(?:incoming|trash)-\d+-[0-9a-f]{8}$/.test(entry.name);
      const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.name) && isFile(path.join(directory, executableNames[platform]));
      if (!leftover && !version) continue;
      // A recent staging directory may belong to an install in another terminal.
      if (leftover && Date.now() - statSync(directory).mtimeMs < DAY) continue;
      if (platform === 'linux' && runningFrom(directory)) continue;
      // Windows refuses to rename a directory whose files are open, which leaves
      // a running version untouched instead of half deleted.
      const trash = path.join(root, `.trash-${process.pid}-${randomBytes(4).toString('hex')}`);
      renameSync(directory, trash);
      rmSync(trash, { recursive: true, force: true });
    } catch { /* In use or not removable now; the next update tries again. */ }
  }
}

async function install(release, selected, root, platform, env, log) {
  const name = executableNames[platform];
  const target = path.join(root, release.version);
  mkdirSync(root, { recursive: true });
  const incoming = path.join(root, `.incoming-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(incoming);
  try {
    log.write(`Downloading Setdown ${release.version} (first run of this version only)...\n`);
    const archive = path.join(incoming, selected.file);
    await download(selected, archive, log);
    const unpacked = path.join(incoming, 'app');
    mkdirSync(unpacked);
    extract(archive, unpacked, platform, env);
    const staged = findExecutable(unpacked, name);
    if (!staged) throw Error(`${selected.file} does not contain ${name}.`);
    // Only a complete version ever appears under its final name.
    try { renameSync(path.dirname(staged), target); }
    catch {
      if (isFile(path.join(target, name))) return path.join(target, name); // another terminal finished first
      rmSync(target, { recursive: true, force: true });
      renameSync(path.dirname(staged), target);
    }
  } finally {
    rmSync(incoming, { recursive: true, force: true });
  }
  pruneOtherVersions(root, release.version, platform);
  return path.join(target, name);
}

function run(executable, args, env) {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = env;
  const child = spawn(executable, args, { env: environment, stdio: 'inherit' });
  // Stay in the foreground like the app itself, and pass shutdown on to it.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(`setdown: could not start ${executable}: ${error.message}`); process.exit(1); });
  child.once('close', (code, signal) => process.exit(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
}

function readRelease() {
  try { return JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8')); }
  catch { throw Error('this copy has no release information. Install the published package: npm install -g setdown'); }
}

export async function main(args, { env = process.env, platform = process.platform, arch = process.arch, log = process.stderr } = {}) {
  const release = readRelease();
  const selected = selectAsset(release, platform, arch, env);
  const root = installRoot(platform, env, os.homedir());
  const installed = path.join(root, release.version, executableNames[platform]);
  run(isFile(installed) ? installed : await install(release, selected, root, platform, env, log), args, env);
}
