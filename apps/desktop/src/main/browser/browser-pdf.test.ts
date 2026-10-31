import { expect, it } from 'vitest';
import { BrowserPdf } from './browser-pdf';

it('reads one immutable snapshot in bounded ranges and revokes it on disposal', async () => {
  const pdf = new BrowserPdf(), bytes = Buffer.from('%PDF-1.7\nfixture');
  try {
    expect(await pdf.open('https://example.test/paper', async (_url, init) => {
      expect(init.credentials).toBe('include');
      return new Response(bytes);
    })).toBe(bytes.length);
    expect(Buffer.from(await pdf.read(0, 5)).toString()).toBe('%PDF-');
    await expect(pdf.read(-1, 5)).rejects.toThrow('Invalid PDF byte range');
    await expect(pdf.read(0, bytes.length + 1)).rejects.toThrow('exceeds file size');
  } finally { await pdf.dispose(); }
  await expect(pdf.read(0, 5)).rejects.toThrow('no longer available');
});

it('rejects HTML login responses, oversized downloads and disposed loads', async () => {
  for (const response of [new Response('<html>sign in</html>'), new Response('%PDF-', { headers: { 'content-length': String(257 * 1024 * 1024) } })]) {
    const pdf = new BrowserPdf();
    try { await expect(pdf.open('https://example.test/paper', async () => response)).rejects.toThrow(); }
    finally { await pdf.dispose(); }
  }
  const pdf = new BrowserPdf();
  await pdf.dispose();
  await expect(pdf.open('https://example.test/paper', async () => new Response('%PDF-fixture'))).rejects.toThrow();
});
