import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function resourceUrl(filePath: string) {
  const pathname = pathToFileURL(path.resolve(filePath)).pathname;
  return `marktex-resource://file${pathname}${/[\\/]$/.test(filePath) ? '/' : ''}`;
}

export function pathFromResourceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'marktex-resource:'
      ? fileURLToPath(`file://${url.pathname}`)
      : null;
  } catch {
    return null;
  }
}
