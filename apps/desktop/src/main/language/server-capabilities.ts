import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Registration, ServerCapabilities, DocumentSelector, FileSystemWatcher, FileOperationRegistrationOptions } from 'vscode-languageserver-protocol';
import { languageFeatures } from '../../protocol/language-features';
import type { LanguageCapabilities } from '../../protocol/language';

const methods = new Map<string, keyof ServerCapabilities>(Object.entries(languageFeatures).map(([name, key]) =>
  [name === 'workspaceSymbol' ? 'workspace/symbol' : `textDocument/${name === 'color' ? 'documentColor' : name === 'documentFormatting' ? 'formatting' : name === 'documentRangeFormatting' ? 'rangeFormatting' : name === 'documentOnTypeFormatting' ? 'onTypeFormatting' : name}`, key]));
methods.set('textDocument/prepareCallHierarchy', 'callHierarchyProvider');
methods.set('textDocument/prepareTypeHierarchy', 'typeHierarchyProvider');

/** Registrations are session-local and applied to each document selector independently. */
export class ServerCapabilitiesState {
  private registrations = new Map<string, Registration>();
  base: ServerCapabilities = {};
  constructor(private readonly root: string) {}
  register(registrations: Registration[]): void {
    if (!Array.isArray(registrations) || registrations.length > 100 || this.registrations.size + registrations.length > 256)
      throw Error('Too many language registrations.');
    for (const registration of registrations) {
      if (!methods.has(registration.method) && registration.method !== 'workspace/didChangeWatchedFiles' && !/^workspace\/(will|did)(Create|Rename|Delete)Files$/.test(registration.method))
        throw Error(`Unsupported dynamic language registration: ${registration.method}`);
      if (typeof registration.id !== 'string' || registration.id.length > 256) throw Error('Invalid registration ID.');
    }
    for (const registration of registrations) this.registrations.set(registration.id, registration);
  }
  unregister(ids: string[]): void { for (const id of ids) this.registrations.delete(id); }
  forDocument(uri: string, language: string): LanguageCapabilities {
    const result: LanguageCapabilities = { ...this.base };
    for (const key of Object.values(languageFeatures)) {
      const options = result[key];
      if (options && typeof options === 'object' && 'documentSelector' in options
        && !this.matches(options.documentSelector, uri, language)) delete result[key];
    }
    const diagnostics: NonNullable<LanguageCapabilities['diagnosticProviders']> = result.diagnosticProvider
      ? [{ id: 'static', options: result.diagnosticProvider }] : [];
    for (const registration of this.registrations.values()) {
      const key = methods.get(registration.method);
      const options = registration.registerOptions ?? {};
      if (!key || !this.matches(options.documentSelector, uri, language)) continue;
      if (key === 'diagnosticProvider') diagnostics.push({ id: `registration:${registration.id}`, options });
      else Object.assign(result, { [key]: options });
    }
    if (diagnostics.length) {
      result.diagnosticProviders = diagnostics;
      result.diagnosticProvider = { ...diagnostics[0].options,
        interFileDependencies: diagnostics.some(provider => provider.options.interFileDependencies) };
    }
    return result;
  }
  fileOperation(method: string): FileOperationRegistrationOptions[] {
    const key = method.slice('workspace/'.length).replace(/Files$/, '') as keyof NonNullable<NonNullable<ServerCapabilities['workspace']>['fileOperations']>;
    return [this.base.workspace?.fileOperations?.[key], ...[...this.registrations.values()].filter(r => r.method === method).map(r => r.registerOptions)]
      .filter((options): options is FileOperationRegistrationOptions => !!options && Array.isArray(options.filters));
  }
  watches(file: string, type: number): boolean {
    for (const registration of this.registrations.values()) {
      if (registration.method !== 'workspace/didChangeWatchedFiles' && !/^workspace\/(will|did)(Create|Rename|Delete)Files$/.test(registration.method)) continue;
      const watchers: FileSystemWatcher[] = registration.registerOptions?.watchers ?? [];
      if (watchers.slice(0, 256).some(watcher => ((watcher.kind ?? 7) & (1 << (type - 1))) && this.glob(file, watcher.globPattern))) return true;
    }
    return false;
  }
  private glob(file: string, pattern: FileSystemWatcher['globPattern']): boolean {
    try {
      if (typeof pattern === 'string') return path.matchesGlob(file, pattern) || path.matchesGlob(path.relative(this.root, file), pattern);
      const base = fileURLToPath(typeof pattern.baseUri === 'string' ? pattern.baseUri : pattern.baseUri.uri);
      const relative = path.relative(base, file);
      return !relative.startsWith('..') && !path.isAbsolute(relative) && path.matchesGlob(relative, pattern.pattern);
    } catch { return false; }
  }
  private matches(selector: DocumentSelector | null | undefined, uri: string, language: string): boolean {
    if (!selector) return true;
    if (!Array.isArray(selector)) return false;
    return selector.some(filter => typeof filter === 'string' ? filter === language : 'notebook' in filter ? false :
      (!filter.language || filter.language === language) && (!filter.scheme || filter.scheme === 'file')
      && (!filter.pattern || this.glob(fileURLToPath(uri), filter.pattern)));
  }
}
