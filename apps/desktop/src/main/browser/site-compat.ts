import { WebContentsView, type Session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { signInHeaderRules } from '../../core/browser/user-agent';

const FILES: Record<string, string> = {
  'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Setdown site compatibility', version: '1.0',
    description: 'Sends a Firefox user agent to sign-in pages that refuse embedded Chromium.',
    permissions: ['declarativeNetRequest'], host_permissions: ['<all_urls>'] }),
  'rules.html': '<!doctype html><meta charset="utf-8"><title>Setdown site compatibility</title>',
};

/**
 * Google refuses sign-in from embedded Chromium and accepts Firefox (Min's
 * UASwitcher). A session webRequest listener would switch off every extension's
 * request rules, uBlock's included, so the header is rewritten by a
 * declarativeNetRequest session rule of a built-in extension that has no code.
 * Electron applies dynamic and session rules but not static rule files, and
 * session rules are rebuilt on each launch with the current Firefox version.
 */
export class SiteCompatibility {
  private started?: Promise<void>;
  constructor(private readonly directory: string) {}

  start(session: Session): Promise<void> {
    this.started ??= this.install(session).catch(error => { this.started = undefined; throw error; });
    return this.started;
  }

  private async install(session: Session): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    for (const [name, content] of Object.entries(FILES)) {
      const file = path.join(this.directory, name);
      if (await fs.readFile(file, 'utf8').catch(() => null) !== content) await fs.writeFile(file, content);
    }
    const extension = session.extensions.getAllExtensions().find(item => item.path === this.directory)
      ?? await session.extensions.loadExtension(this.directory);
    const view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const contents = view.webContents;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rules = signInHeaderRules(process.platform, Date.now());
      await Promise.race([
        contents.loadURL(`chrome-extension://${extension.id}/rules.html`).then(() => contents.executeJavaScript(
          `chrome.declarativeNetRequest.updateSessionRules(${JSON.stringify({ removeRuleIds: rules.map(rule => rule.id), addRules: rules })}).then(() => true)`)),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Site compatibility rules did not start.')), 10_000); }),
      ]);
    } finally {
      clearTimeout(timer);
      if (!contents.isDestroyed()) contents.close();
    }
  }
}
