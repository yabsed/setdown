/** Keep filesystem paths in document state; encode them only for the address bar. */
export function fileLocation(path: string): string {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\');
  const normalized = windows ? path.replaceAll('\\', '/') : path;
  const encode = (value: string) => encodeURI(value).replaceAll('#', '%23').replaceAll('?', '%3F');
  if (windows && normalized.startsWith('//')) {
    const [host, ...segments] = normalized.slice(2).split('/');
    return `file://${host}/${encode(segments.join('/'))}`;
  }
  if (windows) return `file:///${normalized.slice(0, 2)}${encode(normalized.slice(2))}`;
  return `file://${encode(normalized)}`;
}

/**
 * The address bar's text for a file URL: names as a file manager shows them
 * (Hangul, spaces, brackets) instead of percent-escapes. An escape stays only
 * where its literal form would read back as something else: `%`, `#`, `?`, a
 * slash or backslash inside a name, invisible characters, bytes that are not
 * UTF-8 and a final space. The text therefore still names the same file when
 * it is submitted, copied or pasted back. Web addresses are returned unchanged.
 */
export function readableFileLocation(location: string): string {
  if (!/^file:/i.test(location)) return location;
  const end = location.search(/[?#]/);
  const path = end < 0 ? location : location.slice(0, end), rest = end < 0 ? '' : location.slice(end);
  const literal = (char: string) => !/[%#?\\/]|\p{C}|\p{Zl}|\p{Zp}|(?! )\p{Zs}/u.test(char);
  const readable = path.replace(/(?:%[0-9a-f]{2})+/gi, escapes => {
    try { return [...decodeURIComponent(escapes)].map(char => literal(char) ? char : encodeURIComponent(char)).join(''); }
    catch { return escapes; }
  });
  return (rest ? readable : readable.replace(/ $/, '%20')) + rest;
}

/** Absolute paths, file URLs and home-relative `~` paths (a folder tab expands `~`). */
export const isFileLocation = (input: string): boolean => /^(?:[/\\]|[a-z]:[\\/]|file:|~(?:[/\\]|$))/i.test(input.trim());
