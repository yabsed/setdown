import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type PermissionChoice = 'allow' | 'deny';
/** Capabilities a site can be remembered for. Anything else is asked or refused each time. */
export const REMEMBERED_PERMISSIONS = ['notifications', 'audio', 'video', 'geolocation', 'clipboard-read', 'display-capture'] as const;
/** Screen sharing can be blocked for good but never allowed for good: it is asked for every time. */
const keeps = (name: string, choice: unknown): choice is PermissionChoice =>
  (REMEMBERED_PERMISSIONS as readonly string[]).includes(name) && (choice === 'deny' || (choice === 'allow' && name !== 'display-capture'));
const LIMIT = 2000;
const origin = (value: string) => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) && url.origin === value; } catch { return false; } };

/**
 * A scope names who asked: `origin` for a page and its same-origin frames, or
 * `origin embedder` for a site embedded in another site's page. An embedded
 * site is remembered only for the page that embeds it.
 */
export const permissionScope = (requester: string, embedder?: string) => embedder && embedder !== requester ? `${requester} ${embedder}` : requester;
const validScope = (scope: string) => { const parts = scope.split(' '); return parts.length <= 2 && parts.every(origin); };

/**
 * The choices a user asked to keep ("Always Allow", "Always Block"). The
 * permission handlers are synchronous, so the small file is read once and each
 * rare change is written through at once.
 */
export class SitePermissions {
  private sites = new Map<string, Record<string, PermissionChoice>>();
  private loaded = false;
  constructor(private readonly file: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); } catch { return; }
    const sites = (parsed as { version?: unknown; sites?: unknown } | null)?.version === 1 ? (parsed as { sites?: unknown }).sites : null;
    if (!sites || typeof sites !== 'object') return;
    for (const [scope, raw] of Object.entries(sites).slice(0, LIMIT)) {
      if (!validScope(scope) || !raw || typeof raw !== 'object') continue;
      const choices = Object.fromEntries(Object.entries(raw).filter(([name, value]) => keeps(name, value))) as Record<string, PermissionChoice>;
      if (Object.keys(choices).length) this.sites.set(scope, choices);
    }
  }
  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, sites: Object.fromEntries(this.sites) }, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  get(scope: string, permission: string): PermissionChoice | undefined {
    this.load();
    return this.sites.get(scope)?.[permission];
  }
  set(scope: string, permissions: string[], choice: PermissionChoice): void {
    this.load();
    const kept = permissions.filter(name => keeps(name, choice));
    if (!validScope(scope) || !kept.length) return;
    const choices = { ...this.sites.get(scope) };
    for (const name of kept) choices[name] = choice;
    // Re-inserting keeps the most recently decided sites when the bound is reached.
    this.sites.delete(scope); this.sites.set(scope, choices);
    while (this.sites.size > LIMIT) this.sites.delete(this.sites.keys().next().value!);
    this.save();
  }
  /** Remembered choices for one page origin: its own and those of sites embedded in it. */
  list(page: string): Array<{ scope: string; origin: string; permission: string; choice: PermissionChoice }> {
    this.load();
    return [...this.sites].filter(([scope]) => scope === page || scope.endsWith(` ${page}`))
      .flatMap(([scope, choices]) => Object.entries(choices).map(([permission, choice]) => ({ scope, origin: scope.split(' ')[0], permission, choice })));
  }
  /** Forget what was remembered for a page origin. Returns whether anything changed. */
  clearSite(page: string): boolean {
    this.load();
    const scopes = [...this.sites.keys()].filter(scope => scope === page || scope.endsWith(` ${page}`));
    for (const scope of scopes) this.sites.delete(scope);
    if (scopes.length) this.save();
    return scopes.length > 0;
  }
  clear(): void {
    this.load();
    if (!this.sites.size) return;
    this.sites.clear(); this.save();
  }
}
