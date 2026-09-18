import { BrowserWindow } from 'electron';
import type { WindowState } from './window-state';

export class WindowRegistry {
  private readonly states = new Map<number, WindowState>();
  private mainWindow: BrowserWindow | null = null;

  get values(): IterableIterator<WindowState> {
    return this.states.values();
  }

  stateForWebContents(id: number): WindowState | null {
    return this.states.get(id) ?? null;
  }

  focused(): WindowState | null {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused ? this.stateForWebContents(focused.webContents.id) : null)
      ?? (this.mainWindow ? this.stateForWebContents(this.mainWindow.webContents.id) : null)
      ?? this.states.values().next().value
      ?? null;
  }

  add(state: WindowState, primary: boolean): void {
    this.states.set(state.window.webContents.id, state);
    if (primary) this.mainWindow = state.window;
  }

  focus(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  remove(window: BrowserWindow): void {
    this.states.delete(window.webContents.id);
    if (this.mainWindow === window) this.mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
  }
}
