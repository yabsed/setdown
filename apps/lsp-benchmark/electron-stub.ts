// Stands in for Electron's main-process module when lib/product.mjs bundles the language
// manager. The manager asks Electron for a settings folder and for channels to answer on;
// the benchmark answers both, so the product code runs unchanged without a window.
import os from 'node:os';

type Handler = (...args: any[]) => any;
export const handles = new Map<string, Handler>();
export const listeners = new Map<string, Handler>();
export const lifecycle = new Map<string, Handler>();
let userData = '';
let finished: () => void = () => {};
/** Resolves when the manager has stopped every tool and asks the application to quit. */
export const stopped = new Promise<void>(resolve => { finished = resolve; });
export function useProfile(directory: string): void { userData = directory; }

export const app = {
  isPackaged: false,
  getPath(name: string): string {
    if (name === 'userData') { if (!userData) throw Error('No benchmark profile was set.'); return userData; }
    if (name === 'home') return os.homedir();
    throw Error(`The benchmark has no path named ${name}.`);
  },
  on(event: string, handler: Handler): void { lifecycle.set(event, handler); },
  quit(): void { finished(); },
};
export const ipcMain = {
  handle(channel: string, handler: Handler): void { handles.set(channel, handler); },
  on(channel: string, handler: Handler): void { listeners.set(channel, handler); },
};
export const shell = { async openExternal(): Promise<void> {} };
/** Nobody is there to pick a file: every chooser is cancelled. */
/** The file a person would pick in the next "Choose program…" dialog; none means they cancel. */
let picked: string | undefined;
export function pick(file: string | undefined): void { picked = file; }
export const dialog = { async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
  const file = picked; picked = undefined;
  return file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
} };
