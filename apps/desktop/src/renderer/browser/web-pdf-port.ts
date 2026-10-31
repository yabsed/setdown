import type { DesktopPort, PdfPort } from '../ports/desktop-port';

/** Share the local reader UI, retaining main's web-tab/navigation authorization. */
export function webPdfPort(desktop: DesktopPort, id: string, token: string): PdfPort {
  return {
    setTabZoom: (...args) => desktop.setTabZoom(...args),
    openLink: url => desktop.openLink(url),
    readPdfRange: (_path, begin, end) => desktop.browser.pdfRange(id, token, begin, end),
    showPdfSelectionMenu: (_path, selection) => desktop.browser.pdfMenu(id, token, selection),
  };
}
