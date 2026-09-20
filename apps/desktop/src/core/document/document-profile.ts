/** Shared policy: no Monaco, filesystem, renderer or worker dependency. */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'];
const MARKDOWN = /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i;
const BINARY = new Set(('pdf png jpg jpeg gif webp avif bmp ico icns tif tiff heic '
  + 'zip gz bz2 xz zst 7z rar tar tgz jar war doc docx xls xlsx ppt pptx odt ods odp '
  + 'exe dll so dylib bin class pyc pyo wasm sqlite sqlite3 db woff woff2 ttf otf eot '
  + 'mp3 mp4 m4a wav ogg flac avi mov mkv webm psd ai sketch').split(' '));

export type DocumentSurface = 'viewer' | 'editor' | 'pdf';
export type DocumentProfile = { readonly kind: 'markdown' | 'text' | 'pdf'; readonly preview: 'markdown' | 'pdf' | null };
const pdf: DocumentProfile = Object.freeze({ kind: 'pdf', preview: 'pdf' });
export const isPdfDocument = (filePath: string): boolean => /\.pdf$/i.test(filePath);
export const isOpenableDocument = (filePath: string): boolean => isPdfDocument(filePath) || isTextCandidate(filePath);
const markdown: DocumentProfile = Object.freeze({ kind: 'markdown', preview: 'markdown' });
const text: DocumentProfile = Object.freeze({ kind: 'text', preview: null });
export const isMarkdownDocument = (filePath: string): boolean => MARKDOWN.test(filePath);
export const documentProfile = (filePath: string): DocumentProfile => isMarkdownDocument(filePath) ? markdown : isPdfDocument(filePath) ? pdf : text;
export const fileName = (filePath: string): string => filePath.split(/[\\/]/).at(-1) ?? filePath;
/** A cheap navigation/search filter, NOT proof that bytes are editable text. */
export function isTextCandidate(filePath: string): boolean {
  const name = fileName(filePath);
  return !BINARY.has(name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '');
}
export function documentSurface(filePath: string, preferred: DocumentSurface = 'viewer'): DocumentSurface {
  return isPdfDocument(filePath) ? 'pdf' : isMarkdownDocument(filePath) ? (preferred === 'pdf' ? 'viewer' : preferred) : 'editor';
}
export type RegisteredLanguage = {
  id: string; extensions?: readonly string[]; filenames?: readonly string[];
  filenamePatterns?: readonly string[]; firstLine?: string;
};
function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}
/** Call only at model creation/retargeting; highlighting never gates file opening. */
export function documentLanguage(filePath: string, languages: readonly RegisteredLanguage[], firstLine = ''): string {
  if (isMarkdownDocument(filePath)) return 'markdown';
  const name = fileName(filePath);
  const lower = name.toLowerCase();
  const exact = languages.find((language) => language.filenames?.includes(name));
  if (exact) return exact.id;
  let found: string | undefined;
  let longest = 0;
  for (const language of languages) for (const extension of language.extensions ?? []) {
    if (extension.length > longest && lower.endsWith(extension.toLowerCase())) {
      found = language.id; longest = extension.length;
    }
  }
  if (found) return found;
  const pattern = languages.find((language) => language.filenamePatterns?.some((value) => matchesPattern(name, value)));
  if (pattern) return pattern.id;
  if ((name === '.env' || name.startsWith('.env.')) && languages.some((language) => language.id === 'ini')) return 'ini';
  for (const language of languages) {
    if (!language.firstLine) continue;
    try { if (new RegExp(language.firstLine).test(firstLine.slice(0, 256))) return language.id; }
    catch { /* A malformed contributed hint cannot prevent opening plain text. */ }
  }
  return 'plaintext';
}
