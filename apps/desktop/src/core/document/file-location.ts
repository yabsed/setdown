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

export const isFileLocation = (input: string): boolean => /^(?:[/\\]|[a-z]:[\\/]|file:)/i.test(input.trim());
