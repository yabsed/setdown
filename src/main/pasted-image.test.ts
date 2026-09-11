import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { savePastedPng } from './pasted-image';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('savePastedPng', () => {
  it('stores an image beside the document and returns a portable Markdown link', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-paste-'));
    temporaryDirectories.push(directory);
    const documentPath = path.join(directory, 'My notes.md');
    const png = new Uint8Array([137, 80, 78, 71]);

    const saved = await savePastedPng(
      documentPath,
      png,
      new Date('2026-09-11T07:08:09.000Z'),
    );

    expect(saved.markdownPath).toBe('My notes.assets/pasted-20260911-070809.png');
    expect(saved.markdown).toBe(
      '![붙여넣은 이미지](<My notes.assets/pasted-20260911-070809.png>)',
    );
    expect(new Uint8Array(await fs.readFile(saved.absolutePath))).toEqual(png);
  });

  it('does not overwrite an image pasted in the same second', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-paste-'));
    temporaryDirectories.push(directory);
    const documentPath = path.join(directory, 'sample.md');
    const now = new Date('2026-09-11T07:08:09.000Z');

    const first = await savePastedPng(documentPath, new Uint8Array([1]), now);
    const second = await savePastedPng(documentPath, new Uint8Array([2]), now);

    expect(path.basename(first.absolutePath)).toBe('pasted-20260911-070809.png');
    expect(path.basename(second.absolutePath)).toBe('pasted-20260911-070809-2.png');
  });
});
