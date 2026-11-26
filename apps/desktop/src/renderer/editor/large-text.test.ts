import { expect, test, vi } from 'vitest';
import type { DocumentSnapshot } from '../../core/document/document';
import type { LargeTextPiece, SaveResult } from '../../protocol/desktop-api';
import { readLargeText, saveLargeText, takeLargeText } from './large-text';

const described = (path = '/logs/session.jsonl'): DocumentSnapshot => ({ path, name: 'session.jsonl', text: '', savedText: '',
  revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 1, size: 30 }, isUntitled: false, large: { bytes: 30 } });

function port(pieces: (LargeTextPiece | Error)[] = []) {
  const written: string[] = [];
  const largeText = {
    open: vi.fn(async () => ({ id: 'read', bytes: 30 })),
    read: vi.fn(async (): Promise<LargeTextPiece> => { const next = pieces.shift()!; if (next instanceof Error) throw next; return next; }),
    close: vi.fn(),
    save: vi.fn(async () => 'save'),
    write: vi.fn(async (_id: string, text: string) => { written.push(text); return true; }),
    finish: vi.fn(async (): Promise<SaveResult> => ({ canceled: false })),
  };
  return { largeText, written };
}
const pulled = (runs: string[]) => { let next = 0; return { read: () => next < runs.length ? runs[next++] : null }; };

test('a described large file is read in pieces that its editor takes once', async () => {
  const { largeText } = port([{ text: '{"a":1}\r\n' }, { text: '{"b":"한글"}\r\n' },
    { end: { encoding: 'utf8-bom', eol: 'crlf', lines: 3, diskVersion: { mtimeMs: 2, size: 31 } } }]);
  const read = await readLargeText({ largeText }, described());
  // The snapshot carries what the read found and no text: the text is only ever in the editor model.
  expect(read).toMatchObject({ text: '', savedText: '', encoding: 'utf8-bom', eol: 'crlf', diskVersion: { mtimeMs: 2, size: 31 }, large: { bytes: 31, lines: 3 } });
  expect(takeLargeText(read)).toEqual(['{"a":1}\r\n', '{"b":"한글"}\r\n']);
  expect(takeLargeText(read)).toBeUndefined();
  expect(largeText.close).not.toHaveBeenCalled();
});

test('a copy of the snapshot still leads to its text, and any other snapshot is left alone', async () => {
  const { largeText } = port([{ text: 'one\n' }, { end: { encoding: 'utf8', eol: 'lf', lines: 2, diskVersion: { mtimeMs: 2, size: 4 } } }]);
  const read = await readLargeText({ largeText }, described());
  expect(takeLargeText({ ...read, name: 'renamed' })).toEqual(['one\n']);
  const small = { ...described(), text: 'small', savedText: 'small', large: undefined };
  expect(await readLargeText({ largeText }, small)).toBe(small);
  expect(takeLargeText(small)).toBeUndefined();
  expect(largeText.open).toHaveBeenCalledTimes(1);
});

test('a refused read ends its session and leaves no text behind', async () => {
  const { largeText } = port([{ text: 'one\n' }, new Error('This file is not valid UTF-8 text.')]);
  await expect(readLargeText({ largeText }, described())).rejects.toThrow('not valid UTF-8');
  expect(largeText.close).toHaveBeenCalledWith('read');
});

test('a save gathers the short runs a model hands over into pieces and keeps their order', async () => {
  const { largeText, written } = port();
  const line = `${'x'.repeat(999)}\n`, runs = [...Array.from({ length: 2500 }, () => line), 'tail'];
  const request = { document: described(), revision: 4 };
  expect(await saveLargeText({ largeText }, request, pulled(runs))).toEqual({ canceled: false });
  expect(largeText.save).toHaveBeenCalledWith(request);
  expect(written.join('')).toBe(runs.join(''));
  // 2.5 million characters in pieces of at least 1 MiB: two full pieces and the rest.
  expect(written.map(piece => piece.length)).toEqual([1049000, 1049000, 402004]);
  expect(largeText.finish).toHaveBeenCalledWith('save');
});

test('an empty document is saved as an empty file', async () => {
  const { largeText, written } = port();
  await saveLargeText({ largeText }, { document: described(), revision: 1 }, pulled([]));
  expect(written).toEqual([]);
  expect(largeText.finish).toHaveBeenCalledWith('save');
});

test('a save nobody takes any more stops sending and reports what the writer answered', async () => {
  const { largeText } = port();
  largeText.write.mockResolvedValueOnce(false);
  largeText.finish.mockResolvedValueOnce({ canceled: true });
  const text = pulled(Array.from({ length: 5 }, () => 'y'.repeat(1024 * 1024)));
  expect(await saveLargeText({ largeText }, { document: described(), revision: 1 }, text)).toEqual({ canceled: true });
  expect(largeText.write).toHaveBeenCalledTimes(1);
});

test('a failure while handing the text over fails the save instead of ending it as complete', async () => {
  const { largeText } = port();
  const text = { read: vi.fn().mockReturnValueOnce('first\n').mockImplementationOnce(() => { throw new Error('The model was disposed.'); }) };
  await expect(saveLargeText({ largeText }, { document: described(), revision: 1 }, text)).rejects.toThrow('model was disposed');
  expect(largeText.finish).toHaveBeenCalledTimes(1);
  expect(largeText.finish).toHaveBeenCalledWith('save', 'The model was disposed.');
});
