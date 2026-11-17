import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpenableDocument } from '../../core/document/document-profile';

/** Skip the executable/app entry, including extensionless packaged executables. */
export function documentPathFromArgs(args: string[], packaged: boolean,
  isFile: (path: string) => boolean = (filePath) => statSync(filePath).isFile()): string | undefined {
  let positional = false;
  for (const argument of args.slice(packaged ? 1 : 2)) {
    if (argument === '--') { positional = true; continue; }
    if (!positional && argument.startsWith('-')) continue;
    // A desktop entry that also takes web addresses (%U) receives files as file: URLs.
    let candidate = argument;
    if (/^https?:\/\//i.test(argument)) continue; // A web address opens as a web tab.
    if (/^file:/i.test(argument)) { try { candidate = fileURLToPath(argument); } catch { continue; } }
    if (!isOpenableDocument(candidate)) continue;
    const resolved = path.resolve(candidate);
    try { if (isFile(resolved)) return resolved; } catch { /* Try the next file argument. */ }
  }
  return undefined;
}
