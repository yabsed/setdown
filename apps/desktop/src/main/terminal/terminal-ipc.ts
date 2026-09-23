import { app } from 'electron';
import type { WindowIpc } from '../ipc/window-ipc';
import type { TerminalSize } from '../../protocol/terminal';
import { launchDirectory, TerminalManager } from './terminal-manager';

function documentsDirectory(): string | null {
  try { return app.getPath('documents'); } catch { return null; }
}

export function installTerminalIpc(channels: WindowIpc): TerminalManager {
  const terminals = new TerminalManager();
  const owners = new Set<number>();
  channels.handle('terminal:create', (state, id: string, size: TerminalSize) => {
    const owner = state.webContentsId;
    const contents = state.window.webContents;
    if (!owners.has(owner)) {
      owners.add(owner);
      contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { terminals.closeOwner(owner); contents.setIgnoreMenuShortcuts(false); }
      });
      contents.once('destroyed', () => { terminals.closeOwner(owner); owners.delete(owner); });
    }
    return terminals.create(owner, id, size,
      launchDirectory(state.projectRoot, state.activeRoot, documentsDirectory()), (event) => {
      if (!contents.isDestroyed()) contents.send('terminal:event', event);
    });
  });
  channels.on('terminal:write', (state, id: string, data: string) => terminals.write(state.webContentsId, id, data));
  channels.on('terminal:resize', (state, id: string, size: TerminalSize) => terminals.resize(state.webContentsId, id, size));
  channels.on('terminal:ack', (state, id: string, length: number) => terminals.acknowledge(state.webContentsId, id, length));
  channels.on('terminal:close', (state, id: string) => terminals.close(state.webContentsId, id));
  channels.on('terminal:focus', (state, focused: boolean) => state.window.webContents.setIgnoreMenuShortcuts(focused === true));
  return terminals;
}
