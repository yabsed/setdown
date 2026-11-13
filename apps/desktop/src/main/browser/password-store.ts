import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { PASSWORD_LIMITS, passwordOrigin, type BrowserPasswordImportResult, type BrowserPasswordList, type PasswordRow } from '../../core/browser/passwords';

/** The OS keyring, behind an interface so tests need no desktop session. */
export type PasswordVault = {
  /** Whether a file encrypted now can be trusted with passwords and read back later. */
  persistent(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
};
/**
 * Electron encrypts with a key held by libsecret or KWallet (DPAPI on Windows).
 * Without a keyring Linux falls back to "basic_text", a fixed key that hides
 * nothing: such a file must not be written.
 */
export const systemVault: PasswordVault = {
  persistent: () => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: text => safeStorage.encryptString(text),
  decrypt: data => safeStorage.decryptString(data),
};

type Credential = PasswordRow & { id: string; created: number; modified: number };
type Contents = { version: 1; credentials: Credential[]; neverSave: string[] };
const valid = (row: PasswordRow) => passwordOrigin(row.origin) === row.origin && typeof row.username === 'string' && typeof row.password === 'string'
  && row.password.length > 0 && row.username.length <= PASSWORD_LIMITS.username && row.password.length <= PASSWORD_LIMITS.password;

/**
 * Saved logins, decrypted only in this process. Callers get entries without
 * secrets and ask for one password at a time. One encrypted file holds all of
 * them; without a usable keyring nothing is written and the logins last until quit.
 */
export class PasswordStore {
  private contents: Contents = { version: 1, credentials: [], neverSave: [] };
  private ready?: Promise<void>;
  private saving = Promise.resolve();
  private stored = false;
  private notice: string | null = null;
  constructor(private readonly file: string, private readonly vault: PasswordVault = systemVault) {}

  private load(): Promise<void> {
    return this.ready ??= (async () => {
      this.stored = this.vault.persistent();
      if (!this.stored) return;
      let data: Buffer;
      try { data = await fs.readFile(this.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      try {
        const parsed = JSON.parse(this.vault.decrypt(data)) as Contents;
        if (parsed?.version !== 1 || !Array.isArray(parsed.credentials) || !Array.isArray(parsed.neverSave)) throw Error('Unsupported password file.');
        this.contents = { version: 1,
          credentials: parsed.credentials.filter(row => row && typeof row.id === 'string' && valid(row)).slice(0, PASSWORD_LIMITS.entries)
            .map(row => ({ id: row.id, origin: row.origin, username: row.username, password: row.password,
              created: Number(row.created) || 0, modified: Number(row.modified) || 0 })),
          neverSave: parsed.neverSave.filter(origin => typeof origin === 'string' && passwordOrigin(origin) === origin).slice(0, PASSWORD_LIMITS.entries) };
      } catch {
        // A changed or missing keyring entry cannot decrypt this file. It may still
        // be readable later (the same keyring restored), so it is set aside, never overwritten.
        const aside = `${this.file}.unreadable-${Date.now()}`;
        await fs.rename(this.file, aside);
        this.notice = `Saved passwords could not be read with the current system keyring. The file was kept as ${aside}.`;
      }
    })();
  }
  private commit(): Promise<void> {
    if (!this.stored) return Promise.resolve();
    const data = this.vault.encrypt(JSON.stringify(this.contents));
    this.saving = this.saving.catch(() => {}).then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, this.file);
      } finally { await fs.rm(temporary, { force: true }); }
    });
    return this.saving;
  }
  private find(origin: string, username: string) { return this.contents.credentials.find(row => row.origin === origin && row.username === username); }

  async list(): Promise<BrowserPasswordList> {
    await this.load();
    return { entries: this.contents.credentials.map(({ id, origin, username, modified }) => ({ id, origin, username, modified }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)),
      neverSave: [...this.contents.neverSave].sort(), persistent: this.stored, warning: this.notice };
  }
  /** Logins for exactly this origin, without their passwords. */
  async matches(origin: string): Promise<Array<{ id: string; username: string }>> {
    await this.load();
    return this.contents.credentials.filter(row => row.origin === origin).sort((a, b) => b.modified - a.modified).map(({ id, username }) => ({ id, username }));
  }
  async credential(id: string): Promise<PasswordRow | null> {
    await this.load();
    const row = this.contents.credentials.find(item => item.id === id);
    return row ? { origin: row.origin, username: row.username, password: row.password } : null;
  }
  /** How a just-submitted login relates to what is stored: whether to ask, and what the question is. */
  async status(row: PasswordRow): Promise<'new' | 'update' | 'same' | 'never'> {
    await this.load();
    if (this.contents.neverSave.includes(row.origin)) return 'never';
    const existing = this.find(row.origin, row.username);
    return !existing ? 'new' : existing.password === row.password ? 'same' : 'update';
  }
  async save(row: PasswordRow): Promise<void> {
    await this.load();
    if (!valid(row)) throw Error('This login cannot be saved.');
    const existing = this.find(row.origin, row.username), now = Date.now();
    if (existing) { if (existing.password === row.password) return; existing.password = row.password; existing.modified = now; }
    else {
      if (this.contents.credentials.length >= PASSWORD_LIMITS.entries) throw Error(`${PASSWORD_LIMITS.entries.toLocaleString('en-US')} passwords are saved. Remove one first.`);
      this.contents.credentials.push({ id: randomUUID(), ...row, created: now, modified: now });
    }
    await this.commit();
  }
  async remove(id: string): Promise<void> {
    await this.load();
    const before = this.contents.credentials.length;
    this.contents.credentials = this.contents.credentials.filter(row => row.id !== id);
    if (this.contents.credentials.length !== before) await this.commit();
  }
  /** `never` true: stop asking for this origin. false: ask again. */
  async setNever(origin: string, never: boolean): Promise<void> {
    await this.load();
    if (passwordOrigin(origin) !== origin) throw Error('Invalid site.');
    const listed = this.contents.neverSave.includes(origin);
    if (listed === never) return;
    this.contents.neverSave = never ? [...this.contents.neverSave, origin] : this.contents.neverSave.filter(item => item !== origin);
    await this.commit();
  }
  /** Imported rows replace a stored login for the same origin and user name. */
  async merge(rows: PasswordRow[]): Promise<BrowserPasswordImportResult> {
    await this.load();
    const result = { added: 0, updated: 0, skipped: 0 }, now = Date.now();
    for (const row of rows) {
      const existing = valid(row) ? this.find(row.origin, row.username) : undefined;
      if (!valid(row) || (!existing && this.contents.credentials.length >= PASSWORD_LIMITS.entries)) { result.skipped++; continue; }
      if (!existing) { this.contents.credentials.push({ id: randomUUID(), ...row, created: now, modified: now }); result.added++; }
      else if (existing.password === row.password) result.skipped++;
      else { existing.password = row.password; existing.modified = now; result.updated++; }
    }
    if (result.added || result.updated) await this.commit();
    return result;
  }
  /** How an import would change the store, for the confirmation shown before it. */
  async preview(rows: PasswordRow[]): Promise<{ added: number; updated: number }> {
    await this.load();
    let added = 0, updated = 0;
    for (const row of rows) { const existing = this.find(row.origin, row.username); if (!existing) added++; else if (existing.password !== row.password) updated++; }
    return { added, updated };
  }
  async rows(): Promise<PasswordRow[]> {
    await this.load();
    return this.contents.credentials.map(({ origin, username, password }) => ({ origin, username, password }));
  }
  /** Removes every login. The "never save" choices are site settings and are kept. */
  async clear(): Promise<void> {
    await this.load();
    if (!this.contents.credentials.length) return;
    this.contents.credentials = [];
    await this.commit();
  }
}
