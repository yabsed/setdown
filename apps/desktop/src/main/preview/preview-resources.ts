import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Resolve authored URL paths before passing filesystem paths to Crossnote's hook. */
export function resolvePreviewFileReference(reference: string, directory: string,
  render: (filePath: string) => string): string | null {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  try {
    const url = new URL(reference.startsWith('/') ? `.${reference}` : reference,
      pathToFileURL(path.join(directory, path.sep)));
    return render(fileURLToPath(url)) + url.search + url.hash;
  } catch { return null; }
}

/**
 * Crossnote sanitizer에 넘길 문서-local media reference를 만든다. null이면
 * 문서 root 밖의 파일이므로 caller가 별도의 trusted resource URL을 사용한다.
 */
export function previewRelativeReference(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
