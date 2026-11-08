import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CredentialInfo, CredentialStatus } from '../../core/browser/credentials';
type Credential = CredentialInfo & { password: string };
export type CredentialProtection = { available(): boolean; encrypt(text: string): Buffer; decrypt(bytes: Buffer): string };
export function credentialOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Passwords are supported only on HTTPS pages without URL credentials.');
  return url.origin;
}

/** Main-only, OS-protected local vault. No persistent plaintext cache, logging,
 * fallback encryption or automatic overwrite on corruption/decryption failure. */
export class CredentialVault {
  private expires = 0;
  private generation = 0;
  private queue = Promise.resolve();
  constructor(private file: string, private protection: CredentialProtection) {}
  get unlocked() { return Date.now() < this.expires; }
  lock() { this.expires = 0; this.generation++; }
  async unlock() {
    this.requireProtection(); const generation = this.generation;
    await this.read();
    if (generation !== this.generation) throw Error('Password use was locked.');
    this.expires = Date.now() + 10 * 60_000;
  }
  async status(): Promise<CredentialStatus> {
    const available = this.protection.available();
    if (!available || !this.unlocked) return { available, unlocked: false, accounts: [] };
    const records = await this.read(); this.requireUnlocked();
    return { available: true, unlocked: true, accounts: records.map(({ password: _secret, ...info }) => info) };
  }
  private requireProtection() { if (!this.protection.available()) throw Error('A protected OS password store is unavailable. Passwords will not be saved.'); }
  private requireUnlocked() { this.requireProtection(); if (!this.unlocked) throw Error('Unlock password use in Browser → Passwords first.'); }
  private async read(): Promise<Credential[]> {
    this.requireProtection();
    let bytes: Buffer;
    try {
      const handle = await fs.open(this.file, 'r');
      try { if ((await handle.stat()).size > 8 * 1024 * 1024) throw Error(); bytes = await handle.readFile(); }
      finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw Error('Cannot read the password vault. The existing file was kept.'); }
    try {
      const data = JSON.parse(this.protection.decrypt(bytes));
      if (data.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length > 5000) throw Error();
      const ids = new Set<string>();
      for (const item of data.accounts) {
        if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.username !== 'string' || item.username.length > 1000 || typeof item.password !== 'string' || item.password.length > 10000 || credentialOrigin(item.origin) !== item.origin || !Number.isFinite(item.updatedAt)) throw Error();
        ids.add(item.id);
      }
      return data.accounts;
    } catch { throw Error('The password vault is locked, damaged, or belongs to another OS account. It was not overwritten.'); }
  }
  private mutate(change: (records: Credential[]) => void): Promise<void> {
    this.requireUnlocked(); const generation = this.generation;
    const task = this.queue.catch(() => {}).then(async () => {
      this.requireUnlocked(); if (generation !== this.generation) throw Error('Password use was locked.');
      const records = await this.read(); change(records);
      if (records.length > 5000) throw Error('The local vault is full.');
      this.requireUnlocked();
      const encrypted = this.protection.encrypt(JSON.stringify({ version: 1, accounts: records }));
      if (encrypted.length > 8 * 1024 * 1024) throw Error('The local vault is full.');
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
        this.requireUnlocked(); if (generation !== this.generation) throw Error('Password use was locked.');
        await fs.rename(temporary, this.file);
      } finally { await fs.rm(temporary, { force: true }); }
    });
    this.queue = task; return task;
  }
  save(origin: string, username: string, password: string): Promise<void> {
    origin = credentialOrigin(origin);
    if (typeof username !== 'string' || username.length > 1000 || typeof password !== 'string' || !password || password.length > 10000) throw Error('Invalid login fields.');
    return this.mutate(records => {
      const record = records.find(item => item.origin === origin && item.username === username);
      if (record) { record.password = password; record.updatedAt = Date.now(); }
      else records.push({ id: randomUUID(), origin, username, password, updatedAt: Date.now() });
    });
  }
  async secret(id: string, origin: string): Promise<{ username: string; password: string }> {
    this.requireUnlocked(); const generation = this.generation;
    const record = (await this.read()).find(item => item.id === id && item.origin === credentialOrigin(origin));
    this.requireUnlocked(); if (generation !== this.generation || !record) throw Error('This saved account does not belong to the current page.');
    return { username: record.username, password: record.password };
  }
  remove(id: string): Promise<void> { return this.mutate(records => { const i = records.findIndex(item => item.id === id); if (i >= 0) records.splice(i, 1); }); }
}
