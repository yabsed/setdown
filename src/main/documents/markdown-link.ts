import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function markdownDestinationForFile(documentPath: string, targetPath: string) {
  const relative = path.relative(path.dirname(documentPath), targetPath);
  if (!relative || path.isAbsolute(relative)) return pathToFileURL(targetPath).href;
  return relative.split(path.sep).join('/');
}
