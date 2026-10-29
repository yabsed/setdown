import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import { readEditorPolicy } from './editor-policy';
import { SnapshotStore } from './snapshot-store';
import { pythonProjectSettings } from '../language/python-project-settings';
export function installEditorToolsIpc(channels: WindowIpc): void {
  const snapshots = new SnapshotStore(path.join(app.getPath('userData'), 'workspace-snapshots'));
  const run = randomUUID();
  function source(state: WindowState, file: unknown): string {
    if (typeof file !== 'string' || file.length > 16384 || !path.isAbsolute(file) || file.includes('\0')) throw Error('Invalid source path.');
    if (state.currentDocument?.path !== file && !state.rendererTabs.some(tab => tab.path === file)) throw Error('Open this document before inspecting its environment.');
    return file;
  }
  channels.handle('editor:policy', (state, file: unknown) => readEditorPolicy(source(state, file), state.projectRoot));
  channels.handle('editor:paths', async (state, file: unknown, prefix: unknown, modules: unknown) => {
    const sourcePath = source(state, file);
    if (typeof prefix !== 'string' || prefix.length > 4096 || prefix.includes('\0')) throw Error('Invalid path prefix.');
    let value = prefix.replace(/^file:\/\//, ''), bases = [path.dirname(sourcePath)];
    if (modules === true) {
      value = prefix.replace(/\./g, path.sep);
      if (state.projectRoot) {
        bases.push(state.projectRoot);
        const python = await pythonProjectSettings(state.projectRoot); bases.push(...(python.extraPaths ?? []));
      }
    }
    const found: Array<{ label: string; text: string; path: string; directory: boolean }> = [];
    for (const base of [...new Set(bases)]) {
      const absolute = path.resolve(base, value), directory = /[\\/]$/.test(value) ? absolute : path.dirname(absolute), needle = /[\\/]$/.test(value) ? '' : path.basename(value);
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.name.toLocaleLowerCase().startsWith(needle.toLocaleLowerCase())) continue;
          const target = path.join(directory, entry.name), isDirectory = entry.isDirectory();
          const text = path.isAbsolute(prefix) ? target : path.relative(path.dirname(sourcePath), target).split(path.sep).join('/');
          found.push({ path: target, text: (text.startsWith('.') || path.isAbsolute(prefix) ? text : `./${text}`) + (isDirectory ? '/' : ''), label: `${entry.name}${isDirectory ? '/' : ''} · ${directory}`, directory: isDirectory });
          if (isDirectory && modules === true) for (const suffix of ['__init__.py', 'index.ts', 'index.js']) try {
            const candidate = path.join(target, suffix); if ((await fs.stat(candidate)).isFile()) found.push({ path: candidate, text, label: `${entry.name}/${suffix} · ${directory}`, directory: false });
          } catch { /* No module entry. */ }
          if (found.length >= 500) return found;
        }
      } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
    return found;
  });
  channels.handle('editor:spell-language', state => {
    const session = state.window.webContents.session;
    if (process.platform !== 'darwin') session.setSpellCheckerLanguages(['en-US']);
    return session.availableSpellCheckerLanguages.includes('en-US') || process.platform === 'darwin';
  });
  channels.handle('editor:learn-word', (state, word: unknown) => {
    if (typeof word !== 'string' || !/^[a-zA-Z'-]{1,80}$/.test(word)) throw Error('Choose an English word.');
    if (!state.window.webContents.session.addWordToSpellCheckerDictionary(word)) throw Error('The spelling dictionary is unavailable.');
  });
  channels.handle('editor:snapshots-binary', async (_state, name: string, bytes: Uint8Array) => {
    if (typeof name !== 'string' || !/\.(png|jpe?g|webp|hwpx?)$/i.test(name) || !(bytes instanceof Uint8Array) || bytes.length > 24 * 1024 * 1024)
      throw Error('Invalid binary recovery document.');
    const directory = path.join(app.getPath('userData'), 'recovered-documents', randomUUID());
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `Recovered-${path.basename(name)}`);
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); return file;
  });
  channels.handle('editor:snapshots-list', () => snapshots.list());
  channels.handle('editor:snapshots-read', (_state, id: string) => snapshots.read(id));
  channels.handle('editor:snapshots-write', (state, name: string, value: unknown, recovery: unknown) => snapshots.write(name, value, recovery === true ? `recovery-${run}-${state.webContentsId}` : undefined));
  channels.handle('editor:snapshots-remove', (_state, id: string) => snapshots.remove(id));
}
