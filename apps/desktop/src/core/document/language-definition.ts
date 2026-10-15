import { defaultLanguageRoutes, type LanguageRoute } from './language-support';

export type LanguageServerDefinition = {
  id: string; name: string; enabledByDefault?: boolean; languages: Omit<LanguageRoute, 'server'>[];
  launch: { kind: 'native'; command: string; args: string[]; environmentVariable?: string; legacySettingsFile?: string }
    | { kind: 'bundledNode'; module: string; args: string[] };
  rootMarkers: string[];
  settings: Record<string, unknown>;
  initializationOptions?: Record<string, unknown>;
  watchExtensions: string[]; watchFiles: string[];
};
const languages = (id: string) => defaultLanguageRoutes.filter(route => route.server === id).map(({ server: _server, ...route }) => route);
export const builtinLanguageServers: LanguageServerDefinition[] = [
  { id: 'pyright', name: 'Pyright', enabledByDefault: true, languages: languages('pyright'),
    launch: { kind: 'bundledNode', module: 'pyright/langserver.index.js', args: ['--stdio'] }, rootMarkers: [],
    settings: { python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFiles', typeCheckingMode: 'basic' } } },
    watchExtensions: ['.py', '.pyi', '.toml', '.json'], watchFiles: [] },
  { id: 'clangd', name: 'clangd', enabledByDefault: true, languages: languages('clangd'),
    launch: { kind: 'native', command: 'clangd', args: ['--background-index', '--pch-storage=disk', '-j=2', '--log=error'],
      environmentVariable: 'SETDOWN_CLANGD_PATH', legacySettingsFile: 'clangd.json' },
    rootMarkers: ['.clangd', 'compile_commands.json', 'compile_flags.txt', '.git', 'CMakeLists.txt'], settings: {},
    watchExtensions: [...languages('clangd').flatMap(language => language.extensions)],
    watchFiles: ['.clangd', '.clang-format', 'compile_commands.json', 'compile_flags.txt'] },
  { id: 'gopls', name: 'gopls', languages: [{ languageId: 'go', extensions: ['.go'] }],
    launch: { kind: 'native', command: 'gopls', args: [] }, rootMarkers: ['go.work', 'go.mod', '.git'], settings: {},
    watchExtensions: ['.go'], watchFiles: ['go.mod', 'go.sum', 'go.work'] },
  { id: 'rust-analyzer', name: 'rust-analyzer', languages: [{ languageId: 'rust', extensions: ['.rs'] }],
    launch: { kind: 'native', command: 'rust-analyzer', args: [] }, rootMarkers: ['Cargo.toml', 'rust-project.json', '.git'], settings: {},
    watchExtensions: ['.rs', '.toml'], watchFiles: ['Cargo.lock'] },
];

/** User definitions contain data only. Launches are resolved in the process host. */
export function validateLanguageDefinition(value: unknown): LanguageServerDefinition {
  const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
    && !Object.keys(v).some(key => ['__proto__', 'constructor', 'prototype'].includes(key));
  const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
  const strings = (v: unknown, max = 128): v is string[] => Array.isArray(v) && v.length <= max && v.every(item => text(item, 4096));
  if (!record(value) || !text(value.id, 80) || ['__proto__', 'constructor', 'prototype'].includes(value.id) || !/^[a-z0-9][a-z0-9._-]*$/.test(value.id) || !text(value.name)
    || !record(value.launch) || value.launch.kind !== 'native' || !text(value.launch.command, 4096)
    || !strings(value.launch.args) || !Array.isArray(value.languages) || !value.languages.length || value.languages.length > 32)
    throw new Error('Provide an ID, name, native executable, arguments and at least one language.');
  const associations = value.languages.map((language: unknown) => {
    if (!record(language) || !text(language.languageId, 80) || ['__proto__', 'constructor', 'prototype'].includes(language.languageId) || !/^[\w+-]+$/.test(language.languageId)
      || (language.monacoId !== undefined && (!text(language.monacoId, 80) || !/^[\w+-]+$/.test(language.monacoId)))
      || !strings(language.extensions) || !language.extensions.length
      || (language.caseSensitiveExtensions !== undefined && !strings(language.caseSensitiveExtensions))
      || [...language.extensions, ...(language.caseSensitiveExtensions ?? [])].some(e => !/^\.[\w.+-]+$/.test(e)))
      throw new Error('Each language needs a language ID and file extensions such as .go or .rs.');
    return { languageId: language.languageId, monacoId: language.monacoId, extensions: language.extensions,
      caseSensitiveExtensions: language.caseSensitiveExtensions };
  });
  for (const field of ['rootMarkers', 'watchFiles', 'watchExtensions']) {
    if (value[field] !== undefined && !strings(value[field])) throw new Error(`Invalid ${field}.`);
  }
  if ((value.rootMarkers ?? []).concat(value.watchFiles ?? []).some((name: string) => /[/\\]/.test(name) || name === '..'))
    throw new Error('Root markers and watched names must be file names.');
  for (const field of ['settings', 'initializationOptions'])
    if (value[field] !== undefined && !record(value[field])) throw new Error(`${field} must be a JSON object.`);
  if (JSON.stringify(value).length > 128 * 1024) throw new Error('Language definition is too large.');
  return { id: value.id, name: value.name, languages: associations,
    launch: { kind: 'native', command: value.launch.command, args: value.launch.args },
    rootMarkers: value.rootMarkers ?? [], settings: value.settings ?? {}, initializationOptions: value.initializationOptions,
    watchExtensions: value.watchExtensions ?? associations.flatMap(l => l.extensions), watchFiles: value.watchFiles ?? [] };
}
