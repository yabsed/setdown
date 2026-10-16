import { app, clipboard, dialog } from 'electron';
import path from 'node:path';
import type { NotebookRun } from '../../protocol/notebook';
import type { WindowIpc } from '../ipc/window-ipc';
import { NotebookKernelManager, validateNotebookRun } from './kernel-manager';
import { notebookPython } from './python-environments';
import type { WindowState } from '../windows/window-state';

export function installNotebookIpc(channels: WindowIpc): void {
  const bridge = path.join(__dirname, 'kernel-bridge.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const manager = new NotebookKernelManager(bridge), watched = new Set<number>();
  channels.handle('notebook:run', (state, request: NotebookRun) => {
    validateNotebookRun(request);
    if (!(state.currentDocument?.path === request.path || state.rendererTabs.some(tab => tab.path === request.path)))
      throw Error('Only an open notebook in this window can execute cells.');
    const contents = state.window.webContents, owner = state.webContentsId;
    if (!watched.has(owner)) {
      watched.add(owner);
      contents.once('destroyed', () => { watched.delete(owner); manager.disposeOwner(owner); });
      contents.on('render-process-gone', () => manager.disposeOwner(owner));
      contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) manager.disposeOwner(owner); });
    }
    return manager.run(owner, request, event => { if (!contents.isDestroyed()) contents.send('notebook:kernel-event', event); });
  });
  channels.handle('notebook:interrupt', (state, id: string, generation: string) => manager.interrupt(state.webContentsId, id, generation));
  channels.on('notebook:shutdown', (state, id: string, generation: string) => manager.stop(state.webContentsId, id, generation));
  const owns = (state: WindowState, file: string) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.ipynb$/i.test(file)
      || !(state.currentDocument?.path === file || state.rendererTabs.some(tab => tab.path === file))) throw Error('Notebook is not open in this window.');
  };
  channels.handle('notebook:copy-output', (state, file: string, text: string) => {
    owns(state, file);
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw Error('Output is too large to copy.');
    clipboard.writeText(text);
  });
  channels.handle('notebook:environments', async (state, file: string) => { owns(state, file); return notebookPython.list(file); });
  channels.handle('notebook:select-python', async (state, file: string, python: string) => {
    owns(state, file);
    if (!(await notebookPython.list(file)).candidates.some(candidate => candidate.path === python)) throw Error('Python environment changed. Refresh the list.');
    await notebookPython.select(file, python);
  });
  channels.handle('notebook:choose-python', async (state, file?: string) => {
    if (file) owns(state, file);
    const result = await dialog.showOpenDialog(state.window, { title: 'Choose Python with ipykernel installed', properties: ['openFile'] });
    const python = result.canceled ? null : result.filePaths[0] ?? null;
    if (python && file) await notebookPython.select(file, python);
    return python;
  });
  // before-quit is cancelable. A canceled Save/Discard prompt must retain variables.
  app.once('will-quit', () => { manager.dispose(); notebookPython.dispose(); });
}
