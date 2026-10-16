import { app, dialog, type Extension } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { ExtensionHostBridge } from './host-bridge';
type Grants = { permissions: string[]; origins: string[] };
const list = (value: unknown): string[] => Array.isArray(value) && value.every(v => typeof v === 'string') ? [...new Set(value)] : [];
const isOrigin = (s: string) => s === '<all_urls>' || s.includes('://');
/** Optional grants are explicit, durable and revocable. Never mutate manifests
 * to give Chromium more page access than the extension declared. */
export class ExtensionPermissions {
  onChanged: () => Promise<void> = async () => {};
  private optional: Record<string, Grants> = {};
  private readonly file = path.join(app.getPath('userData'), 'browser-extension-permissions.json');
  constructor(host: ExtensionHostBridge) {
    try { const data = JSON.parse(readFileSync(this.file, 'utf8')); if (data && typeof data === 'object' && !Array.isArray(data)) this.optional = data; } catch { /* first launch */ }
    host.handle('permissions.getAll', ({ extension }) => this.all(extension));
    host.handle('permissions.contains', ({ extension }, raw: Grants) => this.contains(extension, this.parse(raw)));
    host.handle('permissions.remove', async ({ extension }, raw: Grants) => {
      const requested = this.parse(raw), required = this.required(extension);
      if (requested.permissions.some(p => required.permissions.includes(p)) || requested.origins.some(p => required.origins.includes(p))) return false;
      const before = this.optional[extension.id] ?? { permissions: [], origins: [] };
      const removed = { permissions: list(before.permissions).filter(p => requested.permissions.includes(p)), origins: list(before.origins).filter(p => requested.origins.includes(p)) };
      this.optional[extension.id] = { permissions: list(before.permissions).filter(p => !removed.permissions.includes(p)), origins: list(before.origins).filter(p => !removed.origins.includes(p)) };
      this.save(); await this.onChanged(); if (removed.permissions.length || removed.origins.length) host.emit(extension.id, 'permissions.onRemoved', removed);
      return true;
    });
    host.handle('permissions.request', async ({ extension }, raw: Grants) => {
      const requested = this.parse(raw); if (this.contains(extension, requested)) return true;
      const declared = { permissions: list(extension.manifest.optional_permissions).filter(p => !isOrigin(p)), origins: [...list(extension.manifest.optional_host_permissions), ...list(extension.manifest.optional_permissions).filter(isOrigin)] };
      if (requested.permissions.some(p => !declared.permissions.includes(p) && !this.has(extension, p))
        || requested.origins.some(p => !declared.origins.includes(p) && !this.all(extension).origins.includes(p))) throw Error('Permission was not declared as optional.');
      // Native scripting/host grants cannot be changed through Electron's API.
      // Report this limitation rather than granting access only in our shim.
      if (requested.origins.length || requested.permissions.some(p => !['proxy', 'privacy', 'browsingData', 'downloads'].includes(p) && !this.has(extension, p))) {
        throw Error('Optional permission is not supported by this browser.');
      }
      const parent = host.activeTab(); const window = parent && host.parent(parent);
      if (!window) return false;
      const answer = await dialog.showMessageBox(window, { type: 'question', message: `Allow “${extension.name}” additional permissions?`, detail: [...requested.permissions, ...requested.origins].join('\n'), buttons: ['Cancel', 'Allow'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1 || !host.session.extensions.getExtension(extension.id)) return false;
      const before = this.optional[extension.id] ?? { permissions: [], origins: [] };
      this.optional[extension.id] = { permissions: [...new Set([...list(before.permissions), ...requested.permissions])], origins: [...new Set([...list(before.origins), ...requested.origins])] };
      this.save(); await this.onChanged(); host.emit(extension.id, 'permissions.onAdded', requested); return true;
    });
  }
  private parse(raw: Grants): Grants {
    if (!raw || typeof raw !== 'object' || (raw.permissions !== undefined && (!Array.isArray(raw.permissions) || raw.permissions.some(p => typeof p !== 'string'))) || (raw.origins !== undefined && (!Array.isArray(raw.origins) || raw.origins.some(p => typeof p !== 'string')))) throw Error('Invalid permission request.');
    return { permissions: list(raw.permissions), origins: list(raw.origins) };
  }
  private required(extension: Extension): Grants {
    return { permissions: list(extension.manifest.permissions).filter(p => !isOrigin(p)), origins: [...new Set([...list(extension.manifest.host_permissions), ...list(extension.manifest.permissions).filter(isOrigin)])] };
  }
  all(extension: Extension): Grants {
    const required = this.required(extension), optional = this.optional[extension.id];
    const declared = list(extension.manifest.optional_permissions);
    return { permissions: [...new Set([...required.permissions, ...list(optional?.permissions).filter(p => declared.includes(p))])], origins: required.origins };
  }
  contains(extension: Extension, grants: Grants): boolean {
    const all = this.all(extension); return grants.permissions.every(p => all.permissions.includes(p)) && grants.origins.every(p => all.origins.includes(p));
  }
  has(extension: Extension, permission: string): boolean { return this.all(extension).permissions.includes(permission); }
  require(extension: Extension, permission: string): void { if (!this.has(extension, permission)) throw Error(`The ${permission} permission is required.`); }
  forget(id: string): void { delete this.optional[id]; this.save(); }
  private save(): void { writeFileSync(`${this.file}.tmp`, JSON.stringify(this.optional)); renameSync(`${this.file}.tmp`, this.file); }
}
