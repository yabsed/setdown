import { app, type AuthInfo, type AuthenticationResponseDetails, type WebContents, type Event } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ExtensionHostBridge } from './host-bridge';
import type { ExtensionPermissions } from './extension-permissions';

type Reply = (username?: string, password?: string) => void;
/** Credentials are requested only for the controlling extension's configured
 * proxy and a verifiable browser-profile WebContents. Electron reports null
 * contents/pid=0 for worker-origin requests; those must not borrow credentials
 * from an arbitrary profile. No credential is written to disk or logs. */
export class ExtensionProxyAuth {
  private pending = new Map<string, { owner: string; reply: Reply; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly host: ExtensionHostBridge, private readonly permissions: ExtensionPermissions,
    private readonly controller: (host: string, port: number) => string | undefined) {
    host.handle('proxy.authResponse', ({ extension }, token: string, response: { cancel?: boolean; authCredentials?: { username?: unknown; password?: unknown } } = {}) => {
      const pending = this.pending.get(token);
      if (!pending || pending.owner !== extension.id) throw Error('Unknown proxy authentication request.');
      const credentials = response?.authCredentials;
      if (credentials && (typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || credentials.username.length > 4096 || credentials.password.length > 4096)) throw Error('Invalid proxy credentials.');
      this.pending.delete(token); clearTimeout(pending.timer);
      pending.reply(response.cancel ? undefined : credentials?.username as string | undefined, response.cancel ? undefined : credentials?.password as string | undefined);
    });
    app.on('login', (event, contents, details, auth, callback) => { this.request(event, contents, details, auth, callback); });
    host.session.extensions.on('extension-unloaded', (_event, extension) => this.cancel(extension.id));
  }
  cancel(owner?: string): void {
    for (const [token, pending] of this.pending) if (!owner || pending.owner === owner) {
      this.pending.delete(token); clearTimeout(pending.timer); pending.reply();
    }
  }
  request(event: Event, contents: WebContents | null, details: AuthenticationResponseDetails, auth: AuthInfo, reply: Reply): boolean {
    if (!auth.isProxy || !contents || contents.session !== this.host.session) return false;
    if (event.defaultPrevented) return true;
    const id = this.controller(auth.host, auth.port), extension = id && this.host.session.extensions.getExtension(id);
    if (!extension || !this.permissions.has(extension, 'webRequest') || !(this.permissions.has(extension, 'webRequestAuthProvider') || this.permissions.has(extension, 'webRequestBlocking'))) return false;
    event.preventDefault();
    if (!details.firstAuthAttempt) { reply(); return true; }
    const token = randomUUID();
    const timer = setTimeout(() => { this.pending.delete(token); reply(); }, 10_000); timer.unref();
    this.pending.set(token, { owner: extension.id, reply, timer });
    this.host.emit(extension.id, 'setdown.proxyAuthRequired', { requestId: token, url: details.url, isProxy: true,
      challenger: { host: auth.host, port: auth.port }, scheme: auth.scheme, realm: auth.realm,
      tabId: this.host.tabs().some(tab => tab === contents) ? contents.id : -1, frameId: 0, parentFrameId: -1,
      timeStamp: Date.now(), type: details.isRequestForNavigation ? 'main_frame' : 'xmlhttprequest', statusCode: 407 }, token);
    return true;
  }
}
