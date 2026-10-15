import { constants, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';

/** Only a native file chooser can persist an executable; never read it from a project. */
export class ClangdSettings {
  constructor(private readonly file: string) {}
  executable(): string {
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8')).executable;
      if (typeof saved === 'string' && path.isAbsolute(saved)) return saved;
    } catch { /* Default to the user's environment on first launch. */ }
    return process.env.SETDOWN_CLANGD_PATH || 'clangd';
  }
  async set(executable: string): Promise<void> {
    if (!path.isAbsolute(executable) || !(await stat(executable)).isFile()) throw new Error('Select a clangd executable file.');
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ executable }));
    renameSync(this.file + '.tmp', this.file);
  }
}
