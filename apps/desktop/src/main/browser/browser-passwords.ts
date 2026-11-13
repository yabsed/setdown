import type { MenuItemConstructorOptions, WebFrameMain } from 'electron';
import { PASSWORD_LIMITS, passwordOrigin, type BrowserPasswordState, type PasswordRow } from '../../core/browser/passwords';
import type { PasswordStore } from './password-store';

type Page = { owner: number; id: string };
type Pending = PasswordRow & { update: boolean; timer: ReturnType<typeof setTimeout> };
type Tab = { owner: number; fill: number; pending?: Pending; target?: { frame: WebFrameMain; origin: string } };

/** The site a frame may save or receive a login for. It comes from the frame
 * itself, never from a message: a page cannot ask for another site's password. */
const frameOrigin = (frame: WebFrameMain): string | null => {
  try { return frame.isDestroyed() ? null : passwordOrigin(frame.origin); } catch { return null; }
};

/**
 * Login forms of web tabs: what a tab offers to save, and which saved logins
 * fit its page. Nothing is filled until the user picks a login, so a script
 * injected into a page finds no password waiting in its fields.
 */
export class BrowserPasswords {
  private readonly tabs = new Map<string, Tab>();
  constructor(readonly store: PasswordStore,
    private readonly changed: (owner: number, id: string, state: BrowserPasswordState | null) => void,
    private readonly storeChanged: () => void) {}

  state(id: string): BrowserPasswordState | null {
    const tab = this.tabs.get(id);
    if (!tab || (!tab.pending && !tab.fill)) return null;
    return { save: tab.pending ? { origin: tab.pending.origin, username: tab.pending.username, update: tab.pending.update } : null, fill: tab.fill };
  }
  private tab(page: Page): Tab {
    let tab = this.tabs.get(page.id);
    if (!tab) { tab = { owner: page.owner, fill: 0 }; this.tabs.set(page.id, tab); }
    tab.owner = page.owner;
    return tab;
  }
  private publish(id: string) { const tab = this.tabs.get(id); if (tab) this.changed(tab.owner, id, this.state(id)); }
  private drop(id: string) {
    const tab = this.tabs.get(id);
    if (!tab?.pending) return;
    clearTimeout(tab.pending.timer); tab.pending = undefined; this.publish(id);
  }
  /** A frame showed a login form (on load, and again whenever one of its fields takes focus). */
  async form(page: Page, frame: WebFrameMain): Promise<void> {
    const origin = frameOrigin(frame);
    if (!origin) return;
    const tab = this.tab(page), target = tab.target = { frame, origin };
    const matches = await this.store.matches(origin);
    if (this.tabs.get(page.id) !== tab || tab.target !== target || tab.fill === matches.length) return;
    tab.fill = matches.length; this.publish(page.id);
  }
  /** A frame submitted a login form. Offer to keep it unless it is already saved or the site was declined. */
  async submitted(page: Page, frame: WebFrameMain, raw: unknown): Promise<void> {
    const origin = frameOrigin(frame), input = raw as { username?: unknown; password?: unknown } | null;
    if (!origin || !input || typeof input.username !== 'string' || typeof input.password !== 'string') return;
    const row = { origin, username: input.username.trim(), password: input.password };
    if (!row.password || row.username.length > PASSWORD_LIMITS.username || row.password.length > PASSWORD_LIMITS.password) return;
    const status = await this.store.status(row);
    const tab = this.tab(page);
    if (tab.pending) clearTimeout(tab.pending.timer);
    tab.pending = undefined;
    if (status === 'new' || status === 'update') {
      // An unanswered offer must not keep a password in memory for the life of the tab.
      const timer = setTimeout(() => this.drop(page.id), 5 * 60_000); timer.unref();
      tab.pending = { ...row, update: status === 'update', timer };
    }
    this.publish(page.id);
  }
  /** The tab's main document changed: its login form is gone, a pending offer (the login just made) remains. */
  navigated(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || (!tab.target && !tab.fill)) return;
    tab.target = undefined; tab.fill = 0; this.publish(id);
  }
  clear(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.pending) clearTimeout(tab.pending.timer);
    this.tabs.delete(id); this.changed(tab.owner, id, null);
  }
  /** Forget what every tab offered; used when all saved passwords are cleared. */
  reset(): void {
    for (const [id, tab] of this.tabs) {
      if (!tab.pending && !tab.fill) continue;
      if (tab.pending) clearTimeout(tab.pending.timer);
      tab.pending = undefined; tab.fill = 0; this.publish(id);
    }
  }

  private async fill(page: Page, credentialId: string, frame?: WebFrameMain): Promise<boolean> {
    const tab = this.tabs.get(page.id), target = frame ? { frame, origin: frameOrigin(frame) } : tab?.target;
    const login = await this.store.credential(credentialId);
    // Recheck after the wait: the frame may have navigated to another site.
    if (!target?.origin || !login || frameOrigin(target.frame) !== target.origin || login.origin !== target.origin) return false;
    target.frame.send('browser:password-fill', { username: login.username, password: login.password });
    return true;
  }
  private async fillItems(page: Page, origin: string, frame?: WebFrameMain): Promise<MenuItemConstructorOptions[]> {
    return (await this.store.matches(origin)).map(match => ({ label: `Fill Password: ${match.username || '(no user name)'}`,
      click: () => { void this.fill(page, match.id, frame).catch(console.error); } }));
  }
  /** The address bar's key button: the pending offer first, then the logins that fit this page. */
  async menu(page: Page): Promise<MenuItemConstructorOptions[]> {
    const tab = this.tabs.get(page.id), pending = tab?.pending, items: MenuItemConstructorOptions[] = [];
    if (pending) {
      const host = new URL(pending.origin).host, who = pending.username ? `“${pending.username}”` : 'this login';
      items.push({ label: `${pending.update ? 'Update the saved password' : 'Save the password'} for ${who} on ${host}?`, enabled: false },
        { label: pending.update ? 'Update Password' : 'Save Password', click: () => {
          void this.store.save({ origin: pending.origin, username: pending.username, password: pending.password })
            .then(() => { if (this.tabs.get(page.id)?.pending === pending) this.drop(page.id); this.storeChanged(); }).catch(console.error);
        } },
        { label: 'Never for This Site', click: () => {
          void this.store.setNever(pending.origin, true).then(() => { this.drop(page.id); this.storeChanged(); }).catch(console.error);
        } },
        { label: 'Not Now', click: () => this.drop(page.id) });
    }
    const fill = tab?.target ? await this.fillItems(page, tab.target.origin) : [];
    if (fill.length) { if (items.length) items.push({ type: 'separator' }); items.push(...fill); }
    return items.length ? items : [{ label: 'No saved password fits this page', enabled: false }];
  }
  /** Right-click inside a field: logins for that field's own frame. */
  async contextItems(page: Page, frame: WebFrameMain): Promise<MenuItemConstructorOptions[]> {
    const origin = frameOrigin(frame);
    return origin ? this.fillItems(page, origin, frame) : [];
  }
  /** The keyboard shortcut fills at once when exactly one login fits; otherwise the caller shows the menu. */
  async fillOnly(page: Page): Promise<boolean> {
    const target = this.tabs.get(page.id)?.target;
    if (!target) return false;
    const matches = await this.store.matches(target.origin);
    return matches.length === 1 && this.fill(page, matches[0].id);
  }
}
