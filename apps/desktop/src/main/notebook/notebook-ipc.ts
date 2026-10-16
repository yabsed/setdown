import { NotebookTools } from './notebook-tools';
import type { BrowserManager } from '../browser/browser-manager';
import { app, clipboard, dialog } from 'electron';
import path from 'node:path';
import os from 'node:os';
import type { NotebookRun, NotebookTool } from '../../protocol/notebook';
import type { WindowIpc } from '../ipc/window-ipc';
import { NotebookKernelManager, validateNotebookRun } from './kernel-manager';
import { notebookPython } from './python-environments';
import type { WindowState } from '../windows/window-state';

export function installNotebookIpc(channels: WindowIpc, browsers: BrowserManager): void {
  const tools = new NotebookTools();
  const bridge = path.join(__dirname, 'kernel-bridge.py').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const manager = new NotebookKernelManager(bridge), watched = new Set<number>();
  channels.handle('notebook:run', (state, request: NotebookRun) => {
    validateNotebookRun(request);
    if (!(state.currentDocument?.path === request.path || state.rendererTabs.some(tab => tab.path === request.path)))
      throw Error('Only an open notebook in this window can execute cells.');
    const contents = state.window.webContents, owner = state.webContentsId;
    watch(state);
    return manager.run(owner, request, event => { if (!contents.isDestroyed()) contents.send('notebook:kernel-event', event); });
  });
  channels.handle('notebook:interrupt', (state, id: string, generation: string) => manager.interrupt(state.webContentsId, id, generation));
  channels.handle('notebook:shutdown', (state, id: string, generation: string) => manager.stop(state.webContentsId, id, generation));
  channels.handle('notebook:input', (state, id: string, generation: string, request: string, value: string) => manager.input(state.webContentsId, id, generation, request, value));
  channels.handle('notebook:inspect', (state, id: string, generation: string, request: string, name?: string, offset?: number) => manager.inspect(state.webContentsId, id, generation, request, name, offset));
  const watch = (state: WindowState) => {
    const owner = state.webContentsId, contents = state.window.webContents;
    if (watched.has(owner)) return; watched.add(owner);
    contents.once('destroyed', () => { watched.delete(owner); manager.disposeOwner(owner); tools.disposeOwner(owner); });
    contents.on('render-process-gone', () => { manager.disposeOwner(owner); tools.disposeOwner(owner); });
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { manager.disposeOwner(owner); tools.disposeOwner(owner); } });
  };
  const owns = (state: WindowState, file: string) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.ipynb$/i.test(file)
      || !(state.currentDocument?.path === file || state.rendererTabs.some(tab => tab.path === file))) throw Error('Notebook is not open in this window.');
    watch(state);
  };
  channels.handle('notebook:resolve-trace-file', (state, file: string, target: string) => {
    owns(state, file); if (typeof target !== 'string' || target.length > 4096 || target.includes('\0')) throw Error('Invalid traceback path.');
    return target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : path.resolve(path.dirname(file), target);
  });
  channels.handle('notebook:cancel-tools', (state, file: string) => { owns(state, file); tools.disposeOwner(state.webContentsId); });
  channels.handle('notebook:python-cells', (state, file: string, source: string) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.py$/i.test(file) || !(state.currentDocument?.path === file || state.rendererTabs.some(tab => tab.path === file))) throw Error('Python file is not open in this window.');
    watch(state); return tools.pythonCells(state, file, source);
  });
  channels.handle('notebook:save-image', (state, file: string, mime: string, data: string) => { owns(state, file); return tools.image(state, file, mime, data); });
  channels.handle('notebook:tool', async (state, file: string, source: string, action: NotebookTool) => {
    owns(state, file); const result = await tools.tool(state, file, source, action);
    if (result.url) await browsers.openLink(state.webContentsId, result.url); return result;
  });
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
  app.once('will-quit', () => { manager.dispose(); tools.dispose(); notebookPython.dispose(); });
}
