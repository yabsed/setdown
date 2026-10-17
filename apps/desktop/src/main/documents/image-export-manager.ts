import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type { ImageRecipe } from '../../core/image/image-recipe';

type Job = { bytes: Uint8Array; width: number; height: number; recipe: ImageRecipe };
const jobs = new Map<number, { job: Job; finish(bytes: Uint8Array | null, error?: string): void }>();
let installed = false;
let queue: Promise<unknown> = Promise.resolve();
/** One bounded export process at a time; never attaches to the shell or its preview manager. */
export function exportImage(job: Job, signal?: AbortSignal): Promise<Uint8Array> {
  const result = queue.then(() => {
    if (signal?.aborted) throw Error('The image is no longer open.');
    return run(job, signal);
  });
  // The sequencing tail must not retain the last potentially 64 MiB result.
  queue = result.then(() => {}, () => {}); return result;
}
function run(job: Job, signal?: AbortSignal): Promise<Uint8Array> {
  if (!installed) {
    installed = true;
    ipcMain.handle('image-export:job', event => {
      const entry = jobs.get(event.sender.id); if (!entry) throw Error('Unknown image export.'); return entry.job;
    });
    ipcMain.on('image-export:finish', (event, bytes, error) => jobs.get(event.sender.id)?.finish(bytes, error));
  }
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({ show: false, width: 1, height: 1,
      webPreferences: { preload: path.join(__dirname, 'image-export-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'image-export' } });
    const id = window.webContents.id;
    const timer = setTimeout(() => finish(null, 'Image export timed out.'), 90_000);
    const abort = () => finish(null, 'The image is no longer open.');
    const finish = (bytes: Uint8Array | null, error?: string) => {
      if (!jobs.delete(id)) return;
      signal?.removeEventListener('abort', abort);
      clearTimeout(timer); if (!window.isDestroyed()) window.destroy();
      if (bytes instanceof Uint8Array && bytes.length && bytes.length <= 64 * 1024 * 1024) resolve(bytes);
      else reject(Error(error || 'Image export failed or exceeded 64 MiB.'));
    };
    jobs.set(id, { job, finish });
    signal?.addEventListener('abort', abort, { once: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.once('render-process-gone', () => finish(null, 'Image export process stopped.'));
    window.once('closed', () => finish(null, 'Image export window closed.'));
    void window.loadFile(path.join(__dirname, 'image-export.html')).catch(error => finish(null, String(error)));
  });
}
