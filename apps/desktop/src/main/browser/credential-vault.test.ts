import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CredentialVault, credentialOrigin } from './credential-vault';
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setdown-vault-')); roots.push(root);
  const file = path.join(root, 'vault.enc'), key = randomBytes(32);
  let available = true;
  // Test the store independently of OS integration, with authenticated encryption.
  const protection = { available: () => available, encrypt: (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); }, decrypt: (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); } };
  return { file, protection, unavailable: () => { available = false; }, vault: new CredentialVault(file, protection) };
}
test('serializes saves, persists encrypted records and only releases an exact HTTPS origin account', async () => {
  const f = await fixture(); await f.vault.unlock();
  await Promise.all([f.vault.save('https://example.com/a', 'user', 'secret-one'), f.vault.save('https://example.com', 'other', 'secret-two')]);
  const accounts = (await f.vault.status()).accounts;
  expect(accounts).toHaveLength(2); expect(JSON.stringify(accounts)).not.toContain('secret');
  expect((await readFile(f.file)).includes(Buffer.from('secret-one'))).toBe(false);
  if (process.platform !== 'win32') expect((await stat(f.file)).mode & 0o777).toBe(0o600);
  await expect(f.vault.secret(accounts[0].id, 'https://sub.example.com')).rejects.toThrow('current page');
  await expect(f.vault.secret(accounts[0].id, 'https://example.com:444')).rejects.toThrow('current page');
  await f.vault.save('https://example.com', 'user', 'new-secret');
  const restarted = new CredentialVault(f.file, f.protection); expect((await restarted.status()).accounts).toEqual([]);
  await restarted.unlock(); expect(await restarted.secret(accounts[0].id, 'https://example.com')).toEqual({ username: 'user', password: 'new-secret' });
  await restarted.remove(accounts[0].id); expect((await restarted.status()).accounts).toHaveLength(1);
});
test('unavailable key stores, lock, expiry and corruption never produce plaintext or overwrite the vault', async () => {
  const f = await fixture(); await f.vault.unlock(); await f.vault.save('https://example.com', 'user', 'secret');
  f.vault.lock(); await expect(f.vault.secret('x', 'https://example.com')).rejects.toThrow('Unlock');
  await f.vault.unlock(); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000); expect((await f.vault.status()).accounts).toEqual([]); vi.useRealTimers();
  await writeFile(f.file, 'damaged'); await expect(f.vault.unlock()).rejects.toThrow('not overwritten'); expect(await readFile(f.file, 'utf8')).toBe('damaged');
  f.unavailable(); expect((await f.vault.status()).available).toBe(false); await expect(f.vault.unlock()).rejects.toThrow('unavailable');
  expect(() => credentialOrigin('http://example.com')).toThrow('HTTPS'); expect(() => credentialOrigin('https://u:p@example.com')).toThrow('HTTPS');
});
