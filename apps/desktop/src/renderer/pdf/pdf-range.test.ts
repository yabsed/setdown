import { expect, it } from 'vitest';
import { readPdfBytes } from './pdf-range';

it('assembles coalesced PDF.js ranges without exceeding the IPC limit', async () => {
  const calls: number[][] = [];
  const chunk = 4 * 1024 * 1024;
  const bytes = await readPdfBytes(7, chunk + 17, chunk + 17, async (begin, end) => {
    calls.push([begin, end]);
    return new Uint8Array(end - begin).fill(calls.length);
  });
  expect(calls).toEqual([[7, chunk + 7], [chunk + 7, chunk + 17]]);
  expect(bytes.length).toBe(chunk + 10);
  expect(bytes[chunk - 1]).toBe(1); expect(bytes[chunk]).toBe(2);
});

it('rejects invalid and truncated reads', async () => {
  const read = async () => new Uint8Array(1);
  await expect(readPdfBytes(0, 100, 50, read)).rejects.toThrow('Invalid');
  await expect(readPdfBytes(0, 100, 100, read)).rejects.toThrow('Incomplete');
});
