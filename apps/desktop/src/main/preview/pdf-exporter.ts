import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExportPdfResult } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import type { PreviewRenderer } from './preview-renderer';

async function waitForPrintablePreview(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    let stableSince = 0;
    let previousSignature = '';
    const check = () => {
      const preview = document.querySelector('.markdown-preview[data-for="preview"]');
      const pendingDiagrams = document.querySelectorAll('.mermaid:not([data-processed])').length;
      const pendingImages = Array.from(document.images).filter((image) => !image.complete).length;
      const signature = preview
        ? [preview.childElementCount, preview.scrollHeight, pendingDiagrams, pendingImages].join(':')
        : '';
      if (signature && signature === previousSignature && pendingDiagrams === 0 && pendingImages === 0) {
        if (!stableSince) stableSince = Date.now();
      } else {
        stableSince = 0;
        previousSignature = signature;
      }
      if ((stableSince && Date.now() - stableSince >= 300) || Date.now() - started > 15000) {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  })`);
}

export async function exportPdf(
  renderer: PreviewRenderer,
  state: WindowState,
  text: string,
  revision: number,
  documentPath: string,
): Promise<ExportPdfResult> {
  const document = state.currentDocument;
  if (!document || document.path !== documentPath) return { canceled: true };
  const baseName = document.name.replace(/\.[^.]+$/, '') || 'document';
  const result = await dialog.showSaveDialog(state.window, {
    defaultPath: path.join(
      document.isUntitled ? app.getPath('documents') : path.dirname(document.path),
      `${baseName}.pdf`,
    ),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const url = await renderer.renderExport(state, text, revision, documentPath);
  const printWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await printWindow.loadURL(url);
    await waitForPrintablePreview(printWindow);
    const pdf = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fs.writeFile(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  } finally {
    printWindow.destroy();
  }
}
