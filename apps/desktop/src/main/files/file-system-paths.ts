import path from 'node:path';
import { canonicalPath } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';

function absolute(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length > 16384 || candidate.includes('\0') || !path.isAbsolute(candidate))
    throw new Error('Invalid file path.');
  return path.resolve(candidate);
}

/**
 * The folder tab's path policy. It has ProjectPaths' shape so ExplorerService's
 * planning, conflict, Undo and transfer code runs unchanged; only the boundary
 * differs. Renderer IPC that reaches it is limited to app windows (window-ipc.ts).
 */
export class FileSystemPaths {
  /** No folder is "the open folder" here; a filesystem root can still not be renamed or trashed. */
  root(_state?: WindowState): string { return path.parse(process.cwd()).root; }
  inside(_state: WindowState | undefined, candidate: string): string { return canonicalPath(absolute(candidate)); }
  /** Resolve ancestors, but operate on a symlink entry rather than its target. */
  entry(_state: WindowState | undefined, candidate: string): string {
    const resolved = absolute(candidate);
    if (resolved === path.parse(resolved).root) return resolved;
    return path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
  }
  child(state: WindowState | undefined, parentCandidate: string, rawName: string): string {
    const parent = this.inside(state, parentCandidate);
    const name = String(rawName).trim();
    if (!name || name === '.' || name === '..' || name.includes('\0') || path.basename(name) !== name)
      throw new Error('Enter a valid file or folder name.');
    return path.join(parent, name);
  }
  relative(state: WindowState | undefined, candidate: string): string { return this.inside(state, candidate); }
}
