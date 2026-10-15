import { existsSync } from 'node:fs';
import path from 'node:path';
import { builtinLanguageServers, type LanguageServerDefinition } from '../../core/document/language-definition';

export type ServerProfile = {
  name: string; missingExecutableMessage?: string;
  configuration: Record<string, unknown>; initializationOptions?: Record<string, unknown>;
  watches(file: string): boolean;
};
export function serverProfile(definition: LanguageServerDefinition, options?: { settings?: Record<string, unknown>; initializationOptions?: Record<string, unknown> }): ServerProfile {
  return { name: definition.name, configuration: options?.settings ?? definition.settings,
    initializationOptions: options?.initializationOptions ?? definition.initializationOptions,
    missingExecutableMessage: 'Open Edit → Language Support to select an installed executable.',
    watches: file => definition.watchExtensions.some(extension => file.toLowerCase().endsWith(extension.toLowerCase()))
      || definition.watchFiles.includes(path.basename(file)) };
}
export const serverProfiles = Object.fromEntries(builtinLanguageServers.map(definition => [definition.id, serverProfile(definition)]));
export const clangdArgs = builtinLanguageServers.find(definition => definition.id === 'clangd')!.launch.args;
export function standaloneLanguageRoot(file: string, server: string | LanguageServerDefinition): string {
  const definition = typeof server === 'string' ? builtinLanguageServers.find(item => item.id === server) : server;
  const directory = path.dirname(file);
  if (definition?.rootMarkers.length) for (let root = directory; ; root = path.dirname(root)) {
    if (definition.rootMarkers.some(marker => existsSync(path.join(root, marker)))) return root;
    if (path.dirname(root) === root) break;
  }
  return directory;
}
