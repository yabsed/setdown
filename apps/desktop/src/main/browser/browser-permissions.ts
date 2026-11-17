import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { BrowserPermissionRequest } from '../../protocol/browser';
import { permissionScope, type PermissionChoice } from './site-permissions';

type Page = { id: string; owner: number; contents: WebContents; visible: boolean };
type Scope = { key: string; origin: string; embedder?: string };
type Pending = BrowserPermissionRequest & { owner: number; scope: string; callbacks: Array<(allowed: boolean) => void>; timer: ReturnType<typeof setTimeout> };
type Decisions = { pending: Map<string, Pending>; allowed: Set<string>; denied: Set<string> };
/** The choices a user asked to keep across pages and restarts. */
export type PermissionMemory = {
  get(scope: string, permission: string): PermissionChoice | undefined;
  set(scope: string, permissions: string[], choice: PermissionChoice): void;
};
const names: Record<string, string> = { notifications: 'Notifications', audio: 'Microphone', video: 'Camera', geolocation: 'Location',
  'clipboard-read': 'Clipboard', 'display-capture': 'Screen Sharing' };
/**
 * Screen capture is asked for every time and an allowance is never kept. Electron
 * reports getDisplayMedia, whose picker follows, under the same name as the old
 * getUserMedia desktop constraint, which captures the whole screen without one.
 * The two cannot be told apart here, so neither may ride on an earlier answer.
 */
export const asksEachTime = (permissions: readonly string[]) => permissions.includes('display-capture');
const originOf = (url: string) => { try { const urlObject = new URL(url); return /^https?:$/.test(urlObject.protocol) ? urlObject.origin : null; } catch { return null; } };
const decision = (scope: string, permission: string) => `${scope}\n${permission}`;

/**
 * Asks quietly: a pending request never opens or focuses a window. An answer
 * lasts for the page's document unless the user asks to remember it for the
 * site; screen sharing is the exception and is asked every time. A site
 * embedded in another site's page asks under both names, and only after
 * Chromium has checked that the page delegated the capability to it.
 * Background service workers have no page to ask on and are refused.
 */
export class BrowserPermissions {
  private readonly pages = new Map<string, Decisions>();
  constructor(private readonly lookup: (contents: WebContents | null) => Page | undefined,
    private readonly changed: (owner: number, id: string, requests: BrowserPermissionRequest[]) => void,
    private readonly memory?: PermissionMemory) {}

  protects(id: string): boolean { const page = this.pages.get(id); return !!page && !!(page.pending.size || page.allowed.size); }
  install(profile: Session) {
    profile.setPermissionCheckHandler((contents, permission, origin, details) => {
      const page = this.lookup(contents);
      if (permission === 'fullscreen') return this.fullscreen(page, origin);
      const scope = page && this.scope(page, origin, details.isMainFrame !== false);
      if (!page || !scope) return false;
      if (this.automatic(permission)) return page.visible;
      const keys = this.keys(permission, details.mediaType ? [details.mediaType] : undefined, scope);
      return !!keys?.length && keys.every(key => this.decided(page.id, scope.key, key) === 'allow');
    });
    profile.setPermissionRequestHandler((contents, permission, callback, details) => {
      const page = this.lookup(contents);
      if (!page) return callback(false);
      const origin = originOf(details.requestingUrl || contents.getURL());
      if (permission === 'fullscreen') return callback(this.fullscreen(page, origin));
      const scope = this.scope(page, origin, details.isMainFrame);
      if (!scope) return callback(false);
      if (this.automatic(permission)) return callback(page.visible);
      const keys = this.keys(permission, 'mediaTypes' in details ? details.mediaTypes : undefined, scope);
      if (!keys?.length) return callback(false);
      let state = this.pages.get(page.id);
      if (!state) { state = { pending: new Map(), allowed: new Set(), denied: new Set() }; this.pages.set(page.id, state); }
      const decisions = keys.map(key => this.decided(page.id, scope.key, key));
      if (decisions.includes('deny')) return callback(false);
      if (decisions.every(choice => choice === 'allow')) {
        // A capability in use keeps its tab awake, however it was granted.
        for (const key of keys) state.allowed.add(decision(scope.key, key));
        return callback(true);
      }
      // Coalesce repeated calls without retaining an unbounded callback list.
      const key = decision(scope.key, keys.join(',')), previous = state.pending.get(key);
      if (previous) { if (previous.callbacks.length < 8) previous.callbacks.push(callback); else callback(false); return; }
      if (state.pending.size >= 4) return callback(false);
      const token = randomUUID();
      const pending: Pending = { token, origin: scope.origin, ...(scope.embedder ? { embedder: scope.embedder } : {}),
        permissions: keys, label: keys.map(key => names[key]).join(' and '), scope: scope.key,
        owner: page.owner, callbacks: [callback], timer: setTimeout(() => this.respond(page.owner, page.id, token, false), 90_000) };
      pending.timer.unref(); state.pending.set(key, pending); this.publish(page.owner, page.id);
    });
  }
  // Chromium enforces user activation and the iframe's fullscreen Permissions
  // Policy. Do not reject a permitted embedded player just for its origin.
  private fullscreen(page: Page | undefined, origin: string | null) {
    return !!page && page.visible && !page.contents.isDestroyed()
      && !!originOf(page.contents.getURL()) && !!origin && !!originOf(origin);
  }
  /** Chromium requires a user gesture for each, and neither reveals anything to the page. */
  private automatic(permission: string) { return ['pointerLock', 'clipboard-sanitized-write'].includes(permission); }
  /** The page asks under its own origin. A frame of another site is named together with the page embedding it. */
  private scope(page: Page, origin: string | null, mainFrame: boolean): Scope | null {
    const top = page.contents.isDestroyed() ? null : originOf(page.contents.getURL()), requester = origin && originOf(origin);
    if (!top || !requester) return null;
    if (requester === top) return { key: top, origin: top };
    return mainFrame ? null : { key: permissionScope(requester, top), origin: requester, embedder: top };
  }
  private keys(permission: string, mediaTypes: string[] | undefined, scope: Scope) {
    if (permission === 'media') return mediaTypes?.length && mediaTypes.every(type => type === 'audio' || type === 'video')
      ? [...new Set(mediaTypes)].sort() : null;
    // Chromium asks for approximate location under its own name; either is the user's one Location choice.
    if (permission === 'geolocation' || permission === 'geolocation-approximate') return ['geolocation'];
    if (permission === 'clipboard-read' || permission === 'display-capture') return [permission];
    // As in Chrome, only the page itself may ask to show notifications.
    return permission === 'notifications' && !scope.embedder ? [permission] : null;
  }
  /** A remembered choice outranks this document's: it is the user's standing answer for the site. */
  private decided(id: string, scope: string, permission: string): PermissionChoice | undefined {
    const remembered = this.memory?.get(scope, permission);
    // Only a standing block survives for a capability that is asked every time.
    if (asksEachTime([permission])) return remembered === 'deny' ? 'deny' : undefined;
    if (remembered) return remembered;
    const state = this.pages.get(id), key = decision(scope, permission);
    return state?.denied.has(key) ? 'deny' : state?.allowed.has(key) ? 'allow' : undefined;
  }
  requests(id: string): BrowserPermissionRequest[] {
    return [...(this.pages.get(id)?.pending.values() ?? [])].map(({ token, origin, embedder, permissions, label }) =>
      ({ token, origin, ...(embedder ? { embedder } : {}), permissions, label }));
  }
  respond(owner: number, id: string, token: string, allow: boolean, remember = false) {
    const state = this.pages.get(id);
    const found = [...(state?.pending.entries() ?? [])].find(([, pending]) => pending.token === token && pending.owner === owner);
    if (!state || !found) return;
    const [key, pending] = found;
    state.pending.delete(key); clearTimeout(pending.timer);
    const once = asksEachTime(pending.permissions);
    for (const permission of pending.permissions) {
      (allow ? state.denied : state.allowed).delete(decision(pending.scope, permission));
      // An allowance that is asked every time is recorded only to keep its tab awake; decided() never reads it.
      if (allow || !once) (allow ? state.allowed : state.denied).add(decision(pending.scope, permission));
    }
    if (remember && !(allow && once)) this.memory?.set(pending.scope, pending.permissions, allow ? 'allow' : 'deny');
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
