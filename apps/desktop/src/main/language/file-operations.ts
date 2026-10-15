import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FileOperationRegistrationOptions } from 'vscode-languageserver-protocol';

export type LanguageFileOperation = { kind: 'create' | 'rename' | 'delete'; files: { path: string; to?: string; directory: boolean }[] };
export const fileOperationMethod = (operation: LanguageFileOperation, phase: 'will' | 'did') =>
  `workspace/${phase}${operation.kind === 'create' ? 'Create' : operation.kind === 'rename' ? 'Rename' : 'Delete'}Files`;
export function filteredFileOperation(operation: LanguageFileOperation, options: FileOperationRegistrationOptions[]) {
  const files = operation.files.filter(file => options.some(option => option.filters.some(filter => {
    if (!filter?.pattern || typeof filter.pattern.glob !== 'string') return false;
    if (filter.scheme && filter.scheme !== 'file') return false;
    const { pattern } = filter;
    if (pattern.matches && (pattern.matches === 'folder') !== file.directory) return false;
    const glob = pattern.options?.ignoreCase ? pattern.glob.toLowerCase() : pattern.glob;
    // Both sides of a rename are relevant (e.g. moving into a watched source folder).
    try { return [file.path, file.to].some(candidate => candidate && path.matchesGlob(pattern.options?.ignoreCase ? candidate.toLowerCase() : candidate, glob)); } catch { return false; }
  })));
  return { files: files.map(file => operation.kind === 'rename' ? { oldUri: pathToFileURL(file.path).href, newUri: pathToFileURL(file.to!).href }
    : { uri: pathToFileURL(file.path).href }) };
}
