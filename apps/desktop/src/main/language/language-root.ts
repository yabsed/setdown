import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseJson } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { matchesLanguagePattern } from '../../core/document/language-support';
import { isInside } from '../documents/file-system';

export type LanguageRoot = { path: string; reason: string };
/** Read metadata only. Root discovery must never execute project code or scan a tree. */
export function projectManifest(file: string): Record<string, any> {
  try {
    if (statSync(file).size > 1024 * 1024) return {};
    const text = readFileSync(file, 'utf8');
    const value = file.endsWith('.toml') ? parseToml(text) : parseJson(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function languageRoot(file: string, definition: LanguageServerDefinition, folder?: string, override?: string): LanguageRoot {
  const directory = path.dirname(file);
  if (override && isInside(override, file)) {
    if (!statSync(override).isDirectory()) throw Error('The language root override must be a directory.');
    return { path: override, reason: 'User-selected analysis root' };
  }
  const ancestors: string[] = [];
  let repository: string | undefined;
  for (let root = directory; ; root = path.dirname(root)) {
    ancestors.push(root);
    // A submodule/worktree has a .git file. Do not borrow the containing repo's configuration.
    if (existsSync(path.join(root, '.git'))) { repository = root; break; }
    if (path.dirname(root) === root) break;
  }
  const found = (root: string, marker: string): LanguageRoot => ({ path: root, reason: `Project marker: ${marker}` });
  const rust = definition.languages.some(language => language.languageId === 'rust');
  if (rust) {
    const crate = ancestors.find(root => existsSync(path.join(root, 'Cargo.toml')));
    if (crate) {
      const manifest = projectManifest(path.join(crate, 'Cargo.toml'));
      const explicit = manifest.package?.workspace;
      if (typeof explicit === 'string') {
        const workspace = path.resolve(crate, explicit);
        if ((!repository || isInside(repository, workspace)) && projectManifest(path.join(workspace, 'Cargo.toml')).workspace)
          return found(workspace, 'Cargo.toml (package.workspace)');
      }
      for (const root of ancestors.slice(ancestors.indexOf(crate))) {
        const workspace = projectManifest(path.join(root, 'Cargo.toml')).workspace;
        if (!workspace || typeof workspace !== 'object') continue;
        const relative = path.relative(root, crate).split(path.sep).join('/');
        const matches = (patterns: unknown) => Array.isArray(patterns) && patterns.some(pattern =>
          typeof pattern === 'string' && matchesLanguagePattern(relative, pattern.replace(/\/$/, '')));
        if (root === crate || matches(workspace.members) && !matches(workspace.exclude))
          return found(root, 'Cargo.toml (workspace)');
        // An excluded crate or nested workspace must not inherit an outer workspace.
        break;
      }
      return found(crate, 'Cargo.toml');
    }
  }
  // A ts/jsconfig is more specific than a package or lockfile. TypeScript owns
  // project references; choosing an outer package must not hide a nested config.
  const typescript = definition.languages.some(language => ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(language.languageId));
  if (typescript) for (const root of ancestors) {
    const marker = ['tsconfig.json', 'jsconfig.json'].find(name => existsSync(path.join(root, name)));
    if (marker) return found(root, marker);
    if (existsSync(path.join(root, 'package.json'))) return found(root, 'package.json');
  }
  for (const root of ancestors) {
    const exact = definition.rootMarkers.find(marker => !/[*?]/.test(marker) && existsSync(path.join(root, marker)));
    if (exact) return found(root, exact);
    const patterns = definition.rootMarkers.filter(marker => /[*?]/.test(marker));
    if (patterns.length) try {
      const match = readdirSync(root).find(name => patterns.some(pattern => matchesLanguagePattern(name, pattern)));
      if (match) return found(root, match);
    } catch { /* An inaccessible ancestor is not an analysis project. */ }
  }
  if (repository) return { path: repository, reason: 'Repository boundary (.git)' };
  if (folder && isInside(folder, file)) return { path: folder, reason: 'Open folder (no project marker)' };
  return { path: directory, reason: 'File directory (no project marker)' };
}
