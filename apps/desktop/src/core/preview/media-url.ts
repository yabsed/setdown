/**
 * Node-free marktex-resource URL builder for the sandboxed preload, which
 * cannot require node:url. Matches pathToFileURL(pathname) encoding for the
 * absolute paths documents carry; the main-side decoder accepts both.
 */
export function resourceUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const pathname = (normalized.startsWith('/') ? normalized : `/${normalized}`)
    .split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `marktex-resource://file${pathname}${/\/$/.test(filePath) ? '/' : ''}`;
}
