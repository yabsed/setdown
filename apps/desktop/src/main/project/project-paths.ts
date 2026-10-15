import path from 'node:path';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
export { isMarkdownDocument } from '../../core/document/document-profile';

export class ProjectPaths {
  root(state: WindowState): string {
    if (!state.projectRoot) throw new Error('No folder is open.');
    return state.projectRoot;
  }
  inside(state: WindowState, candidate: string): string {
    const root = this.root(state);
    const resolved = canonicalPath(String(candidate));
    if (!isInside(root, resolved)) throw new Error('The path is outside the open folder.');
    return resolved;
  }
  /** Resolve ancestors, but operate on a symlink entry rather than its target. */
  entry(state: WindowState, candidate: string): string {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) throw new Error('Invalid file path.');
    const resolved = path.resolve(candidate);
    if (resolved === this.root(state)) return resolved;
    return path.join(this.inside(state, path.dirname(resolved)), path.basename(resolved));
  }
  child(state: WindowState, parentCandidate: string, rawName: string): string {
    const parent = this.inside(state, parentCandidate);
    const name = String(rawName).trim();
    if (!name || name === '.' || name === '..' || name.includes('\0') || path.basename(name) !== name) {
      throw new Error('Enter a valid file or folder name.');
    }
    // A new child is a directory entry, not the target of an existing symlink.
    return path.join(parent, name);
  }
  relative(state: WindowState, candidate: string): string {
    return path.relative(this.root(state), this.inside(state, candidate));
  }
}
