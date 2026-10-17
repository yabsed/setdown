import { loadWebFonts as upstreamLoad } from '@upstream/core/font-loader';
export * from '@upstream/core/font-loader';
// Local assets only. CSP and the isolated Electron session also deny network access.
export const loadWebFonts = (fonts?: string[], progress?: (done: number, total: number) => void) =>
  upstreamLoad(fonts, progress, { disableExternalWebFonts: true });
