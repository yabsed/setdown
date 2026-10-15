/** Routing metadata is independent of analysis, installation and editor APIs. */
export type LanguageRoute = {
  server: string; languageId: string; monacoId?: string;
  extensions: string[]; caseSensitiveExtensions?: string[];
  filenames?: string[]; filenamePatterns?: string[];
};
export const defaultLanguageRoutes: LanguageRoute[] = [
  { server: 'pyright', languageId: 'python', extensions: ['.py', '.pyi'] },
  { server: 'clangd', languageId: 'c', extensions: ['.c', '.h'] },
  { server: 'clangd', languageId: 'cpp', caseSensitiveExtensions: ['.C'],
    extensions: ['.cc', '.cpp', '.cxx', '.c++', '.hh', '.hpp', '.hxx', '.h++', '.ipp', '.inl', '.tpp', '.ixx', '.cppm'] },
];
export function languageSupport(file: string, routes = defaultLanguageRoutes): { server: string; languageId: string } | null {
  const normalized = file.replace(/\\/g, '/');
  const name = normalized.split('/').at(-1)!;
  const named = routes.find(route => route.filenames?.includes(name));
  let patterned: LanguageRoute | undefined, specificity = -1;
  for (const candidate of routes) for (const pattern of candidate.filenamePatterns ?? []) {
    const score = pattern.replace(/[*?]/g, '').length;
    if (score > specificity && matchesLanguagePattern(normalized, pattern)) { patterned = candidate; specificity = score; }
  }
  const exact = routes.find(route => route.caseSensitiveExtensions?.some(extension => file.endsWith(extension)));
  const lower = file.toLowerCase();
  const route = named ?? patterned ?? exact ?? routes.filter(route => route.extensions.some(extension => lower.endsWith(extension.toLowerCase())))
    .sort((a, b) => Math.max(...b.extensions.filter(e => lower.endsWith(e.toLowerCase())).map(e => e.length))
      - Math.max(...a.extensions.filter(e => lower.endsWith(e.toLowerCase())).map(e => e.length)))[0];
  return route ? { server: route.server, languageId: route.languageId } : null;
}

// Imported globs are normalized to *, ** and ? (brace alternatives expanded offline).
// Match suffix path segments, never arbitrary regular expressions from definitions.
const patterns = new Map<string, RegExp>();
export function matchesLanguagePattern(file: string, pattern: string): boolean {
  let expression = patterns.get(pattern);
  if (!expression) {
    const parts = pattern.split(/(\*\*\/|\*\*|\*|\?)/g).map(part =>
      part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]'
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    expression = new RegExp(`(?:^|/)${parts.join('')}$`);
    if (patterns.size >= 1024) patterns.clear();
    patterns.set(pattern, expression);
  }
  return expression.test(file.replace(/\\/g, '/'));
}
