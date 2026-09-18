import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function resourceUrl(filePath: string) {
  const pathname = pathToFileURL(path.resolve(filePath)).pathname;
  return `marktex-resource://file${pathname}${/[\\/]$/.test(filePath) ? '/' : ''}`;
}
