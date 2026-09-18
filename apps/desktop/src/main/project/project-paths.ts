import path from 'node:path';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';

const DOCUMENT = /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i;

export const isMarkdownDocument = (filePath: string) => DOCUMENT.test(filePath);

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

  child(state: WindowState, parentCandidate: string, rawName: string): string {
    const parent = this.inside(state, parentCandidate);
    const name = String(rawName).trim();
    if (!name || name === '.' || name === '..' || name.includes('\0')
      || path.basename(name) !== name) {
      throw new Error('Enter a valid file or folder name.');
    }
    return this.inside(state, path.join(parent, name));
  }

  relative(state: WindowState, candidate: string): string {
    return path.relative(this.root(state), this.inside(state, candidate));
  }
}
