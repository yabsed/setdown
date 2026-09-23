/** Shared policy: no Monaco, filesystem, renderer or worker dependency. */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };
export function imageMimeType(filePath: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(filePath)?.[1].toLowerCase() ?? '';
  return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension] : undefined;
}
export const isImageDocument = (filePath: string): boolean => !!imageMimeType(filePath);
export const VIDEO_EXTENSIONS = ['mp4', 'webm'];
const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm' };
export function videoMimeType(filePath: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(filePath)?.[1].toLowerCase() ?? '';
  return Object.hasOwn(VIDEO_TYPES, extension) ? VIDEO_TYPES[extension] : undefined;
}
export const isVideoDocument = (filePath: string): boolean => !!videoMimeType(filePath);
export const isReadOnlyDocument = (filePath: string): boolean =>
  isPdfDocument(filePath) || isImageDocument(filePath) || isVideoDocument(filePath);
const MARKDOWN = /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i;
const BINARY = new Set(('pdf png jpg jpeg gif webp avif bmp ico icns tif tiff heic '
  + 'zip gz bz2 xz zst 7z rar tar tgz jar war doc docx xls xlsx ppt pptx odt ods odp '
  + 'exe dll so dylib bin class pyc pyo wasm sqlite sqlite3 db woff woff2 ttf otf eot '
  + 'mp3 mp4 m4a wav ogg flac avi mov mkv webm psd ai sketch').split(' '));

export type DocumentSurface = 'viewer' | 'editor' | 'pdf' | 'image' | 'video';
export type DocumentProfile = { readonly kind: 'markdown' | 'text' | 'pdf' | 'image' | 'video'; readonly preview: 'markdown' | 'pdf' | 'image' | 'video' | null };
const pdf: DocumentProfile = Object.freeze({ kind: 'pdf', preview: 'pdf' });
const image: DocumentProfile = Object.freeze({ kind: 'image', preview: 'image' });
const video: DocumentProfile = Object.freeze({ kind: 'video', preview: 'video' });
export const isPdfDocument = (filePath: string): boolean => /\.pdf$/i.test(filePath);
export const isOpenableDocument = (filePath: string): boolean => isReadOnlyDocument(filePath) || isTextCandidate(filePath);
const markdown: DocumentProfile = Object.freeze({ kind: 'markdown', preview: 'markdown' });
const text: DocumentProfile = Object.freeze({ kind: 'text', preview: null });
export const isMarkdownDocument = (filePath: string): boolean => MARKDOWN.test(filePath);
export const documentProfile = (filePath: string): DocumentProfile => isMarkdownDocument(filePath) ? markdown : isPdfDocument(filePath) ? pdf : isImageDocument(filePath) ? image : isVideoDocument(filePath) ? video : text;
export const fileName = (filePath: string): string => filePath.split(/[\\/]/).at(-1) ?? filePath;
/** A cheap navigation/search filter, NOT proof that bytes are editable text. */
export function isTextCandidate(filePath: string): boolean {
  const name = fileName(filePath);
  return !BINARY.has(name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '');
}
export function documentSurface(filePath: string, preferred: DocumentSurface = 'viewer'): DocumentSurface {
  return isPdfDocument(filePath) ? 'pdf' : isImageDocument(filePath) ? 'image'
    : isVideoDocument(filePath) ? 'video'
    : isMarkdownDocument(filePath) ? (preferred === 'editor' ? 'editor' : 'viewer') : 'editor';
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
