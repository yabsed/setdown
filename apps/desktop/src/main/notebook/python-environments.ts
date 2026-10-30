import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { executableFile, ServerDiscovery } from '../language/server-discovery';
import type { NotebookEnvironments } from '../../protocol/notebook';
import { analysisPreferences } from '../language/analysis-preferences';

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
  async list(file: string, boundary?: string): Promise<NotebookEnvironments> {
    const discovery = this.discovery ??= new ServerDiscovery();
    const found = await discovery.find(process.platform === 'win32' ? 'python' : 'python3', { resolveEnvironment: true });
    const choices = this.load(), candidates: NotebookEnvironments['candidates'] = [];
    const add = async (python: string | undefined, source: string, name?: string) => {
      if (python && !candidates.some(item => item.path === python) && await executableFile(python))
        candidates.push({ path: python, source, name: name ?? path.basename(path.dirname(path.dirname(python))) });
    };
    const executable = (root: string) => path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const project = analysisPreferences.pythonFor(file);
    await add(choices[file], 'Notebook override');
    await add(project, 'Project selection');
    for (let root = path.dirname(file), depth = 0; depth < (boundary ? 64 : 4); depth++, root = path.dirname(root)) {
      for (const name of ['.venv', 'venv']) await add(executable(path.join(root, name)), 'Project', name);
      if (path.dirname(root) === root || root === boundary) break;
    }
    for (const key of ['VIRTUAL_ENV', 'CONDA_PREFIX']) {
      const root = found.environment.env[key]; if (root) await add(key === 'CONDA_PREFIX' && process.platform === 'win32' ? path.join(root, 'python.exe') : executable(root), key === 'VIRTUAL_ENV' ? 'Virtual environment' : 'Conda');
    }
    for (const candidate of found.candidates) await add(candidate.path, 'PATH', `Python · ${path.basename(path.dirname(candidate.path))}`);
    // Enumerate installed environments from local metadata; never run conda or a kernelspec command.
    try {
      const roots = (await fs.readFile(path.join(os.homedir(), '.conda', 'environments.txt'), 'utf8')).split(/\r?\n/).filter(root => path.isAbsolute(root)).slice(0, 100);
      for (const root of roots) await add(process.platform === 'win32' ? path.join(root, 'python.exe') : executable(root), 'Conda', path.basename(root));
    } catch { /* Conda is optional. */ }
    const kernelRoots = new Set([path.join(os.homedir(), '.local/share/jupyter/kernels'), path.join(os.homedir(), 'Library/Jupyter/kernels'),
      '/usr/share/jupyter/kernels', '/usr/local/share/jupyter/kernels',
      ...candidates.map(item => path.join(path.dirname(path.dirname(item.path)), 'share/jupyter/kernels'))]);
    if (process.env.APPDATA) kernelRoots.add(path.join(process.env.APPDATA, 'jupyter/kernels'));
    for (const root of (found.environment.env.JUPYTER_PATH ?? '').split(path.delimiter).filter(Boolean)) kernelRoots.add(path.join(root, 'kernels'));
    for (const root of kernelRoots) {
      try {
        for (const name of (await fs.readdir(root)).slice(0, 100)) {
          try {
            const specFile = path.join(root, name, 'kernel.json'); if ((await fs.stat(specFile)).size > 64 * 1024) continue;
            const spec = JSON.parse(await fs.readFile(specFile, 'utf8'));
            // Only discover the executable. Ignore all spec flags, env and launch commands.
            if (spec.language === 'python' && typeof spec.argv?.[0] === 'string' && path.isAbsolute(spec.argv[0]) && /^python(?:[0-9.]+)?(?:\.exe)?$/i.test(path.basename(spec.argv[0])))
              await add(spec.argv[0], 'Jupyter kernel', typeof spec.display_name === 'string' ? spec.display_name : name);
          } catch { /* Missing/invalid spec is not a Python environment. */ }
        }
      } catch { /* No registered kernels at this prefix. */ }
    }
    // Project-local executables are offered for explicit selection, never launched by discovery.
    // Never silently replace an explicitly selected environment that disappeared.
    return { selected: choices[file] ?? project ?? found.selected?.path, candidates };
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
