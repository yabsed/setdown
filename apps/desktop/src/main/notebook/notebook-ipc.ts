import { app, dialog } from 'electron';
import path from 'node:path';
import type { NotebookRun } from '../../protocol/notebook';
import type { WindowIpc } from '../ipc/window-ipc';
import { NotebookKernelManager, validateNotebookRun } from './kernel-manager';

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
  channels.handle('notebook:choose-python', async state => {
    const result = await dialog.showOpenDialog(state.window, { title: 'Choose Python with ipykernel installed', properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  app.once('before-quit', () => manager.dispose());
}
