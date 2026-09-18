import { ipcMain } from 'electron';
import type { WindowState } from '../windows/window-state';

export function windowIpc(stateFor: (webContentsId: number) => WindowState | null) {
  const requireState = (id: number) => {
    const state = stateFor(id);
    if (!state) throw new Error('The window no longer exists.');
    return state;
  };

  return {
    handle<Args extends unknown[], Result>(
      channel: string,
      listener: (state: WindowState, ...args: Args) => Result,
    ) {
      ipcMain.handle(channel, (event, ...args) =>
        listener(requireState(event.sender.id), ...(args as Args)));
    },
    on<Args extends unknown[]>(
      channel: string,
      listener: (state: WindowState, ...args: Args) => void,
    ) {
      ipcMain.on(channel, (event, ...args) => {
        const state = stateFor(event.sender.id);
        if (state) listener(state, ...(args as Args));
      });
    },
  };
}

export type WindowIpc = ReturnType<typeof windowIpc>;
