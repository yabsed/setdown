import { randomUUID } from 'node:crypto';
import type { BrowserAuthRequest } from '../../protocol/browser';

type Challenge = { owner: number; request: BrowserAuthRequest; callback: (username?: string, password?: string) => void;
  timer: ReturnType<typeof setTimeout> };
/** Credentials live only in the submitted IPC and Chromium's auth cache. Each
 * callback belongs to one page/challenge, never a global "current login". */
export class BrowserAuth {
  private readonly pending = new Map<string, Challenge>();
  constructor(private readonly changed: (owner: number, id: string, request: BrowserAuthRequest | null) => void) {}
  request(owner: number, id: string, url: string, info: Electron.AuthInfo, callback: Challenge['callback']) {
    if (info.isProxy || !/^https?:\/\//i.test(url) || !['basic', 'digest'].includes(info.scheme.toLowerCase()) || this.pending.has(id)) { callback(); return; }
    const request = { token: randomUUID(), origin: new URL(url).origin, realm: info.realm.slice(0, 200) };
    const timer = setTimeout(() => this.clear(id), 120_000); timer.unref();
    this.pending.set(id, { owner, request, callback, timer }); this.changed(owner, id, request);
  }
  respond(owner: number, id: string, token: string, credentials: { username: string; password: string } | null) {
    const challenge = this.pending.get(id);
    if (!challenge || challenge.owner !== owner || challenge.request.token !== token) return;
    if (credentials && (typeof credentials.username !== 'string' || typeof credentials.password !== 'string'
      || credentials.username.length > 4096 || credentials.password.length > 4096)) return;
    this.pending.delete(id); clearTimeout(challenge.timer); this.changed(owner, id, null);
    challenge.callback(credentials?.username, credentials?.password);
  }
  clear(id: string) { const challenge = this.pending.get(id); if (challenge) this.respond(challenge.owner, id, challenge.request.token, null); }
}
