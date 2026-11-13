/** A saved login without its secret: what lists and menus may show. */
export type BrowserPasswordEntry = { id: string; origin: string; username: string; modified: number };
export type BrowserPasswordList = {
  entries: BrowserPasswordEntry[];
  /** Origins the user chose never to be asked about. */
  neverSave: string[];
  /** False when no OS keyring can protect the file: passwords then live only until the application quits. */
  persistent: boolean;
  /** Set once when a stored file could not be read (it is kept aside, never overwritten). */
  warning: string | null;
};
/** Per-tab state behind the address bar's key button. */
export type BrowserPasswordState = {
  /** A login that was just submitted and is not saved yet. */
  save: { origin: string; username: string; update: boolean } | null;
  /** Saved logins that fit the login form on this page. */
  fill: number;
};
export type BrowserPasswordImportResult = { added: number; updated: number; skipped: number };
export type BrowserPasswordExportResult = { path: string; passwords: number };
export type PasswordRow = { origin: string; username: string; password: string };

export const PASSWORD_LIMITS = { entries: 10_000, username: 500, password: 1000 } as const;

const loopback = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/**
 * The key a login is stored and matched under: the exact origin (scheme, host
 * and port), never a bare host name. Passwords are only kept for origins whose
 * transport cannot be read or rewritten on the way: HTTPS, or this machine.
 * An opaque origin ("null") or any other scheme is not a place to keep one.
 */
export function passwordOrigin(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || !url.hostname) return null;
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname))) return url.origin;
  return null;
}
/** An address a person typed or another browser exported, where "example.com" means the HTTPS site. */
export function typedPasswordOrigin(input: string): string | null {
  const value = input.trim();
  return passwordOrigin(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
}
