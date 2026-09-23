import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutoSaveStore } from './auto-save-store';

function run(check: (file: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'auto-save-store-'));
  try { check(path.join(root, 'auto-save.json')); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('auto-save store', () => {
  it('defaults to disabled when the file is missing', () => run((file) => {
    expect(new AutoSaveStore(file).load()).toBe(false);
  }));
  it('round-trips the enabled flag', () => run((file) => {
    const store = new AutoSaveStore(file);
    store.set(true);
    expect(new AutoSaveStore(file).load()).toBe(true);
    store.set(false);
    expect(new AutoSaveStore(file).load()).toBe(false);
  }));
  it('recovers to disabled from corrupt or wrong-shaped JSON', () => run((file) => {
    writeFileSync(file, '{broken');
    expect(new AutoSaveStore(file).load()).toBe(false);
    writeFileSync(file, JSON.stringify({ enabled: 'yes' }));
    expect(new AutoSaveStore(file).load()).toBe(false);
  }));
});
