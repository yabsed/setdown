import { folderCrumbs, rootLength } from '../files/folder-presentation';

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

/** One run of a file's address-bar text. `path` is set on the name of a folder above the file. */
export type FileLocationPart = { text: string; path?: string };

/**
 * A file's address-bar text split at its folders, so that each folder's name can be a link to it.
 * The texts read in order are `readableFileLocation(fileLocation(path))`. The scheme, the
 * separators and the last name (the location itself) are not links.
 */
export function fileLocationParts(path: string): FileLocationPart[] {
  const text = readableFileLocation(fileLocation(path));
  if (!rootLength(path)) return [{ text }];
  const [root, ...below] = folderCrumbs(path, '');
  // What the address shows for the filesystem root: `file:///`, `file:///C:/` or `file://server/share/`.
  const rootText = readableFileLocation(fileLocation(root.path));
  // Its link is the drive or the share. A POSIX root has no name, so its slash is the link.
  const named = /^(file:\/\/.*?)([^/]+)(\/*)$/i.exec(rootText);
  const [before, rootName, after] = named ? named.slice(1) : [rootText.slice(0, -1), rootText.slice(-1), ''];
  const names = text.slice(rootText.length).split('/');
  if (!text.startsWith(rootText) || names.filter(Boolean).length !== below.length) return [{ text }];
  const part = (text: string, path: string, here: boolean): FileLocationPart => here ? { text } : { text, path };
  const parts = [{ text: before }, part(rootName, root.path, !below.length), { text: after }];
  let folder = 0;
  names.forEach((name, index) => {
    if (index) parts.push({ text: '/' });
    if (name) { const { path } = below[folder++]; parts.push(part(name, path, folder === below.length)); }
  });
  return parts.filter(part => part.text);
}

/** Absolute paths, file URLs and home-relative `~` paths (a folder tab expands `~`). */
export const isFileLocation = (input: string): boolean => /^(?:[/\\]|[a-z]:[\\/]|file:|~(?:[/\\]|$))/i.test(input.trim());
