import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodePathSegments } from '../../core/markdown/asset-references';

export function markdownDestinationForFile(documentPath: string, targetPath: string) {
  const relative = path.relative(path.dirname(documentPath), targetPath);
  if (!relative || path.isAbsolute(relative)) return pathToFileURL(targetPath).href;
  return encodePathSegments(relative.split(path.sep));
}
