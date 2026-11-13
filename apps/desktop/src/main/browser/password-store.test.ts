import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { PasswordStore, type PasswordVault } from './password-store';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function file() { const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-passwords-')); roots.push(root); return path.join(root, 'browser-passwords.bin'); }
/** A keyring whose key can be swapped, as when another user's profile is copied over. */
const vault = (key = 7, persistent = true): PasswordVault => ({ persistent: () => persistent,
  encrypt: text => Buffer.from(Buffer.from(`ok:${text}`).map(byte => byte ^ key)),
  decrypt: data => { const text = Buffer.from(data.map(byte => byte ^ key)).toString(); if (!text.startsWith('ok:')) throw Error('wrong key'); return text.slice(3); } });
const ann = { origin: 'https://example.com', username: 'ann', password: 'first' };

test('logins are stored encrypted, matched by exact origin, and listed without their passwords', async () => {
  const target = await file();
  const store = new PasswordStore(target, vault());
  expect(await store.status(ann)).toBe('new');
  await store.save(ann);
  await store.save({ origin: 'https://example.com', username: 'bob', password: 'second' });
  await store.save({ origin: 'https://other.example.com', username: 'ann', password: 'third' });
  expect(await store.status(ann)).toBe('same');
  expect(await store.status({ ...ann, password: 'changed' })).toBe('update');
  expect((await store.matches('https://example.com')).map(item => item.username).sort()).toEqual(['ann', 'bob']);
  // Neither a subdomain, another port nor plain HTTP is the same site.
  for (const origin of ['https://www.example.com', 'https://example.com:8443', 'http://example.com']) expect(await store.matches(origin)).toEqual([]);
  const list = await store.list();
  expect(list.persistent).toBe(true); expect(list.entries).toHaveLength(3);
  expect(JSON.stringify(list)).not.toContain('first');
  const raw = await readFile(target);
  expect(raw.toString()).not.toContain('first'); expect(raw.toString()).not.toContain('example.com');
  expect((await stat(target)).mode & 0o777).toBe(0o600);
  expect((await readdir(path.dirname(target)))).toEqual(['browser-passwords.bin']);

  const reopened = new PasswordStore(target, vault());
  const id = (await reopened.matches('https://example.com')).find(item => item.username === 'ann')!.id;
  expect(await reopened.credential(id)).toEqual(ann);
  await reopened.save({ ...ann, password: 'changed' });
  expect((await reopened.credential(id))?.password).toBe('changed');
  expect((await reopened.list()).entries).toHaveLength(3);
  await reopened.remove(id);
  expect(await reopened.credential(id)).toBeNull();
  await expect(reopened.save({ origin: 'http://example.com', username: 'x', password: 'y' })).rejects.toThrow('cannot be saved');
  await expect(reopened.save({ ...ann, password: '' })).rejects.toThrow('cannot be saved');
});

test('“never save” is remembered per origin and survives clearing the passwords', async () => {
  const target = await file();
  const store = new PasswordStore(target, vault());
  await store.save(ann);
  await store.setNever('https://bank.example', true);
  expect(await store.status({ origin: 'https://bank.example', username: 'a', password: 'b' })).toBe('never');
  await store.clear();
  const list = await new PasswordStore(target, vault()).list();
  expect(list.entries).toEqual([]); expect(list.neverSave).toEqual(['https://bank.example']);
  await store.setNever('https://bank.example', false);
  expect(await store.status({ origin: 'https://bank.example', username: 'a', password: 'b' })).toBe('new');
  await expect(store.setNever('bank.example', true)).rejects.toThrow('Invalid site');
});

test('without a usable keyring nothing is written: logins last only for this run', async () => {
  const target = await file();
  const store = new PasswordStore(target, vault(7, false));
  await store.save(ann);
  expect((await store.matches(ann.origin))).toHaveLength(1);
  expect((await store.list()).persistent).toBe(false);
  expect(await readdir(path.dirname(target))).toEqual([]);
  expect((await new PasswordStore(target, vault(7, false)).list()).entries).toEqual([]);
  // A file written while a keyring existed is left alone, not read and not replaced.
  await writeFile(target, vault().encrypt(JSON.stringify({ version: 1, credentials: [], neverSave: [] })));
  const later = new PasswordStore(target, vault(7, false));
  await later.save(ann);
  expect(await readdir(path.dirname(target))).toEqual(['browser-passwords.bin']);
});

test('a file the current keyring cannot decrypt is set aside, never overwritten', async () => {
  const target = await file();
  await new PasswordStore(target, vault(7)).save(ann);
  const original = await readFile(target);
  const store = new PasswordStore(target, vault(42));
  const list = await store.list();
  expect(list.entries).toEqual([]); expect(list.warning).toContain('could not be read');
  const kept = (await readdir(path.dirname(target))).filter(name => name.includes('.unreadable-'));
  expect(kept).toHaveLength(1);
  expect(await readFile(path.join(path.dirname(target), kept[0]))).toEqual(original);
  await store.save({ ...ann, password: 'new' });
  expect((await new PasswordStore(target, vault(42)).matches(ann.origin))).toHaveLength(1);
  // The original key still opens the file that was kept.
  expect(JSON.parse(vault(7).decrypt(await readFile(path.join(path.dirname(target), kept[0])))).credentials[0].password).toBe('first');
});

test('an import adds new logins, replaces changed ones and reports what it would do first', async () => {
  const store = new PasswordStore(await file(), vault());
  await store.save(ann);
  const rows = [{ ...ann, password: 'imported' }, { origin: 'https://new.example', username: 'me', password: 'pw' },
    { origin: 'http://insecure.example', username: 'me', password: 'pw' }];
  expect(await store.preview(rows.slice(0, 2))).toEqual({ added: 1, updated: 1 });
  expect(await store.merge(rows)).toEqual({ added: 1, updated: 1, skipped: 1 });
  expect(await store.merge(rows.slice(0, 2))).toEqual({ added: 0, updated: 0, skipped: 2 });
  expect((await store.rows()).sort((a, b) => a.origin.localeCompare(b.origin))).toEqual([
    { ...ann, password: 'imported' }, { origin: 'https://new.example', username: 'me', password: 'pw' }]);
});

test('a saved login is edited in place: either field, never onto another login of the same site', async () => {
  const target = await file();
  const store = new PasswordStore(target, vault());
  await store.save(ann); await store.save({ ...ann, username: 'bob', password: 'second' });
  const id = (await store.matches(ann.origin)).find(item => item.username === 'ann')!.id;
  await store.update(id, { password: 'rotated' });
  expect(await store.credential(id)).toEqual({ ...ann, password: 'rotated' });
  await store.update(id, { username: 'ann@example.com' });
  expect(await store.credential(id)).toEqual({ origin: ann.origin, username: 'ann@example.com', password: 'rotated' });
  // The entry keeps its identity and the change is what the next start reads.
  expect((await new PasswordStore(target, vault()).credential(id))?.username).toBe('ann@example.com');
  await expect(store.update(id, { username: 'bob' })).rejects.toThrow('already uses that user name');
  await expect(store.update(id, { password: '' })).rejects.toThrow('cannot be saved');
  await expect(store.update('missing', { password: 'x' })).rejects.toThrow('Unknown password');
  expect(await store.credential(id)).toEqual({ origin: ann.origin, username: 'ann@example.com', password: 'rotated' });
  expect((await store.list()).entries).toHaveLength(2);
});
