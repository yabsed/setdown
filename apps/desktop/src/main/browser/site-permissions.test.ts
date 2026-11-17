import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { permissionScope, SitePermissions } from './site-permissions';

const roots: string[] = [];
const file = () => { const root = mkdtempSync(path.join(os.tmpdir(), 'setdown-permissions-')); roots.push(root); return path.join(root, 'nested', 'permissions.json'); };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('remembered choices survive a restart in an owner-only file', () => {
  const target = file(), store = new SitePermissions(target);
  expect(store.get('https://example.com', 'notifications')).toBeUndefined();
  store.set('https://example.com', ['audio', 'video'], 'allow');
  store.set('https://example.com', ['notifications'], 'deny');
  const reopened = new SitePermissions(target);
  expect(reopened.get('https://example.com', 'audio')).toBe('allow');
  expect(reopened.get('https://example.com', 'video')).toBe('allow');
  expect(reopened.get('https://example.com', 'notifications')).toBe('deny');
  expect(reopened.get('https://example.com', 'geolocation')).toBeUndefined();
  expect(reopened.get('https://other.example', 'audio')).toBeUndefined();
  if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600);
});

test('an embedded site is remembered only inside the page that embeds it', () => {
  const store = new SitePermissions(file());
  const embedded = permissionScope('https://meet.example', 'https://school.example');
  expect(permissionScope('https://school.example', 'https://school.example')).toBe('https://school.example');
  store.set(embedded, ['video'], 'allow');
  expect(store.get(embedded, 'video')).toBe('allow');
  expect(store.get('https://meet.example', 'video')).toBeUndefined();
  expect(store.get(permissionScope('https://meet.example', 'https://elsewhere.example'), 'video')).toBeUndefined();
  store.set('https://school.example', ['geolocation'], 'deny');
  store.set('https://meet.example', ['audio'], 'allow');
  expect(store.list('https://school.example')).toEqual([
    { scope: embedded, origin: 'https://meet.example', permission: 'video', choice: 'allow' },
    { scope: 'https://school.example', origin: 'https://school.example', permission: 'geolocation', choice: 'deny' },
  ]);
  expect(store.clearSite('https://school.example')).toBe(true);
  expect(store.clearSite('https://school.example')).toBe(false);
  expect(store.get(embedded, 'video')).toBeUndefined();
  expect(store.get('https://meet.example', 'audio')).toBe('allow');
  store.clear();
  expect(store.get('https://meet.example', 'audio')).toBeUndefined();
});

test('unknown permissions, malformed scopes and damaged files are ignored', () => {
  const target = file(), store = new SitePermissions(target);
  store.set('https://example.com/path', ['audio'], 'allow');
  store.set('file:///home/me', ['audio'], 'allow');
  // Screen sharing is never allowed for good, by a choice or by an edited file; it can be blocked for good.
  store.set('https://example.com', ['display-capture', 'usb'], 'allow');
  expect(store.get('https://example.com', 'display-capture')).toBeUndefined();
  expect(() => readFileSync(target)).toThrow();
  store.set('https://blocked.example', ['display-capture'], 'deny');
  expect(new SitePermissions(target).get('https://blocked.example', 'display-capture')).toBe('deny');
  store.set('https://example.com', ['audio'], 'allow');
  writeFileSync(target, JSON.stringify({ version: 1, sites: {
    'https://example.com': { audio: 'allow', usb: 'allow', video: 'maybe', 'display-capture': 'allow' }, 'javascript:alert(1)': { audio: 'allow' },
    'https://a.example https://b.example https://c.example': { audio: 'allow' }, 'https://empty.example': {} } }));
  const reopened = new SitePermissions(target);
  expect(reopened.list('https://example.com')).toEqual([{ scope: 'https://example.com', origin: 'https://example.com', permission: 'audio', choice: 'allow' }]);
  expect(reopened.get('javascript:alert(1)', 'audio')).toBeUndefined();
  writeFileSync(target, '{ not json');
  expect(new SitePermissions(target).get('https://example.com', 'audio')).toBeUndefined();
  writeFileSync(target, JSON.stringify({ version: 2, sites: { 'https://example.com': { audio: 'allow' } } }));
  expect(new SitePermissions(target).get('https://example.com', 'audio')).toBeUndefined();
});

test('the store is bounded and keeps the most recently decided sites', () => {
  const store = new SitePermissions(file());
  for (let index = 0; index < 2005; index++) store.set(`https://site${index}.example`, ['audio'], 'allow');
  expect(store.get('https://site0.example', 'audio')).toBeUndefined();
  expect(store.get('https://site4.example', 'audio')).toBeUndefined();
  expect(store.get('https://site5.example', 'audio')).toBe('allow');
  expect(store.get('https://site2004.example', 'audio')).toBe('allow');
}, 60_000);
