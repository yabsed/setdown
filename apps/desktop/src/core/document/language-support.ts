/** Cheap routing shared by main and renderer; no editor or server imports. */
export type LanguageServerKind = 'pyright' | 'clangd';
export function languageSupport(file: string): { server: LanguageServerKind; languageId: 'python' | 'c' | 'cpp' } | null {
  if (/\.pyi?$/i.test(file)) return { server: 'pyright', languageId: 'python' };
  // Uppercase .C is conventionally C++; plain .h works for both languages via
  // clangd's compilation database/header inference (Monaco highlights it as C).
  if (file.endsWith('.C')) return { server: 'clangd', languageId: 'cpp' };
  if (/\.(c|h)$/i.test(file)) return { server: 'clangd', languageId: 'c' };
  if (/\.(cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|ipp|inl|tpp|ixx|cppm)$/i.test(file))
    return { server: 'clangd', languageId: 'cpp' };
  return null;
}
