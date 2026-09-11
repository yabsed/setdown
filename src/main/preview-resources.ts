import path from 'node:path';

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
