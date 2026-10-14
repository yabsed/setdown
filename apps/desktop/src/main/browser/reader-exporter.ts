import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ReaderArticle } from '../../core/browser/reader-article';
import { readerFileName, readerMarkdown, sanitizedReaderHtml } from '../../core/browser/reader-export';
import { themeProfile } from '../../core/theme/theme-catalog';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import { waitForPrintablePreview } from '../preview/pdf-exporter';

export async function exportReader(window: BrowserWindow, article: ReaderArticle, format: 'markdown' | 'pdf', theme: PreviewThemeId,
  current: () => boolean) {
  const extension = format === 'markdown' ? 'md' : 'pdf';
  const result = await dialog.showSaveDialog(window, { title: format === 'markdown' ? 'Export to Markdown' : 'Export to PDF',
    defaultPath: path.join(app.getPath('documents'), `${readerFileName(article.title)}.${extension}`),
    filters: [{ name: format === 'markdown' ? 'Markdown' : 'PDF', extensions: [extension] }] });
  if (result.canceled || !result.filePath || !current()) return { canceled: true };
  if (format === 'markdown') {
    await fs.writeFile(result.filePath, readerMarkdown(article), 'utf8');
  } else {
    const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const profile = themeProfile(theme);
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'">
      <style>body{font:14px/1.6 D2Coding,monospace;color:${profile.palette.text};background:${profile.preview.background};padding:2em}h1,h2,h3{line-height:1.3}table{border-collapse:collapse}td,th{border:1px solid ${profile.palette.border};padding:.5em}img{max-width:100%;height:auto}pre{white-space:pre-wrap}a{color:${profile.palette.accent}}@page{size:A4;margin:15mm}</style>
      <article class="markdown-preview" data-for="preview"><h1>${escape(article.title)}</h1><p>${escape([article.byline, article.siteName].filter(Boolean).join(' · '))}</p>
      <p><a href="${escape(article.url)}">${escape(article.url)}</a></p>${sanitizedReaderHtml(article)}</article>`;
    const print = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await print.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await waitForPrintablePreview(print);
      if (!current()) return { canceled: true };
      const pdf = await print.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      if (!current()) return { canceled: true };
      await fs.writeFile(result.filePath, pdf);
    } finally { print.destroy(); }
  }
  return { canceled: false, path: result.filePath };
}
