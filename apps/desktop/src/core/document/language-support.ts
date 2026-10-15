/** Routing metadata is independent of analysis, installation and editor APIs. */
export type LanguageRoute = {
  server: string; languageId: string; monacoId?: string;
  extensions: string[]; caseSensitiveExtensions?: string[];
};
export const defaultLanguageRoutes: LanguageRoute[] = [
  { server: 'pyright', languageId: 'python', extensions: ['.py', '.pyi'] },
  { server: 'clangd', languageId: 'c', extensions: ['.c', '.h'] },
  { server: 'clangd', languageId: 'cpp', caseSensitiveExtensions: ['.C'],
    extensions: ['.cc', '.cpp', '.cxx', '.c++', '.hh', '.hpp', '.hxx', '.h++', '.ipp', '.inl', '.tpp', '.ixx', '.cppm'] },
];
export function languageSupport(file: string, routes = defaultLanguageRoutes): { server: string; languageId: string } | null {
  const exact = routes.find(route => route.caseSensitiveExtensions?.some(extension => file.endsWith(extension)));
  const lower = file.toLowerCase();
  const route = exact ?? routes.filter(route => route.extensions.some(extension => lower.endsWith(extension.toLowerCase())))
    .sort((a, b) => Math.max(...b.extensions.filter(e => lower.endsWith(e.toLowerCase())).map(e => e.length))
      - Math.max(...a.extensions.filter(e => lower.endsWith(e.toLowerCase())).map(e => e.length)))[0];
  return route ? { server: route.server, languageId: route.languageId } : null;
}
