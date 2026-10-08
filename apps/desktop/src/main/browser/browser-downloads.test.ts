import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DownloadItem } from 'electron';
import type { BrowserDownload, BrowserEvent } from '../../protocol/browser';

const electron = vi.hoisted(() => ({ app: { getPath: vi.fn() }, shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() } }));
vi.mock('electron', () => electron);
import { BrowserDownloads } from './browser-downloads';

class Item extends EventEmitter {
  state: BrowserDownload['state'] = 'progressing';
  received = 0; paused = false;
  constructor(readonly file: string) { super(); }
  getURL = () => 'https://example.com/report';
  getFilename = () => 'report.txt';
  getSavePath = () => this.file;
  getTotalBytes = () => 100;
  getReceivedBytes = () => this.received;
  getState = () => this.state;
  isPaused = () => this.paused;
  canResume = () => this.paused || this.state === 'interrupted';
  pause = () => { this.paused = true; };
  resume = () => { this.paused = false; this.state = 'progressing'; };
  cancel = () => { this.state = 'cancelled'; this.emit('done', {}, this.state); };
}
let root: string, store: BrowserDownloads, events: BrowserEvent[];
beforeEach(async () => {
  vi.useFakeTimers(); events = [];
  root = await mkdtemp(path.join(os.tmpdir(), 'setdown-downloads-unit-'));
  electron.app.getPath.mockReturnValue(root);
  store = new BrowserDownloads(event => events.push(event));
  await store.list();
});
afterEach(async () => {
  store.flushOnExit(); vi.useRealTimers(); vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe('native browser download library', () => {
  it('bounds progress events and never lets a delayed update overwrite completion', async () => {
    const item = new Item(path.join(root, 'report.txt'));
    store.track(item as unknown as DownloadItem);
    for (let i = 1; i <= 20; i++) { item.received = i; item.emit('updated', {}, 'progressing'); }
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ download: { received: 20 } });
    item.received = 100; item.emit('updated', {}, 'progressing');
    item.state = 'completed'; item.emit('done', {}, 'completed');
    vi.advanceTimersByTime(200);
    expect(events).toHaveLength(3);
    expect((await store.list())[0]).toMatchObject({ state: 'completed', received: 100, resumable: false });
  });
  it('uses independent IDs for concurrent downloads of the same file and publishes pause/resume immediately', async () => {
    const file = path.join(root, 'report.txt');
    const first = new Item(file), second = new Item(file);
    store.track(first as unknown as DownloadItem); store.track(second as unknown as DownloadItem);
    const records = await store.list();
    expect(records).toHaveLength(2); expect(records[0].id).not.toBe(records[1].id);
    await store.command(records[0].id, 'pause');
    expect((await store.list())[0].paused).toBe(true);
    await store.command(records[0].id, 'resume');
    expect((await store.list())[0].paused).toBe(false);
    await expect(store.command(records[0].id, 'remove')).rejects.toThrow('unavailable');
    await store.command(records[0].id, 'cancel');
    expect((await store.list())[0].state).toBe('cancelled');
    expect((await store.list())[1].state).toBe('progressing');
  });
  it('retains finished records and marks previous-process transfers interrupted without claiming resumability', async () => {
    const item = new Item(path.join(root, 'report.txt'));
    store.track(item as unknown as DownloadItem); item.received = 11;
    item.emit('updated', {}, 'progressing'); vi.advanceTimersByTime(200);
    store.flushOnExit();
    const reopened = new BrowserDownloads(() => {});
    expect((await reopened.list())[0]).toMatchObject({ state: 'interrupted', received: 11, paused: false, resumable: false });
    await expect(reopened.command((await reopened.list())[0].id, 'resume')).rejects.toThrow('unavailable');
    reopened.flushOnExit();
  });
  it('opens only known completed paths and removes metadata without deleting the file', async () => {
    const file = path.join(root, 'report.txt'); await writeFile(file, 'keep me');
    const item = new Item(file); store.track(item as unknown as DownloadItem);
    const id = (await store.list())[0].id;
    await expect(store.command(id, 'open')).rejects.toThrow('unavailable');
    item.state = 'completed'; item.received = 7; item.emit('done', {}, 'completed');
    await store.command(id, 'open'); await store.command(id, 'show');
    expect(electron.shell.openPath).toHaveBeenCalledWith(file);
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(file);
    await store.command(id, 'remove'); expect(await store.list()).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('keep me');
    await expect(store.command(file, 'open')).rejects.toThrow('not found');
  });
});
