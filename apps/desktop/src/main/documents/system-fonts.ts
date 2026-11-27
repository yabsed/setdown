import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFontFaces } from '../../core/fonts/font-file';
import { fontFamilyKey, nearestFace } from '../../core/fonts/font-match';
import { koreanFontClass, koreanLineBox, koreanStandIns } from '../../core/fonts/korean-fonts';
import type { DocxFontAnswer, DocxFontFace, DocxFontRequest } from '../../protocol/docx-edit';

/**
 * The fonts installed on this machine, for the Word engine. It lays text out from font bytes and
 * cannot see system fonts from the page, so main reads the files it names.
 *
 * A document's font name is only ever a key into the index built here from the font files' own
 * name tables; it never becomes a path. A family that is not installed gets a Korean stand-in of
 * its class when it is a Korean one (`core/fonts/korean-fonts.ts`) and no answer otherwise: the
 * engine's packaged substitutes cover those.
 */
// The engine admits no face above 64 MiB and no more than 128 MiB of faces for one document.
export const MAX_FONT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ANSWER_BYTES = 128 * 1024 * 1024;
const MAX_REQUESTS = 256, MAX_FAMILY_LENGTH = 128, MAX_FILES = 20_000, MAX_DEPTH = 5, READERS = 16;
const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

type Face = { id: string; file: string; bytes: number; index: number; weight: number; design: number; linked: boolean; italic: boolean };
type FontIndex = Map<string, Face[]>;
export type SystemFontsOptions = {
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string;
  /** Every installed font file. Replaces the platform's own listing; tests pass their fixtures. */
  files?: () => Promise<string[]>;
};

/** Where each platform keeps fonts, most specific first. */
export function fontDirectories(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') return [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'),
    path.win32.join(env.WINDIR || env.SystemRoot || 'C:\\Windows', 'Fonts')].filter((directory): directory is string => !!directory);
  if (platform === 'darwin') return [path.join(home, 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts'];
  const data = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [...new Set([path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'fonts'), path.join(home, '.fonts'),
    ...data.map(directory => path.join(directory, 'fonts'))])];
}

async function scan(directories: string[]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (FONT_FILE.test(entry.name) && found.length < MAX_FILES) found.push(child);
    }
  };
  for (const directory of directories) await walk(directory, 0);
  return found;
}

/** fontconfig knows directories a scan of the usual places misses (custom `<dir>` entries, Nix profiles). */
const fontconfigFiles = () => new Promise<string[]>(resolve => {
  execFile('fc-list', ['--format', '%{file}\n'], { timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) =>
    resolve(error ? [] : stdout.split('\n').filter(file => path.isAbsolute(file) && FONT_FILE.test(file))));
});

async function describe(file: string): Promise<(Omit<Face, 'weight' | 'design' | 'linked'> & { names: { key: string; weight: number; design: number; linked: boolean }[] })[]> {
  const info = await stat(file);
  if (!info.isFile() || info.size < 12 || info.size > MAX_FONT_FILE_BYTES) return [];
  const handle = await open(file, 'r');
  try {
    const faces = await readFontFaces(async (offset, length) => {
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    });
    const id = createHash('sha256').update(`${file}\0${info.size}\0${info.mtimeMs}`).digest('hex').slice(0, 32);
    // A variable face draws every weight from one file; the engine takes fixed faces only.
    return faces.filter(face => !face.variable).map(face => ({ id, file, bytes: info.size, index: face.index, italic: face.names[0].italic,
      names: face.names.map(name => ({ key: fontFamilyKey(name.family), weight: name.weight, design: name.design, linked: name.linked })) }));
  } finally { await handle.close(); }
}

export class SystemFonts {
  private index?: Promise<FontIndex>;
  constructor(private options: SystemFontsOptions = {}) {}

  private async list(): Promise<string[]> {
    if (this.options.files) return this.options.files();
    const platform = this.options.platform ?? process.platform, env = this.options.env ?? process.env;
    const listed = platform === 'linux' ? await fontconfigFiles() : [];
    return listed.length ? listed : scan(fontDirectories(platform, env, this.options.home ?? os.homedir()));
  }
  private async build(): Promise<FontIndex> {
    const files = [...new Set(await this.list())].sort().slice(0, MAX_FILES), index: FontIndex = new Map();
    let next = 0;
    const described: Awaited<ReturnType<typeof describe>>[] = new Array(files.length);
    await Promise.all(Array.from({ length: Math.min(READERS, files.length) }, async () => {
      while (next < files.length) { const at = next++; described[at] = await describe(files[at]).catch(() => []); }
    }));
    for (const face of described.flat()) for (const name of face.names) {
      const entry: Face = { id: face.id, file: face.file, bytes: face.bytes, index: face.index, weight: name.weight, design: name.design, linked: name.linked, italic: face.italic };
      const family = index.get(name.key) ?? [];
      const same = family.findIndex(other => other.weight === entry.weight && other.italic === entry.italic);
      // Two faces in one place of a family. The family's own regular or bold wins over a weight that happens to state
      // the same number, then the face drawn nearest that weight, then the smaller file (the same font installed twice).
      const rank = (other: Face) => [other.linked ? 0 : 1, Math.abs(other.design - other.weight), other.bytes];
      const better = (one: number[], other: number[]) => { for (let at = 0; at < one.length; at++) if (one[at] !== other[at]) return one[at] < other[at]; return false; };
      if (same < 0) family.push(entry); else if (better(rank(entry), rank(family[same]))) family[same] = entry;
      index.set(name.key, family);
    }
    return index;
  }
  /** Built on the first request and kept: fonts installed while the app runs are seen after a restart. */
  private faces(): Promise<FontIndex> { return this.index ??= this.build(); }

  async resolve(requests: readonly DocxFontRequest[], held: readonly string[]): Promise<DocxFontAnswer> {
    if (!Array.isArray(requests) || requests.length > MAX_REQUESTS || !Array.isArray(held) || held.length > 4096
      || requests.some(request => typeof request?.family !== 'string' || !request.family || request.family.length > MAX_FAMILY_LENGTH
        || !Number.isFinite(request.weight) || request.weight < 1 || request.weight > 1000 || (request.style !== 'normal' && request.style !== 'italic')))
      throw Error('Invalid font request.');
    const index = await this.faces(), faces: DocxFontFace[] = [], files = new Map<string, Face>();
    const pick = (family: Face[], wish: DocxFontRequest) => {
      const exact = nearestFace(family, wish.weight, wish.style === 'italic');
      if (exact) return { face: exact, weight: wish.weight, style: wish.style };
      // The family has no such face. Its nearest other one is stated as what it is, so the engine thickens or slants it.
      const other = nearestFace(family, wish.weight, false) ?? nearestFace(family, 400, false) ?? family[0];
      return other ? { face: other, weight: other.weight >= 600 ? 700 : 400, style: other.italic ? 'italic' as const : 'normal' as const } : null;
    };
    for (const request of requests) {
      let family = index.get(fontFamilyKey(request.family)), standIn: string | undefined;
      const kind = family?.length ? null : koreanFontClass(request.family);
      if (kind) for (const candidate of koreanStandIns(kind)) {
        family = index.get(fontFamilyKey(candidate));
        if (family?.length) { standIn = candidate; break; }
      }
      const picked = family?.length ? pick(family, request) : null;
      if (!picked || faces.some(face => face.family === request.family && face.weight === picked.weight && face.style === picked.style)) continue;
      faces.push({ family: request.family, weight: picked.weight, style: picked.style,
        ...(standIn ? { standIn, lineBox: koreanLineBox(request.family) } : {}),
        file: picked.face.id, index: picked.face.index, bytes: picked.face.bytes });
      files.set(picked.face.id, picked.face);
    }
    const known = new Set(held), sent: DocxFontAnswer['files'] = [];
    let total = 0;
    for (const [id, face] of files) {
      if (known.has(id)) continue;
      total += face.bytes;
      // A file that vanished or no longer fits leaves its faces unanswered; the engine falls back for them.
      const bytes = total <= MAX_ANSWER_BYTES ? await readFile(face.file).catch(() => null) : null;
      if (bytes && bytes.length === face.bytes) sent.push({ id, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
      else for (let at = faces.length - 1; at >= 0; at--) if (faces[at].file === id) faces.splice(at, 1);
    }
    return { faces, files: sent };
  }
}
