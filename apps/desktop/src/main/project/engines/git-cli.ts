import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalPath } from '../../documents/file-system';
import { MAX_TEXT_FILE_BYTES } from '../../../core/document/text-codec';

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
      return repositoryRoot ? new GitCli(workingDirectory, canonicalPath(repositoryRoot)) : null;
    } catch {
      return null;
    }
  }

  static run(workingDirectory: string, args: string[], timeout?: number): Promise<string> {
    return run(workingDirectory, args, timeout);
  }

  run(args: string[], timeout?: number): Promise<string> {
    return run(this.workingDirectory, args, timeout);
  }

  async runBytes(args: string[], timeout = 10_000): Promise<Buffer> {
    const { stdout } = await exec('git', args, {
      cwd: this.workingDirectory, encoding: 'buffer', timeout,
      maxBuffer: MAX_TEXT_FILE_BYTES + 1,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }
}

async function run(workingDirectory: string, args: string[], timeout = 10_000): Promise<string> {
  try {
    const { stdout } = await exec('git', args, {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message || 'Git command failed.');
  }
}
