import { BrowserWindow, ipcMain, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiskVersion } from '../../core/document/document';
import { officeFamily, type OfficeFamily } from '../../core/document/document-profile';
import type { ExportPdfResult } from '../../protocol/desktop-api';
import { pathDialog } from '../dialogs/path-picker';
import type { WindowState } from '../windows/window-state';
import { readOfficeBytes } from './office-file';

type Job = { name: string; family: OfficeFamily; bytes: Uint8Array };
const jobs = new Map<number, { job: Job; finish(error?: string): void }>();
const PARTITION = 'office-export';
let installed = false;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Saves an Office document as PDF. A hidden window of its own renders the file again for paper
 * (light, unzoomed, every page), so the tab the person is reading is not disturbed and the
 * untrusted document never shares a page with the shell's bridge.
 */
export async function exportOfficePdf(state: WindowState, file: string, version: DiskVersion): Promise<ExportPdfResult> {
  const family = officeFamily(file);
  if (!family) throw new Error('Unsupported Office format.');
  const name = path.basename(file);
  const result = await pathDialog.showSaveDialog(state.window, { title: 'Export as PDF',
    defaultPath: path.join(path.dirname(file), `${name.replace(/\.[^.]+$/, '') || 'document'}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  const bytes = await readOfficeBytes(file, version);
  // One export process at a time: each holds a whole document and its rendering.
  const printed = queue.then(() => print(state, { name, family, bytes }));
  queue = printed.then(() => {}, () => {});
  await fs.writeFile(result.filePath, await printed);
  return { canceled: false, path: result.filePath };
}

function install(shell: URL) {
  if (installed) return;
  installed = true;
  ipcMain.handle('office-export:job', event => {
    const entry = jobs.get(event.sender.id); if (!entry) throw new Error('Unknown document export.'); return entry.job;
  });
  ipcMain.on('office-export:finish', (event, error: unknown) => jobs.get(event.sender.id)?.finish(typeof error === 'string' && error ? error : undefined));
  // A document may name pictures or fonts on the web. Saving a PDF never fetches them.
  session.fromPartition(PARTITION).webRequest.onBeforeRequest((details, respond) => {
    let url: URL | undefined;
    try { url = new URL(details.url); } catch { /* cancelled below */ }
    respond({ cancel: !url || !(['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol)
      || (shell.protocol !== 'file:' && url.host === shell.host)) });
  });
}

function print(state: WindowState, job: Job): Promise<Buffer> {
  if (state.window.isDestroyed()) return Promise.reject(new Error('The window is closed.'));
  const shell = new URL(state.window.webContents.getURL());
  install(shell);
  shell.search = ''; shell.hash = ''; shell.searchParams.set('office-export', '1');
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 960,
      webPreferences: { preload: path.join(__dirname, 'office-export-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: PARTITION } });
    const id = window.webContents.id;
    const timer = setTimeout(() => finish('The document took too long to prepare.'), 180_000);
    const ownerClosed = () => finish('The window was closed.');
    const finish = (error?: string) => {
      if (!jobs.delete(id)) return;
      clearTimeout(timer); state.window.off('closed', ownerClosed);
      const done = (settle: () => void) => { if (!window.isDestroyed()) window.destroy(); settle(); };
      if (error || window.isDestroyed()) { done(() => reject(new Error(error || 'The export window closed.'))); return; }
      // The printable document carries its own paper size and margins; A4 is for formats that state none.
      window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' })
        .then(pdf => done(() => resolve(pdf)), cause => done(() => reject(cause instanceof Error ? cause : new Error(String(cause)))));
    };
    jobs.set(id, { job, finish });
    state.window.once('closed', ownerClosed);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.once('render-process-gone', () => finish('The export process stopped.'));
    window.once('closed', () => finish('The export window closed.'));
    void window.loadURL(shell.href).catch(error => finish(String(error)));
  });
}
