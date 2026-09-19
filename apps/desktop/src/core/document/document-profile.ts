/** Shared policy only: no Monaco, filesystem, renderer or worker dependency. */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'];
const MARKDOWN = /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i;
const BINARY = new Set(('pdf png jpg jpeg gif webp avif bmp ico icns tif tiff heic '
  + 'zip gz bz2 xz zst 7z rar tar tgz jar war doc docx xls xlsx ppt pptx odt ods odp '
  + 'exe dll so dylib bin class pyc pyo wasm sqlite sqlite3 db woff woff2 ttf otf eot '
  + 'mp3 mp4 m4a wav ogg flac avi mov mkv webm psd ai sketch').split(' '));

export const isMarkdownDocument = (filePath: string): boolean => MARKDOWN.test(filePath);
export const fileName = (filePath: string): string => filePath.split(/[\\/]/).at(-1) ?? filePath;
/** A cheap navigation/search filter, NOT proof that bytes are editable text. */
export function isTextCandidate(filePath: string): boolean {
  const name = fileName(filePath);
  return !BINARY.has(name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '');
}
export function documentSurface(filePath: string, preferred: 'viewer' | 'editor' = 'viewer') {
  return isMarkdownDocument(filePath) ? preferred : 'editor';
}

export type RegisteredLanguage = {
  id: string;
  extensions?: readonly string[];
  filenames?: readonly string[];
  filenamePatterns?: readonly string[];
  firstLine?: string;
};

function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}

/** Registered Monaco languages decide highlighting, never whether a file can open. */
export function documentLanguage(filePath: string, languages: readonly RegisteredLanguage[], firstLine = ''): string {
  if (isMarkdownDocument(filePath)) return 'markdown';
  const name = fileName(filePath);
  const lower = name.toLowerCase();
  const exact = languages.find((language) => language.filenames?.includes(name));
  if (exact) return exact.id;
  // Prefer .d.ts, .blade.php etc. over a shorter suffix regardless of registry order.
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
  // A few common configuration filenames intentionally have no extension.
  if ((name === '.env' || name.startsWith('.env.')) && languages.some((language) => language.id === 'ini')) return 'ini';
  for (const language of languages) {
    if (!language.firstLine) continue;
    try { if (new RegExp(language.firstLine).test(firstLine.slice(0, 256))) return language.id; }
    catch { /* An invalid contributed hint must not prevent opening plain text. */ }
  }
  return 'plaintext';
}
