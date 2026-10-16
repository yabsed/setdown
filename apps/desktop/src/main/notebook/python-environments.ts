import { app } from 'electron';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { executableFile, ServerDiscovery } from '../language/server-discovery';
import type { NotebookEnvironments } from '../../protocol/notebook';

/** Metadata-only discovery. A notebook's kernelspec never supplies a command. */
export class PythonEnvironments {
  private discovery?: ServerDiscovery;
  private choices?: Record<string, string>;
  private get file(): string { return path.join(app.getPath('userData'), 'notebook-python.json'); }
  private load(): Record<string, string> {
    if (!this.choices) {
      this.choices = {};
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        if (data.version === 1 && data.files && typeof data.files === 'object')
          for (const [file, python] of Object.entries(data.files)) if (path.isAbsolute(file) && typeof python === 'string' && path.isAbsolute(python)) this.choices[file] = python;
      } catch { /* No saved environment yet; discovery remains available. */ }
    }
    return this.choices;
  }
  async list(file: string): Promise<NotebookEnvironments> {
    const discovery = this.discovery ??= new ServerDiscovery();
    const found = await discovery.find(process.platform === 'win32' ? 'python' : 'python3', { resolveEnvironment: true });
    const choices = this.load(), candidates: NotebookEnvironments['candidates'] = [];
    const add = async (python: string | undefined, source: string, name?: string) => {
      if (python && !candidates.some(item => item.path === python) && await executableFile(python))
        candidates.push({ path: python, source, name: name ?? path.basename(path.dirname(path.dirname(python))) });
    };
    const executable = (root: string) => path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    await add(choices[file], 'Saved');
    for (let root = path.dirname(file), depth = 0; depth < 4; depth++, root = path.dirname(root)) {
      for (const name of ['.venv', 'venv']) await add(executable(path.join(root, name)), 'Project', name);
      if (path.dirname(root) === root) break;
    }
    for (const key of ['VIRTUAL_ENV', 'CONDA_PREFIX']) {
      const root = found.environment.env[key]; if (root) await add(key === 'CONDA_PREFIX' && process.platform === 'win32' ? path.join(root, 'python.exe') : executable(root), key === 'VIRTUAL_ENV' ? 'Virtual environment' : 'Conda');
    }
    for (const candidate of found.candidates) await add(candidate.path, 'PATH', `Python · ${path.basename(path.dirname(candidate.path))}`);
    // Project-local executables are offered for explicit selection, never launched by discovery.
    // Never silently replace an explicitly selected environment that disappeared.
    return { selected: choices[file] ?? found.selected?.path, candidates };
  }
  async select(file: string, python: string): Promise<void> {
    if (!path.isAbsolute(file) || !/\.ipynb$/i.test(file) || !path.isAbsolute(python) || !await executableFile(python))
      throw Error('Choose an existing Python executable.');
    const files = { ...this.load() }; delete files[file]; files[file] = python;
    while (Object.keys(files).length > 500) delete files[Object.keys(files)[0]];
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, files }, null, 2) + '\n');
    renameSync(this.file + '.tmp', this.file); this.choices = files;
  }
  async resolve(file: string, explicit?: string): Promise<{ python?: string; env: NodeJS.ProcessEnv }> {
    const list = await this.list(file), python = explicit ?? list.selected;
    if (python && !await executableFile(python)) throw Error('The selected Python environment is missing. Choose another environment.');
    return { python, env: this.discovery!.environment.peek().env };
  }
  dispose(): void { this.discovery?.dispose(); this.discovery = undefined; }
}
export const notebookPython = new PythonEnvironments();
