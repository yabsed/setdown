import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalPath } from '../../documents/file-system';
import { MAX_TEXT_FILE_BYTES } from '../../../core/document/text-codec';
import { parseIgnoreCheck } from '../../../core/project/upstream/git-resource';

const exec = promisify(execFile);

/** Narrow adapter around Git; binary-safe reads are decoded by document policy. */
export class GitCli {
  private constructor(
    readonly workingDirectory: string,
    readonly repositoryRoot: string,
  ) {}

  static async connect(workingDirectory: string): Promise<GitCli | null> {
    try {
      const repositoryRoot = (await run(workingDirectory, ['rev-parse', '--show-toplevel'])).trim();
      return repositoryRoot ? new GitCli(canonicalPath(repositoryRoot), canonicalPath(repositoryRoot)) : null;
    } catch (error) {
      if (/not a git repository/i.test(String(error))) return null;
      throw error;
    }
  }

  static run(workingDirectory: string, args: string[], timeout?: number): Promise<string> {
    return run(workingDirectory, args, timeout);
  }

  run(args: string[], timeout?: number): Promise<string> {
    return run(this.workingDirectory, args, timeout);
  }

  checkIgnore(paths: string[]): Promise<string[]> {
    if (!paths.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const child = execFile('git', ['check-ignore', '-v', '-z', '--stdin'], {
        cwd: this.workingDirectory, encoding: 'utf8', timeout: 10_000, maxBuffer: 4_000_000,
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      }, (error, stdout, stderr) => {
        if (error && error.code !== 1) reject(new Error(stderr.trim() || error.message));
        else resolve(error ? [] : parseIgnoreCheck(stdout));
      });
      // NUL transport preserves spaces, newlines, leading dashes and Unicode.
      child.stdin?.on('error', reject);
      child.stdin?.end(`${paths.join('\0')}\0`, 'utf8');
    });
  }

  async objectExists(specification: string): Promise<boolean> {
    try {
      await exec('git', ['rev-parse', '--verify', '--quiet', specification], {
        cwd: this.workingDirectory, timeout: 10_000, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return false;
      throw error;
    }
  }

  async runBytes(args: string[], timeout = 10_000): Promise<Buffer> {
    const { stdout } = await exec('git', ['--literal-pathspecs', ...args], {
      cwd: this.workingDirectory, encoding: 'buffer', timeout,
      maxBuffer: MAX_TEXT_FILE_BYTES + 1,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }
}

async function run(workingDirectory: string, args: string[], timeout = 10_000): Promise<string> {
  try {
    const { stdout } = await exec('git', ['--literal-pathspecs', ...args], {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4_000_000,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw Object.assign(new Error(failure.stderr?.trim() || failure.message || 'Git command failed.'), { cause: error, code: (error as NodeJS.ErrnoException).code });
  }
}
