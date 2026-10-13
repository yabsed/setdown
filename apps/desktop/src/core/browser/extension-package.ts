import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/** Pure parsing for installable extension packages: unpacked manifests,
 * ZIP archives and CRX files. No filesystem or host APIs live here. */

export const MAX_ARCHIVE_ENTRIES = 10_000;
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 100 * 1024 * 1024;

export type ExtensionManifestInfo = {
  name: string;
  version: string;
  description: string;
  manifestVersion: number;
  permissions: string[];
  hostPermissions: string[];
  popupPath?: string;
  optionsPath?: string;
  key?: string;
};

export type ArchiveEntry = { name: string; data: Buffer };

const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];

/** Chrome derives an extension ID from the DER public key in `key`:
 * SHA-256 of the key bytes, first 16 bytes mapped from hex to a-p. */
export function extensionIdFromKey(key: string): string | undefined {
  try {
    const der = Buffer.from(key.replace(/\s+/g, ''), 'base64');
    if (der.length < 16) return undefined;
    const digest = createHash('sha256').update(der).digest();
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += String.fromCharCode(97 + (digest[i] >> 4)) + String.fromCharCode(97 + (digest[i] & 15));
    }
    return id;
  } catch { return undefined; }
}

/** Deterministic install directory for a package without a signing key. */
export function localExtensionDir(info: Pick<ExtensionManifestInfo, 'name'>): string {
  const slug = info.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'extension';
  return `local-${slug}-${createHash('sha256').update(info.name).digest('hex').slice(0, 8)}`;
}

function localized(value: string | undefined, messages: Record<string, { message?: unknown }> | undefined): string {
  if (!value) return '';
  const match = /^__MSG_(.+)__$/.exec(value);
  if (!match || !messages) return value;
  const message = messages[match[1]]?.message;
  return typeof message === 'string' && message ? message : value;
}

export function parseExtensionManifest(raw: unknown, messages?: Record<string, { message?: unknown }>): ExtensionManifestInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('The extension manifest is not a JSON object.');
  const manifest = raw as Record<string, unknown>;
  const manifestVersion = manifest.manifest_version;
  if (manifestVersion !== 2 && manifestVersion !== 3) throw Error('Only Manifest V2 and V3 extensions are supported.');
  const name = localized(text(manifest.name), messages);
  if (!name) throw Error('The extension manifest has no name.');
  const version = text(manifest.version);
  if (!version) throw Error('The extension manifest has no version.');
  const action = (manifestVersion === 3 ? manifest.action : manifest.browser_action) as Record<string, unknown> | undefined;
  const optionsUi = manifest.options_ui as Record<string, unknown> | undefined;
  const hostPermissions = [...stringList(manifest.host_permissions)];
  const permissions = stringList(manifest.permissions).filter(item => {
    if (/^(?:\*|[\w-]+):\/\//.test(item) || item === '<all_urls>') { hostPermissions.push(item); return false; }
    return true;
  });
  return {
    name,
    version,
    description: localized(text(manifest.description), messages),
    manifestVersion,
    permissions,
    hostPermissions: [...new Set(hostPermissions)],
    popupPath: action ? text(action.default_popup) : undefined,
    optionsPath: text(optionsUi?.page) ?? text(manifest.options_page),
    key: text(manifest.key),
  };
}

/** Bullet lines for the native install confirmation. A native message box
 * sizes itself to its text, so a manifest with hundreds of host permissions
 * (Bypass Paywalls Clean lists ~970 sites) must never render in full: the
 * oversized GTK/Wayland surface fails to allocate and the install hangs. */
export function permissionSummaryLines(info: Pick<ExtensionManifestInfo, 'permissions' | 'hostPermissions'>, limit = 12): string[] {
  const clip = (value: string) => value.length > 80 ? `${value.slice(0, 79)}…` : value;
  const all = [...info.permissions.map(item => `• ${clip(item)}`),
    ...info.hostPermissions.map(item => `• Access to ${clip(item)}`)];
  if (all.length <= limit) return all;
  return [...all.slice(0, limit), `• …and ${all.length - limit} more`];
}

/** Returns the byte offset where the ZIP payload of a CRX file starts. */
export function crxZipOffset(bytes: Buffer): number {
  if (bytes.length < 16 || bytes.toString('latin1', 0, 4) !== 'Cr24') throw Error('Not a CRX file.');
  const version = bytes.readUInt32LE(4);
  if (version === 3) {
    const headerSize = bytes.readUInt32LE(8);
    if (16 + headerSize > bytes.length) throw Error('The CRX header is truncated.');
    return 16 + headerSize;
  }
  if (version === 2) {
    const keySize = bytes.readUInt32LE(8), signatureSize = bytes.readUInt32LE(12);
    const offset = 16 + keySize + signatureSize;
    if (offset > bytes.length) throw Error('The CRX header is truncated.');
    return offset;
  }
  throw Error(`Unsupported CRX version ${version}.`);
}

function safeEntryName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return '';
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
    || normalized.split('/').some(part => part === '..' || part === '')) {
    throw Error(`The archive contains an unsafe path: ${name}`);
  }
  return normalized;
}

/** Extracts a ZIP archive (stored or deflated entries) in memory. */
export function unzipArchive(bytes: Buffer): ArchiveEntry[] {
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 65_558);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw Error('Not a ZIP archive.');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ARCHIVE_ENTRIES) throw Error('The archive has too many files.');
  const entries: ArchiveEntry[] = [];
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('The ZIP directory is damaged.');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = safeEntryName(bytes.toString('utf8', offset + 46, offset + 46 + nameSize));
    offset += 46 + nameSize + extraSize + commentSize;
    if (!name) continue;
    if (size > MAX_ENTRY_BYTES) throw Error(`The archive entry is too large: ${name}`);
    total += size;
    if (total > MAX_ARCHIVE_BYTES) throw Error('The archive is too large when extracted.');
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw Error('The ZIP directory is damaged.');
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw Error('The ZIP archive is truncated.');
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw Error(`Unsupported ZIP compression method ${method}.`);
    if (data.length !== size) throw Error(`The ZIP entry size does not match: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

/** Accepts a ZIP or CRX payload and returns its entries. */
export function unpackExtensionArchive(bytes: Buffer): ArchiveEntry[] {
  if (bytes.length >= 4 && bytes.toString('latin1', 0, 4) === 'Cr24') {
    return unzipArchive(bytes.subarray(crxZipOffset(bytes)));
  }
  return unzipArchive(bytes);
}

/** Finds `manifest.json` at the archive root or inside one wrapping folder. */
export function manifestRoot(names: string[]): string {
  if (names.includes('manifest.json')) return '';
  const roots = new Set<string>();
  for (const name of names) {
    const slash = name.indexOf('/');
    if (slash > 0 && name.slice(slash + 1) === 'manifest.json') roots.add(name.slice(0, slash + 1));
  }
  if (roots.size === 1) return [...roots][0];
  throw Error('The archive does not contain a manifest.json at its root.');
}

export function parseManifestEntries(entries: ArchiveEntry[]): { root: string; info: ExtensionManifestInfo } {
  const root = manifestRoot(entries.map(entry => entry.name));
  const manifestEntry = entries.find(entry => entry.name === `${root}manifest.json`)!;
  let raw: unknown;
  try { raw = JSON.parse(manifestEntry.data.toString('utf8')); } catch { throw Error('The extension manifest is not valid JSON.'); }
  let messages: Record<string, { message?: unknown }> | undefined;
  const locale = raw && typeof raw === 'object' ? text((raw as Record<string, unknown>).default_locale) : undefined;
  if (locale) {
    const entry = entries.find(item => item.name === `${root}_locales/${locale}/messages.json`);
    if (entry) try { messages = JSON.parse(entry.data.toString('utf8')) as typeof messages; } catch { messages = undefined; }
  }
  return { root, info: parseExtensionManifest(raw, messages) };
}
