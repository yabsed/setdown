import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { builtinLanguageServers } from './catalog/profiles';
import { matchesLanguagePattern } from '../../core/document/language-support';
import path from 'node:path';
import { languageRoot } from './language-root';
import type { ClientCapabilities } from 'vscode-languageserver-protocol';
import { clangdOptions, isClangd, isJsonServer, isSvelteServer, isTypeScriptServer, jsonOptions, svelteOptions, toolCapabilities, typescriptOptions } from './extension-rules';
import type { ToolRules } from './tool-signals';
import { clientCapabilities } from '../../protocol/language-features';

export type ServerProfile = {
  name: string; missingExecutableMessage?: string;
  configuration: Record<string, unknown>; initializationOptions?: Record<string, unknown>;
  renameAfterDiagnostics?: boolean;
  capabilities?: ClientCapabilities;
  /** What the tool's own extension listens to and answers beyond the protocol (`tool-rules.ts`). */
  rules?: ToolRules;
  watches(file: string): boolean;
};
export function serverProfile(definition: LanguageServerDefinition, options?: { settings?: Record<string, unknown>; initializationOptions?: Record<string, unknown> }): ServerProfile {
  const bundledPyright = definition.id === 'pyright' && definition.launch.kind === 'bundledNode';
  const configuration = options?.settings ?? definition.settings;
  let initializationOptions: Record<string, unknown> = { ...(bundledPyright ? { disablePullDiagnostics: true } : {}),
    ...(options?.initializationOptions ?? definition.initializationOptions) };
  // What each tool's own editor extension tells it at startup (`extension-rules.ts`).
  if (isSvelteServer(definition)) initializationOptions = svelteOptions(configuration, initializationOptions);
  if (isTypeScriptServer(definition)) initializationOptions = typescriptOptions(configuration, initializationOptions);
  if (isJsonServer(definition)) initializationOptions = jsonOptions(initializationOptions);
  if (isClangd(definition)) initializationOptions = clangdOptions(configuration, initializationOptions);
  if (definition.id === 'typescript-language-server' && definition.launch.kind === 'bundledNode') {
    const sdk = require.resolve('typescript/lib/tsserver.js').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    Object.assign(initializationOptions, { tsserver: { path: sdk, ...(initializationOptions as { tsserver?: object }).tsserver } });
  }
  return { name: definition.name, configuration, capabilities: toolCapabilities(definition, clientCapabilities()),
    // Pyright enumerates workspace sources asynchronously. A rename before the
    // first analysis can return only the open file. Its first push diagnostic is
    // the barrier after enumeration; do not equate initialize with index readiness.
    initializationOptions, renameAfterDiagnostics: bundledPyright && initializationOptions.disablePullDiagnostics !== false,
    missingExecutableMessage: 'Open Edit → Language Support to select an installed executable.',
    watches: file => definition.watchExtensions.some(extension => file.toLowerCase().endsWith(extension.toLowerCase()))
      || definition.watchFiles.some(name => matchesLanguagePattern(path.basename(file), name)) };
}
export const serverProfiles = Object.fromEntries(builtinLanguageServers.map(definition => [definition.id, serverProfile(definition)]));
export const clangdArgs = builtinLanguageServers.find(definition => definition.id === 'clangd')!.launch.args;
export function standaloneLanguageRoot(file: string, server: string | LanguageServerDefinition): string {
  const definition = typeof server === 'string' ? builtinLanguageServers.find(item => item.id === server) : server;
  return definition ? languageRoot(file, definition).path : path.dirname(file);
}
