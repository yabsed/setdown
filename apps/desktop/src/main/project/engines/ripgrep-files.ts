import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';
import { isMarkdownDocument } from '../project-paths';
import { isTextCandidate } from '../../../core/document/document-profile';
const exec = promisify(execFile);
const EXCLUDED = ['.git', '.hg', '.svn', 'node_modules'];
/** ripgrep owns traversal/ignore rules. Plain text is an explicit opt-in scope. */
export class RipgrepFiles {
  markdown(root: string): Promise<string[]> { return this.list(root, isMarkdownDocument); }
  text(root: string): Promise<string[]> { return this.list(root, isTextCandidate); }
  private async list(root: string, eligible: (path: string) => boolean): Promise<string[]> {
    const { stdout } = await exec(rgPath, [
      '--files', '--null', '--hidden', '--no-config',
      ...EXCLUDED.flatMap((directory) => ['--glob', `!${directory}`, '--glob', `!**/${directory}/**`]),
    ], { cwd: root, encoding: 'buffer', timeout: 10_000, maxBuffer: 20_000_000,
      env: { ...process.env, RIPGREP_CONFIG_PATH: '' } });
    return stdout.toString().split('\0').filter((entry) => entry.length > 0 && eligible(entry))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((relative) => path.join(root, relative));
  }
}
