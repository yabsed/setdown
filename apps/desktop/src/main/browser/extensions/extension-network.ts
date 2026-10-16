import { app, webContents, type Extension, type ProxyConfig } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { ExtensionProxyAuth } from './extension-proxy-auth';
import type { ExtensionHostBridge } from './host-bridge';
import { ExtensionPermissions } from './extension-permissions';
type ProxyValue = { mode: string; rules?: { singleProxy?: Server; proxyForHttp?: Server; proxyForHttps?: Server; proxyForFtp?: Server; fallbackProxy?: Server; bypassList?: string[] }; pacScript?: { url?: string; data?: string; mandatory?: boolean } };
type Server = { host: string; port?: number; scheme?: string };
type Setting = { value: unknown; order: number };
const policies = ['default', 'default_public_and_private_interfaces', 'default_public_interface_only', 'disable_non_proxied_udp'] as const;
export function electronProxy(value: ProxyValue): ProxyConfig {
  if (!value || typeof value !== 'object') throw Error('Invalid proxy configuration.');
  if (['system', 'direct', 'auto_detect'].includes(value.mode)) return { mode: value.mode as ProxyConfig['mode'] };
  if (value.mode === 'pac_script') {
    const script = value.pacScript;
    if (!script?.url || !/^https?:\/\//.test(script.url) || script.data || script.mandatory !== true) throw Error('Only mandatory HTTP(S) PAC URLs are supported.');
    return { mode: 'pac_script', pacScript: script.url };
  }
  if (value.mode !== 'fixed_servers' || !value.rules) throw Error('Unsupported proxy mode.');
  const endpoint = (server: Server) => {
    if (!server || typeof server.host !== 'string' || !/^(?:[a-z0-9._-]+|\[[a-f0-9:]+\])$/i.test(server.host)) throw Error('Invalid proxy host.');
    const scheme = server.scheme ?? 'http';
    if (!['http', 'https', 'socks4', 'socks5'].includes(scheme)) throw Error('Unsupported proxy scheme.');
    if (server.port !== undefined && (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) throw Error('Invalid proxy port.');
    return `${scheme}://${server.host}${server.port === undefined ? '' : `:${server.port}`}`;
  };
  const rules = value.rules;
  const mapped = rules.singleProxy ? endpoint(rules.singleProxy) : [['http', rules.proxyForHttp], ['https', rules.proxyForHttps], ['ftp', rules.proxyForFtp], ['socks', rules.fallbackProxy]]
    .filter(([, server]) => server).map(([key, server]) => `${key}=${endpoint(server as Server)}`).join(';');
  if (!mapped) throw Error('No proxy server supplied.');
  if (rules.bypassList !== undefined && (!Array.isArray(rules.bypassList) || rules.bypassList.some(p => typeof p !== 'string' || /[;\n\r]/.test(p)))) throw Error('Invalid proxy bypass list.');
  return { mode: 'fixed_servers', proxyRules: mapped, proxyBypassRules: rules.bypassList?.join(';') };
}
export class ExtensionNetwork {
  readonly auth: ExtensionProxyAuth;
  private readonly file = path.join(app.getPath('userData'), 'browser-extension-network.json');
  private settings: Record<string, Record<string, Setting>> = {};
  private queue = Promise.resolve();
  private appliedProxy = '';
  private failure?: string;
  private announced = new Map<string, string>();
  private policy: typeof policies[number] = 'default';
  constructor(private readonly host: ExtensionHostBridge, private readonly permissions: ExtensionPermissions) {
    try { const data = JSON.parse(readFileSync(this.file, 'utf8')); if (data && typeof data === 'object' && !Array.isArray(data)) this.settings = data; } catch { /* first launch */ }
    this.auth = new ExtensionProxyAuth(host, permissions, (hostname, port) => {
      const owner = this.controller('proxy');
      const value = owner?.setting.value as ProxyValue | undefined;
      if (value?.mode !== 'fixed_servers') return undefined;
      const rules = value.rules;
      const match = [rules?.singleProxy, rules?.proxyForHttp, rules?.proxyForHttps, rules?.fallbackProxy].some(server => server?.host === hostname && (server.port ?? (server.scheme === 'https' ? 443 : server.scheme?.startsWith('socks') ? 1080 : 80)) === port);
      return match ? owner?.id : undefined;
    });
    permissions.onChanged = () => this.serial(() => this.apply());
    for (const name of ['proxy', 'privacy.network.webRTCIPHandlingPolicy']) {
      const permission = name === 'proxy' ? 'proxy' : 'privacy';
      host.handle(`${name}.get`, ({ extension }, details = {}) => {
        permissions.require(extension, permission); this.scope(details);
        this.assertReady();
        const owner = this.controller(name);
        return { value: owner?.setting.value ?? (name === 'proxy' ? { mode: 'system' } : 'default'), incognitoSpecific: false,
          levelOfControl: !owner ? 'controllable_by_this_extension' : owner.id === extension.id ? 'controlled_by_this_extension' : 'controlled_by_other_extensions' };
      });
      for (const operation of ['set', 'clear']) host.handle(`${name}.${operation}`, ({ extension }, details = {}) => this.serial(async () => {
        permissions.require(extension, permission); this.scope(details);
        if (!host.session.extensions.getExtension(extension.id)) throw Error('Extension has been unloaded.');
        if (operation === 'set') {
          if (name === 'proxy') electronProxy(details.value);
          else if (!policies.includes(details.value)) throw Error('Unsupported WebRTC IP handling policy.');
        }
        const before = structuredClone(this.settings);
        const own = this.settings[extension.id] ??= {};
        if (operation === 'clear') delete own[name]; else own[name] = { value: details.value, order: Math.max(Date.now(), ...Object.values(this.settings).flatMap(settings => Object.values(settings).map(setting => (Number.isFinite(setting.order) ? setting.order : 0) + 1))) };
        try { await this.apply(); this.save(); }
        catch (error) { this.settings = before; await this.apply(); throw error; }

      }));
    }
    host.handle('browsingData.remove', ({ extension }, options, data) => this.remove(extension, options, data));
    host.session.extensions.on('extension-loaded', () => { void this.serial(() => this.apply()).catch(console.error); });
    host.session.extensions.on('extension-unloaded', () => { void this.serial(() => this.apply()).catch(console.error); });
    app.on('web-contents-created', (_event, contents) => { if (contents.session === host.session) contents.setWebRTCIPHandlingPolicy(this.policy); });
  }
  ready(): Promise<void> { return this.queue; }
  forget(id: string): void { delete this.settings[id]; this.save(); }
  assertReady(): void { if (this.failure) throw Error(this.failure); }
  errorFor(id?: string): string | undefined { return id && this.controller('proxy')?.id === id ? this.failure : undefined; }
  private serial<T>(task: () => Promise<T>): Promise<T> { const result = this.queue.then(task); this.queue = result.then(() => undefined, () => undefined); return result; }
  private scope(details: { scope?: string; incognito?: boolean }) { if (!details || (details.scope !== undefined && details.scope !== 'regular') || details.incognito) throw Error('Only the regular browser profile is supported.'); }
  private controller(name: string) {
    return this.host.session.extensions.getAllExtensions().filter(ext => this.permissions.has(ext, name === 'proxy' ? 'proxy' : 'privacy'))
      .map(ext => ({ id: ext.id, setting: this.settings[ext.id]?.[name] })).filter(item => item.setting && typeof item.setting.order === 'number').sort((a, b) => b.setting.order - a.setting.order)[0];
  }
  private async apply() {
    try { await this.applySettings(); this.failure = undefined; }
    catch (error) {
      this.failure = `Could not apply extension network settings: ${error instanceof Error ? error.message : String(error)}`;
      const owner = this.controller('proxy');
      if (owner) this.host.emit(owner.id, 'proxy.onProxyError', { fatal: true, error: 'SETDOWN_PROXY_CONFIGURATION_FAILED', details: this.failure });
      throw error;
    }
  }
  private async applySettings() {
    const proxy = this.controller('proxy')?.setting.value as ProxyValue | undefined;
    const config = electronProxy(proxy ?? { mode: 'system' });
    const signature = JSON.stringify(config);
    if (signature !== this.appliedProxy) {
      this.auth.cancel();
      await this.host.session.clearAuthCache();
      await this.host.session.setProxy(config);
      await this.host.session.closeAllConnections();
      this.appliedProxy = signature;
    }
    const policy = this.controller('privacy.network.webRTCIPHandlingPolicy')?.setting.value;
    this.policy = policies.includes(policy as typeof policies[number]) ? policy as typeof policies[number] : 'default';
    for (const contents of webContents.getAllWebContents()) if (contents.session === this.host.session) contents.setWebRTCIPHandlingPolicy(this.policy);
    for (const name of ['proxy', 'privacy.network.webRTCIPHandlingPolicy']) {
      const owner = this.controller(name), signature = JSON.stringify(owner ?? null);
      if (this.announced.get(name) === signature) continue;
      this.announced.set(name, signature);
      for (const extension of this.host.session.extensions.getAllExtensions()) if (this.permissions.has(extension, name === 'proxy' ? 'proxy' : 'privacy')) {
        this.host.emit(extension.id, `${name}.onChange`, { value: owner?.setting.value ?? (name === 'proxy' ? { mode: 'system' } : 'default'), incognitoSpecific: false,
          levelOfControl: owner?.id === extension.id ? 'controlled_by_this_extension' : owner ? 'controlled_by_other_extensions' : 'controllable_by_this_extension' });
      }
    }
  }
  private save() { writeFileSync(`${this.file}.tmp`, JSON.stringify(this.settings)); renameSync(`${this.file}.tmp`, this.file); }
  private async remove(extension: Extension, options: { origins?: string[]; since?: number; excludeOrigins?: string[]; originTypes?: unknown } = {}, data: Record<string, boolean> = {}) {
    this.permissions.require(extension, 'browsingData');
    if (!options || !data || options.excludeOrigins || options.originTypes || (options.since !== undefined && options.since !== 0)) throw Error('This browsing-data filter is not supported.');
    const keys = Object.keys(data).filter(key => data[key]);
    if (keys.some(key => !['cookies', 'cache', 'localStorage', 'indexedDB', 'serviceWorkers'].includes(key))) throw Error('This browsing-data type is not supported.');
    if (options.origins !== undefined && !Array.isArray(options.origins)) throw Error('Invalid browsing-data origins.');
    const origins = options.origins?.map(origin => {
      if (typeof origin !== 'string') throw Error('Invalid browsing-data origin.');
      // Surfshark supplies wildcard subdomains. Chrome cookie deletion operates
      // on the registrable domain; normalize the wildcard before Chromium's
      // public-suffix-aware filter handles it.
      const url = new URL(origin.replace('://*.', '://'));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid browsing-data origin.');
      return url.origin;
    });
    if (origins?.length === 0 || keys.length === 0) return;
    // BrowsingDataRemover uses web-origin masks, unlike clearStorageData's raw
    // StoragePartition wipe which can delete extension-local databases too.
    await this.host.session.clearData({ dataTypes: keys as Array<'cookies' | 'cache' | 'localStorage' | 'indexedDB' | 'serviceWorkers'>,
      ...(origins ? { origins } : {}), originMatchingMode: 'origin-in-all-contexts' });
  }
}
