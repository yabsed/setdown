import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const electron = vi.hoisted(() => ({ app: { getPath: vi.fn(), on: vi.fn() }, dialog: { showMessageBox: vi.fn() }, webContents: {} }));
vi.mock('electron', () => electron);
import { electronProxy } from './extension-network';
import { ExtensionPermissions } from './extension-permissions';
import { ExtensionProxyAuth } from './extension-proxy-auth';
import type { ExtensionHostBridge } from './host-bridge';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'setdown-extension-policy-')); electron.app.getPath.mockReturnValue(root); electron.dialog.showMessageBox.mockResolvedValue({ response: 1 }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.clearAllMocks(); });
function fixture() {
  const extension = { id: 'a'.repeat(32), name: 'Fixture', manifest: { permissions: ['storage'], optional_permissions: ['privacy', 'proxy'], optional_host_permissions: ['https://example.com/*'] } };
  const handlers = new Map<string, (...args: any[]) => any>();
  const host = { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn), emit: vi.fn(), activeTab: () => ({}), parent: () => ({}), tabs: () => [],
    session: { extensions: { on: vi.fn(), getExtension: () => extension } } };
  const permissions = new ExtensionPermissions(host as unknown as ExtensionHostBridge);
  return { extension, host, permissions, call: (name: string, ...args: any[]) => handlers.get(name)!({ extension }, ...args), handlers };
}
test('proxy conversion validates schemes and prevents proxy-rule injection', () => {
  expect(electronProxy({ mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', host: 'gateway.test', port: 443 }, bypassList: ['localhost', '<-loopback>'] } }))
    .toEqual({ mode: 'fixed_servers', proxyRules: 'https://gateway.test:443', proxyBypassRules: 'localhost;<-loopback>' });
  expect(electronProxy({ mode: 'pac_script', pacScript: { url: 'https://proxy.test/config.pac', mandatory: true } })).toEqual({ mode: 'pac_script', pacScript: 'https://proxy.test/config.pac' });
  expect(() => electronProxy({ mode: 'pac_script', pacScript: { url: 'https://proxy.test/config.pac' } })).toThrow('mandatory');
  expect(electronProxy({ mode: 'direct' })).toEqual({ mode: 'direct' });
  expect(() => electronProxy({ mode: 'fixed_servers', rules: { singleProxy: { host: 'gateway;direct://' } } })).toThrow('host');
  expect(() => electronProxy({ mode: 'fixed_servers', rules: { singleProxy: { host: 'gateway', port: 0 } } })).toThrow('port');
  expect(() => electronProxy({ mode: 'fixed_servers', rules: {} })).toThrow('No proxy');
  expect(() => electronProxy({ mode: 'pac_script', pacScript: { data: 'function FindProxyForURL(){return "DIRECT"}' } })).toThrow('PAC');
});
test('optional grants need confirmation, survive restart, revoke and never fabricate native host grants', async () => {
  const f = fixture();
  electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
  expect(await f.call('permissions.request', { permissions: ['privacy'] })).toBe(false);
  expect(await f.call('permissions.contains', { permissions: ['privacy'] })).toBe(false);
  expect(await f.call('permissions.request', { permissions: ['privacy'] })).toBe(true);
  expect(fixture().call('permissions.contains', { permissions: ['privacy'] })).toBe(true);
  expect(await f.call('permissions.remove', { permissions: ['privacy'] })).toBe(true);
  expect(await f.call('permissions.contains', { permissions: ['privacy'] })).toBe(false);
  expect(await f.call('permissions.remove', { permissions: ['storage'] })).toBe(false);
  await expect(f.call('permissions.request', { permissions: ['downloads'] })).rejects.toThrow('not declared');
  await expect(f.call('permissions.request', { origins: ['https://example.com/*'] })).rejects.toThrow('not supported');
  expect(() => f.call('permissions.contains', { permissions: [42] })).toThrow('Invalid');
  expect(f.host.emit).toHaveBeenCalledWith(f.extension.id, 'permissions.onRemoved', { permissions: ['privacy'], origins: [] });
});
test('proxy authentication is scoped to the profile, controlling extension and exact challenge', async () => {
  const f = fixture(); f.extension.manifest.permissions.push('webRequest', 'webRequestAuthProvider');
  const auth = new ExtensionProxyAuth(f.host as unknown as ExtensionHostBridge, f.permissions, (hostname, port) => hostname === 'proxy.test' && port === 443 ? f.extension.id : undefined);
  const details = { url: 'https://site.test/', firstAuthAttempt: true, isRequestForNavigation: true, pid: 0 };
  const challenge = { isProxy: true, host: 'proxy.test', port: 443, scheme: 'basic', realm: 'test' };
  const event = { defaultPrevented: false, preventDefault: vi.fn() }, reply = vi.fn();
  expect(auth.request(event as never, null, details, challenge, reply)).toBe(false);
  expect(auth.request(event as never, { session: {} } as never, details, challenge, reply)).toBe(false);
  expect(auth.request(event as never, { session: f.host.session } as never, details, { ...challenge, host: 'attacker.test' }, reply)).toBe(false);
  expect(auth.request(event as never, { session: f.host.session } as never, details, challenge, reply)).toBe(true);
  const token = f.host.emit.mock.calls[0][3];
  expect(() => f.handlers.get('proxy.authResponse')!({ extension: { id: 'b'.repeat(32) } }, token, { authCredentials: { username: 'x', password: 'x' } })).toThrow('Unknown');
  await f.call('proxy.authResponse', token, { authCredentials: { username: 'fixture', password: 'secret' } });
  expect(reply).toHaveBeenCalledExactlyOnceWith('fixture', 'secret');
  expect(() => f.call('proxy.authResponse', token, {})).toThrow('Unknown');
  auth.cancel(); expect(reply).toHaveBeenCalledTimes(1);
});
