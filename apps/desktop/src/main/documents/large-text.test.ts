import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { MAX_TEXT_FILE_BYTES } from '../../core/document/text-codec';
import type { DocumentSnapshot } from '../../core/document/document';
import type { WindowState } from '../windows/window-state';
import { DocumentManager } from './document-manager';
import { LargeTextRead, LargeTextSessions, TextPieces } from './large-text';

const electron = vi.hoisted(() => ({ save: vi.fn(), message: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, clipboard: {},
  dialog: { showSaveDialog: electron.save, showMessageBox: electron.message }, shell: {} }));

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function temp() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-large-')); roots.push(root); return root; }
const state = () => ({ currentDocument: null, rendererTabs: [], window: { webContents: { send: vi.fn() } } }) as unknown as WindowState;

/** A JSON Lines file just past the whole-text limit: records of mixed length with Hangul and an emoji. */
function transcript(eol = '\n'): string {
  const lines: string[] = [];
  for (let size = 0, index = 0; size <= MAX_TEXT_FILE_BYTES; index++) {
    const line = JSON.stringify({ index, text: '기록 🙂 '.repeat(1 + index % 4000) });
    lines.push(line); size += Buffer.byteLength(line) + eol.length;
  }
  return lines.join(eol) + eol;
}
async function readAll(file: string) {
  const read = await LargeTextRead.open(file), pieces: string[] = [];
  try {
    for (;;) {
      const piece = await read.next();
      if ('end' in piece) return { pieces, end: piece.end };
      pieces.push(piece.text);
    }
  } finally { await read.close(); }
}
/** The main-process half of a save, fed the way a window feeds it. */
async function save(manager: DocumentManager, owner: WindowState, document: DocumentSnapshot, text: string[], mode = {}) {
  const pieces = new TextPieces();
  const result = manager.saveLarge(owner, document, 1, pieces, mode).finally(() => pieces.close());
  result.catch(() => {});
  for (const piece of text) if (!await pieces.push(piece)) break;
  pieces.end();
  return result;
}

for (const eol of ['\n', '\r\n']) test(`a file past the whole-text limit is described, read in pieces and saved back byte for byte (${eol === '\n' ? 'LF' : 'CRLF'})`, async () => {
  const root = await temp(), file = path.join(root, 'session.jsonl'), text = transcript(eol);
  await fs.writeFile(file, text);
  const manager = new DocumentManager(() => {}), snapshot = await manager.read(file);
  expect(snapshot).toMatchObject({ text: '', savedText: '', large: { bytes: Buffer.byteLength(text) }, isUntitled: false });

  const { pieces, end } = await readAll(file);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.join('') === text).toBe(true);
  expect(end).toMatchObject({ encoding: 'utf8', eol: eol === '\n' ? 'lf' : 'crlf', lines: text.split(eol).length });
  expect(end.diskVersion).toEqual(snapshot.diskVersion);

  const edited = [`{"added":"첫 줄"}${eol}`, ...pieces];
  const result = await save(manager, state(), { ...snapshot, ...end }, edited);
  expect(result.canceled).toBe(false);
  expect(result.document).toMatchObject({ text: '', savedText: '', eol: end.eol, revision: 1, savedRevision: 1,
    large: { bytes: Buffer.byteLength(edited.join('')) } });
  expect(await fs.readFile(file, 'utf8') === edited.join('')).toBe(true);
  expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

test('a byte order mark is kept, also by a document emptied before saving', async () => {
  const root = await temp(), file = path.join(root, 'marked.log'), text = transcript();
  await fs.writeFile(file, `﻿${text}`);
  const manager = new DocumentManager(() => {}), snapshot = await manager.read(file), { pieces, end } = await readAll(file);
  expect(end.encoding).toBe('utf8-bom');
  expect(pieces[0].startsWith('﻿')).toBe(false);
  await save(manager, state(), { ...snapshot, ...end }, pieces);
  expect((await fs.readFile(file)).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const saved = await manager.read(file), reread = await readAll(file);
  await save(manager, state(), { ...saved, ...reread.end }, []);
  expect(await fs.readFile(file)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
});

test('what the whole-text reader refuses is refused in pieces, and the file is left alone', async () => {
  const root = await temp(), manager = new DocumentManager(() => {});
  for (const [name, damage] of [['binary.txt', Buffer.from([0])], ['invalid.txt', Buffer.from([0xc3, 0x28])],
    ['mixed.txt', Buffer.from('a\r\nb\n')], ['control.txt', Buffer.from([1])]] as const) {
    const file = path.join(root, name), bytes = Buffer.concat([Buffer.from(transcript()), damage]);
    await fs.writeFile(file, bytes);
    expect((await manager.read(file)).large).toBeDefined();
    await expect(readAll(file), name).rejects.toThrow();
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
  }
  const image = path.join(root, 'picture.png');
  await fs.writeFile(image, transcript());
  await expect(LargeTextRead.open(image)).rejects.toThrow(/binary/);
});

test('a save that fails or is refused leaves the file as it was', async () => {
  const root = await temp(), file = path.join(root, 'session.jsonl'), text = transcript();
  await fs.writeFile(file, text);
  const manager = new DocumentManager(() => {}), snapshot = await manager.read(file), { pieces, end } = await readAll(file);
  const document = { ...snapshot, ...end };
  const unchanged = async () => {
    expect(await fs.readFile(file, 'utf8') === text).toBe(true);
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  };

  // The window gave up half way.
  const abandoned = new TextPieces(), failing = manager.saveLarge(state(), document, 1, abandoned).finally(() => abandoned.close());
  failing.catch(() => {});
  await abandoned.push(pieces[0]);
  abandoned.fail(new Error('The window stopped sending the document.'));
  await expect(failing).rejects.toThrow(/stopped sending/);
  await unchanged();

  // Text that could not be opened again.
  await expect(save(manager, state(), document, [...pieces, 'bare\rCR'])).rejects.toThrow(/Bare CR/);
  await unchanged();

  // The whole-text save would write the snapshot's empty text over the file.
  await expect(manager.saveSnapshot(state(), document, '', 1)).rejects.toThrow(/in pieces/);
  await unchanged();

  // Changed by another program: auto save steps aside without asking and takes no piece.
  await fs.appendFile(file, '{"external":true}\n');
  const sent = new TextPieces(), auto = manager.saveLarge(state(), document, 1, sent, { auto: true }).finally(() => sent.close());
  expect(await auto).toEqual({ canceled: true });
  expect(await sent.push(pieces[0])).toBe(false);
  expect(electron.message).not.toHaveBeenCalled();
  expect(await fs.readFile(file, 'utf8') === `${text}{"external":true}\n`).toBe(true);
});

test('Save As writes the text to another text file and refuses a file that would be opened whole', async () => {
  const root = await temp(), file = path.join(root, 'session.jsonl'), copy = path.join(root, 'copy.jsonl'), text = transcript();
  await fs.writeFile(file, text);
  const manager = new DocumentManager(() => {}), snapshot = await manager.read(file), { pieces, end } = await readAll(file);
  const document = { ...snapshot, ...end }, added = '{"added":"사본"}\n';

  electron.save.mockResolvedValueOnce({ canceled: false, filePath: copy });
  const result = await save(manager, state(), document, [added, ...pieces], { saveAs: true });
  expect(result.document).toMatchObject({ path: copy, name: 'copy.jsonl', text: '', savedText: '', isUntitled: false,
    large: { bytes: Buffer.byteLength(added + text) } });
  expect(await fs.readFile(copy, 'utf8') === added + text).toBe(true);
  expect(await fs.readFile(file, 'utf8') === text).toBe(true);

  electron.save.mockResolvedValueOnce({ canceled: true });
  expect(await save(manager, state(), document, pieces, { saveAs: true })).toEqual({ canceled: true });

  for (const [name, reason] of [['notes.md', /Markdown or as a notebook/], ['book.ipynb', /Markdown or as a notebook/], ['picture.png', /binary format/]] as const) {
    electron.save.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, name) });
    await expect(save(manager, state(), document, pieces, { saveAs: true })).rejects.toThrow(reason);
  }
  expect((await fs.readdir(root)).sort()).toEqual(['copy.jsonl', 'session.jsonl']);
});

test('pieces wait for the writer, and a reader that stops releases the sender', async () => {
  const pieces = new TextPieces(), taken: string[] = [];
  const reading = (async () => { for await (const piece of pieces) { taken.push(piece); if (piece === 'stop') break; } })();
  let second = false;
  const first = pieces.push('one');
  void pieces.push('two').then(() => { second = true; });
  expect(await first).toBe(true);
  // The second piece is taken only when the writer comes back for it.
  await vi.waitFor(() => expect(second).toBe(true));
  expect(await pieces.push('stop')).toBe(true);
  await reading;
  expect(await pieces.push('late')).toBe(false);
  expect(taken).toEqual(['one', 'two', 'stop']);
});

test('a transfer belongs to the window that opened it and ends with that window', () => {
  const abandoned: string[] = [], sessions = new LargeTextSessions<string>(value => abandoned.push(value));
  const mine = sessions.add(1, 'mine'), other = sessions.add(2, 'other');
  expect(sessions.use(1, mine)).toBe('mine');
  expect(() => sessions.use(2, mine)).toThrow(/no longer open/);
  expect(sessions.forget(2, mine)).toBeUndefined();
  sessions.releaseOwner(2);
  expect(abandoned).toEqual(['other']);
  expect(() => sessions.use(2, other)).toThrow(/no longer open/);
  expect(sessions.forget(1, mine)).toBe('mine');
  expect(abandoned).toEqual(['other']);
});
