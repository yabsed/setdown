import { statSync } from 'node:fs';
import path from 'node:path';
import { isTextCandidate } from '../../core/document/document-profile';

/** Skip the executable/app entry, including extensionless packaged executables. */
export function documentPathFromArgs(args: string[], packaged: boolean,
  isFile: (path: string) => boolean = (filePath) => statSync(filePath).isFile()): string | undefined {
  let positional = false;
  for (const argument of args.slice(packaged ? 1 : 2)) {
    if (argument === '--') { positional = true; continue; }
    if (!positional && argument.startsWith('-')) continue;
    if (!isTextCandidate(argument)) continue;
    const resolved = path.resolve(argument);
    try { if (isFile(resolved)) return resolved; } catch { /* Try the next file argument. */ }
  }
  return undefined;
}
