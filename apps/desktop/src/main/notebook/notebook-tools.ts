import { app, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import type { WindowState } from '../windows/window-state';
import type { NotebookTool } from '../../protocol/notebook';
import { notebookPython } from './python-environments';

const packages = ['jupyterlab>=4.4,<5', 'nbdime>=4,<5', 'nbconvert[webpdf]>=7.16,<8', 'jupytext>=1.17,<2', 'ruff>=0.12,<1', 'ipywidgets>=8,<9', 'plotly>=6,<7', 'anywidget>=0.9,<1'];
/** External tools run on an explicit command, never when a file is opened. */
export class NotebookTools {
  private owners = new Map<ChildProcess, number>();
  private children = new Set<ChildProcess>();
  private folders = new Set<string>();
  private installing?: Promise<void>;
  private labs = new Map<string, { url: string; child: ChildProcess }>();
  private get root() { return path.join(app.getPath('userData'), 'notebook-tools'); }
  private get environment(): NodeJS.ProcessEnv {
    const base = app.getPath('userData');
    return { ...process.env, JUPYTER_CONFIG_DIR: path.join(base, 'notebook-config'), JUPYTER_DATA_DIR: path.join(base, 'notebook-data'), JUPYTER_RUNTIME_DIR: path.join(base, 'notebook-runtime') };
  }
  private get python() { return path.join(this.root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'); }
  private execute(executable: string, args: string[], input?: string, timeout = 120_000, cwd = os.tmpdir(), owner?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd, env: this.environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); this.children.add(child); if (owner !== undefined) this.owners.set(child, owner);
      let out = '', err = '', failed = false;
      const fail = (error: Error) => { if (!failed) { failed = true; child.kill(); reject(error); } };
      const timer = setTimeout(() => fail(Error('Notebook tool timed out.')), timeout);
      child.stdout!.on('data', data => { out += data; if (out.length > 64 * 1024 * 1024) fail(Error('Tool output exceeds 64 MiB.')); });
      child.stderr!.on('data', data => { err = (err + data).slice(-8000); });
      child.on('error', fail); child.stdin!.on('error', () => {}); child.stdin!.end(input);
      child.once('close', code => { clearTimeout(timer); this.children.delete(child); this.owners.delete(child); if (!failed) code === 0 ? resolve(out) : reject(Error(err || `Notebook tool exited (${code}).`)); });
    });
  }
  async install(file: string, owner: number): Promise<void> {
    if (this.installing) return this.installing;
    this.installing = (async () => {
      const { python } = await notebookPython.resolve(file); if (!python) throw Error('Select a Python environment first.');
      await this.execute(python, ['-E', '-m', 'venv', this.root], undefined, 120_000, os.tmpdir(), owner);
      await this.execute(this.python, ['-I', '-m', 'pip', 'install', ...packages], undefined, 900_000, os.tmpdir(), owner);
    })().finally(() => { this.installing = undefined; });
    return this.installing;
  }
  private async ready() {
    try { await fs.access(this.python); } catch { throw Error('Choose “Install notebook tools” once to install JupyterLab, nbconvert, nbdime, Jupytext and Ruff in Setdown’s separate environment.'); }
  }
  async pythonCells(state: WindowState, file: string, source: string): Promise<string | null> {
    if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) throw Error('Python source exceeds 4 MiB.');
    await this.ready();
    const destination = await dialog.showSaveDialog(state.window, { title: 'Create interactive notebook from Python cells', defaultPath: file.replace(/\.py$/i, '-interactive.ipynb'), filters: [{ name: 'Jupyter notebook', extensions: ['ipynb'] }] });
    if (destination.canceled || !destination.filePath) return null;
    if (!/\.ipynb$/i.test(destination.filePath)) throw Error('Choose an .ipynb file.');
    const text = await this.execute(this.python, ['-I', '-m', 'jupytext', '--from', 'py:percent', '--to', 'ipynb', '-'], source, 120_000, os.tmpdir(), state.webContentsId);
    JSON.parse(text); await fs.writeFile(destination.filePath, text); return destination.filePath;
  }
  async image(state: WindowState, file: string, mime: string, data: string): Promise<string | null> {
    const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
    if (!extensions[mime] || typeof data !== 'string' || data.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Error('Invalid image output.');
    const bytes = Buffer.from(data, 'base64');
    const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : mime === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!valid) throw Error('Image bytes do not match the selected format.');
    const result = await dialog.showSaveDialog(state.window, { title: 'Save notebook image', defaultPath: file.replace(/\.ipynb$/i, `-plot.${extensions[mime]}`), filters: [{ name: mime, extensions: [extensions[mime]] }] });
    if (result.canceled || !result.filePath) return null;
    if (path.resolve(result.filePath) === path.resolve(file)) throw Error('Choose a destination other than the notebook.');
    await fs.writeFile(result.filePath, bytes); return result.filePath;
  }
  private async folder() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')); this.folders.add(dir); return dir; }
  private async remove(dir: string) { this.folders.delete(dir); await fs.rm(dir, { recursive: true, force: true }); }
  private server(args: string[], match: RegExp, cwd: string, owner: number): Promise<{ url: string; child: ChildProcess }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ['-I', ...args], { cwd, env: this.environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); this.children.add(child); if (owner !== undefined) this.owners.set(child, owner);
      let log = '', settled = false;
      const timer = setTimeout(() => { child.kill(); reject(Error('Notebook server did not become ready within 60 seconds.')); }, 60_000);
      const data = (chunk: Buffer) => { log = (log + chunk).slice(-10000); const found = match.exec(log); if (found && !settled) { settled = true; clearTimeout(timer); resolve({ url: found[0].replace(/\/$/, ''), child }); } };
      child.stdout!.on('data', data); child.stderr!.on('data', data);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); this.children.delete(child); this.owners.delete(child); if (!settled) reject(Error('Notebook server could not start. Check the installed notebook tools.')); });
    });
  }
  async tool(state: WindowState, file: string, source: string, action: NotebookTool): Promise<{ path?: string; source?: string; url?: string; message?: string }> {
    if (typeof source !== 'string' || source.length > 64 * 1024 * 1024) throw Error('Notebook snapshot exceeds 64 MiB.');
    const execute = (executable: string, args: string[], input?: string, timeout = 120_000, cwd = os.tmpdir()) => this.execute(executable, args, input, timeout, cwd, state.webContentsId);
    const notebook = JSON.parse(source); if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) throw Error('Invalid notebook snapshot.');
    if (action === 'install-tools') { await this.install(file, state.webContentsId); return { message: 'Notebook tools installed in Setdown’s separate Python environment.' }; }
    await this.ready();
    if (action === 'fix-code') return { source: await execute(this.python, ['-I', '-m', 'ruff', 'check', '--isolated', '--fix-only', '--exit-zero', '--stdin-filename', 'notebook.ipynb', '-'], source) };
    if (action === 'format') return { source: await execute(this.python, ['-I', '-m', 'ruff', 'format', '--isolated', '--stdin-filename', 'notebook.ipynb', '-'], source) };
    if (action === 'jupyterlab') {
      if (await fs.readFile(file, 'utf8') !== source) throw Error('Save this notebook before opening JupyterLab. JupyterLab edits the saved file and uses its own kernel.');
      const selected = await notebookPython.resolve(file);
      if (selected.python) {
        const name = 'setdown-' + Buffer.from(selected.python).toString('hex').slice(-64), dir = path.join(this.environment.JUPYTER_DATA_DIR!, 'kernels', name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'kernel.json'), JSON.stringify({ argv: [selected.python, '-m', 'ipykernel_launcher', '-f', '{connection_file}'], display_name: `Setdown · ${selected.python}`, language: 'python' }));
      }
      const root = path.dirname(file), key = `${state.webContentsId}:${root}`;
      let server = this.labs.get(key);
      if (!server || server.child.exitCode !== null || server.child.killed) {
        const token = randomUUID().replaceAll('-', '');
        server = await this.server(['-m', 'jupyterlab', '--no-browser', '--ServerApp.ip=127.0.0.1', '--ServerApp.port=0', `--ServerApp.root_dir=${root}`, `--IdentityProvider.token=${token}`], /http:\/\/127\.0\.0\.1:\d+\/lab/, os.tmpdir(), state.webContentsId);
        server.url = server.url + `?token=${token}`; this.labs.set(key, server);
      }
      const url = new URL(server.url); url.pathname = '/lab/tree/' + encodeURIComponent(path.basename(file)); return { url: url.href };
    }
    const dir = await this.folder();
    let retained = false;
    try {
      const snapshot = path.join(dir, 'notebook.ipynb'); await fs.writeFile(snapshot, source);
      if (action === 'diff') {
        const root = (await execute('git', ['rev-parse', '--show-toplevel'], undefined, 15_000, path.dirname(file))).trim();
        const relative = path.relative(root, file).split(path.sep).join('/');
        const base = await execute('git', ['show', `HEAD:${relative}`], undefined, 15_000, root);
        const baseFile = path.join(dir, 'HEAD.ipynb'); await fs.writeFile(baseFile, base);
        const prefix = '/' + randomUUID().replaceAll('-', '');
        const script = "import sys; from nbdime.webapp.nbdimeserver import main_server; main_server(port=0, ip='127.0.0.1', cwd=sys.argv[1], base_url=sys.argv[2], difftool_args=dict(base=sys.argv[3], remote=sys.argv[4]), on_port=lambda port: print('http://127.0.0.1:%s%s/difftool' % (port,sys.argv[2]), flush=True))";
        const server = await this.server(['-u', '-c', script, dir, prefix, baseFile, snapshot], /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/difftool/, dir, state.webContentsId);
        retained = true; server.child.once('close', () => { void this.remove(dir); }); return { url: server.url };
      }
      const format = ({ 'export-html': 'html', 'export-markdown': 'markdown', 'export-script': 'script', 'export-webpdf': 'webpdf' } as Record<string, string>)[action];
      if (!format) throw Error('Unsupported notebook action.');
      const extension = format === 'webpdf' ? 'pdf' : format === 'markdown' ? 'md' : format === 'script' ? (notebook.metadata?.language_info?.file_extension?.replace(/^\./, '') || 'py') : 'html';
      const destination = await dialog.showSaveDialog(state.window, { title: `Export notebook as ${format}`, defaultPath: file.replace(/\.ipynb$/i, '.' + extension) });
      if (destination.canceled || !destination.filePath) return {};
      if (path.resolve(destination.filePath) === path.resolve(file)) throw Error('Export cannot overwrite the notebook.');
      await execute(this.python, ['-I', '-m', 'nbconvert', '--to', format, '--output', 'export', '--output-dir', dir, ...(format === 'webpdf' ? ['--allow-chromium-download'] : []), snapshot], undefined, 300_000);
      const names = await fs.readdir(dir), result = names.find(name => name.startsWith('export.') && name !== 'export.ipynb');
      if (!result) throw Error('The exporter did not produce a file.');
      // Markdown references its resource directory by name. Copy it beside the chosen file.
      const resource = path.join(dir, 'export_files');
      if (names.includes('export_files')) {
        const resourceName = path.basename(destination.filePath, path.extname(destination.filePath)) + '_files';
        const resourceTarget = path.join(path.dirname(destination.filePath), resourceName);
        try { await fs.access(resourceTarget); throw Error(`Resource folder already exists: ${resourceTarget}. Choose a different export name.`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await fs.cp(resource, resourceTarget, { recursive: true, errorOnExist: true, force: false });
        const text = (await fs.readFile(path.join(dir, result), 'utf8')).replaceAll('export_files/', resourceName + '/'); await fs.writeFile(destination.filePath, text);
      } else await fs.copyFile(path.join(dir, result), destination.filePath);
      return { path: destination.filePath };
    } finally {
      // Diff owns its files until its server exits; other tools are short lived.
      if (!retained) await this.remove(dir);
    }
  }
  disposeOwner(owner: number) { for (const [child, ownerId] of this.owners) if (ownerId === owner) child.kill(); for (const [key, server] of this.labs) if (key.startsWith(owner + ':')) { server.child.kill(); this.labs.delete(key); } }
  dispose() { for (const child of this.children) child.kill(); for (const dir of this.folders) void this.remove(dir); }
}
