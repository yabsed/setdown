/**
 * File Viewer's own sheet-chart drawing (an SVG), which its package does not export.
 * vite.config.ts points this name at the file inside the pinned package.
 */
declare module '@file-viewer-spreadsheet-chart' {
  export const renderSpreadsheetChart: (documentRef: Document, chart: unknown) => HTMLDivElement;
}
