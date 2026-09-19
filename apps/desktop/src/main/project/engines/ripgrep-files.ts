import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';
import { isMarkdownDocument } from '../project-paths';

const exec = promisify(execFile);
const EXCLUDED = ['.git', '.hg', '.svn', 'node_modules'];

/** Lets ripgrep own recursive traversal, ignore files, hidden paths, and platform quirks. */
export class RipgrepFiles {
  async markdown(root: string): Promise<string[]> {
    const { stdout } = await exec(rgPath, [
      '--files', '--null', '--hidden', '--no-config',
      ...EXCLUDED.flatMap((directory) => [
        '--glob', `!${directory}`,
        '--glob', `!**/${directory}/**`,
      ]),
    ], {
      cwd: root,
      encoding: 'buffer',
      timeout: 10_000,
      maxBuffer: 20_000_000,
      env: { ...process.env, RIPGREP_CONFIG_PATH: '' },
    });
    return stdout.toString().split('\0').filter(isMarkdownDocument)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((relative) => path.join(root, relative));
  }
}
