import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReadingPositionStore } from './reading-position-store';
import type { ReadingRecord } from '../../core/reading/reading-position';

const record = (file: string, observedAt = 100): ReadingRecord => ({ version: 1, path: file, observedAt,
  diskVersion: { mtimeMs: 3, size: 100 }, position: { kind: 'text', surface: 'editor',
    anchor: { sourceLine: 18, yRatio: .3, reason: 'exact-range', confidence: 'exact' }, editorView: { cursorState: [] } } });
function run(check: (file: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reading-store-'));
  try { check(path.join(root, 'positions.json')); } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('durable reading positions', () => {
  it('persists all position kinds and moves directory histories', () => run((file) => {
    const store = new ReadingPositionStore(file);
    store.save(record('/docs/a.txt'));
    store.save({ ...record('/docs/b.pdf'), position: { kind: 'pdf', page: 37, left: 12, top: 401, zoom: 'page-width', rotation: 90 } });
    store.save({ ...record('/docs/c.png'), position: { kind: 'image', zoom: 2, rotation: 90, centerX: .3, centerY: .7 } });
    store.move('/docs', '/renamed'); store.flush();
    const reopened = new ReadingPositionStore(file);
    expect(reopened.get('/docs/a.txt', { mtimeMs: 3, size: 100 })).toBeUndefined();
    expect(reopened.get('/renamed/a.txt', { mtimeMs: 3, size: 100 })).toEqual(record('').position);
    expect(reopened.get('/renamed/b.pdf', { mtimeMs: 3, size: 100 })).toMatchObject({ page: 37, top: 401, rotation: 90 });
    expect(reopened.get('/renamed/c.png', { mtimeMs: 3, size: 100 })).toMatchObject({ kind: 'image', zoom: 2, rotation: 90, centerX: .3, centerY: .7 });
  }));
  it('rejects delayed older observations and invalid data', () => run((file) => {
    const store = new ReadingPositionStore(file);
    expect(store.save(record('/a.txt', 200))).toBe(true);
    expect(store.save(record('/a.txt', 199))).toBe(false);
    expect(store.save({ ...record('/a.pdf'), position: { kind: 'pdf', page: 0 } })).toBe(false);
    expect(store.save({ ...record('/a.png'), position: { kind: 'image', zoom: 2, rotation: 90, centerX: 2, centerY: .5 } })).toBe(false);
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(store.save({ ...record('/a.txt'), position: { ...record('').position, editorView: cyclic } })).toBe(false);
    store.flush();
  }));
  it('drops exact editor layout after disk changes and bounds history', () => run((file) => {
    const store = new ReadingPositionStore(file, 2);
    for (const name of ['a', 'b', 'c']) store.save(record('/' + name));
    expect(store.get('/a', { mtimeMs: 3, size: 100 })).toBeUndefined();
    expect(store.get('/b', { mtimeMs: 4, size: 100 })).not.toHaveProperty('editorView');
    expect(store.get('/b', { mtimeMs: 4, size: 100 })).toMatchObject({ anchor: { sourceLine: 18 } });
    store.flush();
  }));
  it('treats corrupt or future history as empty', () => run((file) => {
    writeFileSync(file, '{broken');
    expect(new ReadingPositionStore(file).get('/a', { size: 0, mtimeMs: 0 })).toBeUndefined();
    writeFileSync(file, JSON.stringify({ version: 100, records: [record('/a')] }));
    expect(new ReadingPositionStore(file).get('/a', { size: 0, mtimeMs: 0 })).toBeUndefined();
  }));
});
