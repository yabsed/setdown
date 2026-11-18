// Bundled by lib/product.mjs. The benchmark opens a file the way a Setdown window does:
// through the language manager's own channels. Which tool starts, where its program comes
// from, what it is told and what it answers are all the product's decisions.
import { EventEmitter } from 'node:events';
import { LanguageManager } from '../desktop/src/main/language/language-manager';
import { handles, listeners, lifecycle, pick, stopped, useProfile } from './electron-stub';
export { supportedLanguages } from '../desktop/src/core/document/supported-languages';

export type Received = { at: number; event: { type: string; [key: string]: unknown } };

/** One Setdown main process whose settings and downloaded tools live in `profile`. */
export function start(profile: string) {
  useProfile(profile);
  const states = new Map<number, unknown>();
  new LanguageManager(id => (states.get(id) ?? null) as never).install();
  let windows = 0;
  return {
    /** A window with one project folder and the files a person has open in it. */
    window(root: string, files: string[]) {
      const id = ++windows, received: Received[] = [];
      const contents = Object.assign(new EventEmitter(), { id, mainFrame: {}, isDestroyed: () => false,
        send(channel: string, event: Received['event']) { if (channel === 'language:event') received.push({ at: Date.now(), event }); } });
      states.set(id, { webContentsId: id, projectRoot: root, currentDocument: { path: files[0] },
        rendererTabs: files.map(file => ({ path: file, isUntitled: false })), window: { webContents: contents, isDestroyed: () => false } });
      const sender = { sender: contents, senderFrame: contents.mainFrame };
      return { received,
        invoke: (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handles.get(`language:${channel}`)!(sender, ...args)),
        send: (channel: string, ...args: unknown[]) => { listeners.get(`language:${channel}`)!(sender, ...args); } };
    },
    /** What the person picks when Setdown next asks for a program file. */
    pick,
    /** Stops every tool the way quitting the application does. */
    async stop() {
      let waits = false;
      lifecycle.get('will-quit')?.({ preventDefault() { waits = true; } });
      if (waits) await stopped;
    },
  };
}
