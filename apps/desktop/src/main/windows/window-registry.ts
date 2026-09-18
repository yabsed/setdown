import { BrowserWindow } from 'electron';
import type { WindowState } from './window-state';

export class WindowRegistry {
  private readonly states = new Map<number, WindowState>();
  private primaryId: number | null = null;

  get values(): IterableIterator<WindowState> {
    return this.states.values();
  }

  stateForWebContents(id: number): WindowState | null {
    return this.states.get(id) ?? null;
  }

  focused(): WindowState | null {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused && !focused.isDestroyed()
      ? this.stateForWebContents(focused.webContents.id) : null)
      ?? (this.primaryId === null ? null : this.stateForWebContents(this.primaryId))
      ?? this.states.values().next().value
      ?? null;
  }

  add(state: WindowState, primary: boolean): void {
    this.states.set(state.webContentsId, state);
    if (primary) this.primaryId = state.webContentsId;
  }

  focus(webContentsId: number): void {
    this.primaryId = webContentsId;
  }

  remove(webContentsId: number): void {
    this.states.delete(webContentsId);
    if (this.primaryId === webContentsId) {
      this.primaryId = this.states.keys().next().value ?? null;
    }
  }
}
