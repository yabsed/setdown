import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { BrowserPermissionRequest } from '../../protocol/browser';

type Page = { id: string; owner: number; contents: WebContents; visible: boolean };
type Pending = BrowserPermissionRequest & { owner: number; callbacks: Array<(allowed: boolean) => void>; timer: ReturnType<typeof setTimeout> };
type Decisions = { pending: Map<string, Pending>; allowed: Set<string>; denied: Set<string> };
const names: Record<string, string> = { notifications: 'Notifications', audio: 'Microphone', video: 'Camera', geolocation: 'Location' };
const originOf = (url: string) => { try { const urlObject = new URL(url); return /^https?:$/.test(urlObject.protocol) ? urlObject.origin : null; } catch { return null; } };

/** Page-lifetime decisions. No hostname sharing, persistent grants or background
 * service-worker grants. A pending request never opens or focuses a window. */
export class BrowserPermissions {
  private readonly pages = new Map<string, Decisions>();
  constructor(private readonly lookup: (contents: WebContents | null) => Page | undefined,
    private readonly changed: (owner: number, id: string, requests: BrowserPermissionRequest[]) => void) {}

  install(profile: Session) {
    profile.setPermissionCheckHandler((contents, permission, origin, details) => {
      const page = this.lookup(contents);
      if (!page || !this.sameOrigin(page, origin) || details.isMainFrame === false) return false;
      if (this.automatic(permission)) return page.visible;
      const keys = this.keys(permission, details.mediaType ? [details.mediaType] : undefined);
      return !!keys?.length && keys.every(key => this.pages.get(page.id)?.allowed.has(key));
    });
    profile.setPermissionRequestHandler((contents, permission, callback, details) => {
      const page = this.lookup(contents);
      if (!page) return callback(false);
      const origin = originOf(details.requestingUrl || contents.getURL());
      if (!origin || !this.sameOrigin(page, origin) || !details.isMainFrame) return callback(false);
      if (this.automatic(permission)) return callback(page.visible);
      const keys = this.keys(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
      if (!keys?.length) return callback(false);
      let state = this.pages.get(page.id);
      if (!state) { state = { pending: new Map(), allowed: new Set(), denied: new Set() }; this.pages.set(page.id, state); }
      if (keys.some(key => state.denied.has(key))) return callback(false);
      if (keys.every(key => state.allowed.has(key))) return callback(true);
      // Coalesce repeated calls without retaining an unbounded callback list.
      const key = keys.join(','), previous = state.pending.get(key);
      if (previous) { if (previous.callbacks.length < 8) previous.callbacks.push(callback); else callback(false); return; }
      if (state.pending.size >= 4) return callback(false);
      const token = randomUUID();
      const pending: Pending = { token, origin, permissions: keys, label: keys.map(key => names[key]).join(' and '),
        owner: page.owner, callbacks: [callback], timer: setTimeout(() => this.respond(page.owner, page.id, token, false), 90_000) };
      pending.timer.unref(); state.pending.set(key, pending); this.publish(page.owner, page.id);
    });
  }
  private automatic(permission: string) { return ['fullscreen', 'pointerLock', 'clipboard-sanitized-write'].includes(permission); }
  private sameOrigin(page: Page, origin: string) { return !page.contents.isDestroyed() && !!originOf(origin) && originOf(origin) === originOf(page.contents.getURL()); }
  private keys(permission: string, mediaTypes?: string[]) {
    if (permission === 'media') return mediaTypes?.length && mediaTypes.every(type => type === 'audio' || type === 'video')
      ? [...new Set(mediaTypes)].sort() : null;
    return ['notifications', 'geolocation'].includes(permission) ? [permission] : null;
  }
  requests(id: string): BrowserPermissionRequest[] {
    return [...(this.pages.get(id)?.pending.values() ?? [])].map(({ token, origin, permissions, label }) => ({ token, origin, permissions, label }));
  }
  respond(owner: number, id: string, token: string, allow: boolean) {
    const state = this.pages.get(id);
    const found = [...(state?.pending.entries() ?? [])].find(([, pending]) => pending.token === token && pending.owner === owner);
    if (!state || !found) return;
    const [key, pending] = found;
    state.pending.delete(key); clearTimeout(pending.timer);
    for (const permission of pending.permissions) {
      (allow ? state.denied : state.allowed).delete(permission);
      (allow ? state.allowed : state.denied).add(permission);
    }
    this.publish(owner, id);
    for (const callback of pending.callbacks) callback(allow);
  }
  clear(owner: number, id: string) {
    const state = this.pages.get(id); this.pages.delete(id);
    if (!state) return;
    this.publish(owner, id);
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      for (const callback of pending.callbacks) callback(false);
    }
  }
  private publish(owner: number, id: string) { this.changed(owner, id, this.requests(id)); }
}
