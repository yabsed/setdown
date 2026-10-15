import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LanguageServerKind } from '../../core/document/language-support';

export type ServerProfile = {
  name: string;
  missingExecutableMessage?: string;
  configuration: Record<string, unknown>;
  watches(file: string): boolean;
};
const analysis = { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFiles', typeCheckingMode: 'basic' };
export const serverProfiles: Record<LanguageServerKind, ServerProfile> = {
  pyright: { name: 'Python', configuration: { python: { analysis }, 'python.analysis': analysis },
    watches: file => /\.(pyi?|toml|json)$/i.test(file) },
  clangd: { name: 'C/C++ (clangd)', configuration: {},
    missingExecutableMessage: 'Install clangd or use Select clangd Executable in the editor command palette.',
    watches: file => /\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inl|tpp|ixx|cppm)$/i.test(file)
      || ['.clangd', '.clang-format', 'compile_commands.json', 'compile_flags.txt'].includes(path.basename(file)) },
};
// clangd owns flags/header inference. Do not parse or rewrite compilation databases.
export const clangdArgs = ['--background-index', '--pch-storage=disk', '-j=2', '--log=error'];

export function standaloneLanguageRoot(file: string, kind: LanguageServerKind): string {
  const directory = path.dirname(file);
  if (kind === 'clangd') for (let root = directory; ; root = path.dirname(root)) {
    if (['.clangd', 'compile_commands.json', 'compile_flags.txt', '.git', 'CMakeLists.txt']
      .some(marker => existsSync(path.join(root, marker)))) return root;
    if (path.dirname(root) === root) break;
  }
  return directory;
}
