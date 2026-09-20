import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPdfMetadata, readPdfRange } from './pdf-file';

it('validates PDF headers and reads bounded version-specific bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-ranges-'));
  const file = path.join(root, 'note.pdf');
  try {
    await writeFile(file, '%PDF-1.7\nexample bytes');
    const metadata = await readPdfMetadata(file);
    expect(metadata).toMatchObject({ kind: 'pdf', text: '' });
    expect(Buffer.from(await readPdfRange(file, 0, 8, metadata.diskVersion)).toString()).toBe('%PDF-1.7');
    await expect(readPdfRange(file, -1, 8, metadata.diskVersion)).rejects.toThrow('Invalid');
    await expect(readPdfRange(file, 0, 5 * 1024 * 1024, metadata.diskVersion)).rejects.toThrow('Invalid');
    await writeFile(file, 'not pdf');
    await expect(readPdfRange(file, 0, 4, metadata.diskVersion)).rejects.toThrow('changed');
    await expect(readPdfMetadata(file)).rejects.toThrow('not a PDF');
    await expect(readPdfMetadata(root)).rejects.toThrow('regular');
  } finally { await rm(root, { recursive: true, force: true }); }
});
