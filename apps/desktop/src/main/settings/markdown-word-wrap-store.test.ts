import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MarkdownWordWrapStore } from './markdown-word-wrap-store';

function run(check: (file: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'markdown-word-wrap-store-'));
  try { check(path.join(root, 'markdown-word-wrap.json')); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('Markdown word wrap store', () => {
  it('defaults to enabled when the file is missing', () => run((file) => {
    const store = new MarkdownWordWrapStore(file);
    expect(store.enabled).toBe(true);
    expect(store.load()).toBe(true);
  }));
  it('round-trips the enabled flag', () => run((file) => {
    const store = new MarkdownWordWrapStore(file);
    store.set(false);
    expect(new MarkdownWordWrapStore(file).load()).toBe(false);
    store.set(true);
    expect(new MarkdownWordWrapStore(file).load()).toBe(true);
  }));
  it('recovers to enabled from corrupt or wrong-shaped JSON', () => run((file) => {
    writeFileSync(file, '{broken');
    expect(new MarkdownWordWrapStore(file).load()).toBe(true);
    writeFileSync(file, JSON.stringify({ enabled: 'no' }));
    expect(new MarkdownWordWrapStore(file).load()).toBe(true);
  }));
});
