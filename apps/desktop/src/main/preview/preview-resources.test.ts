import { describe, expect, it } from 'vitest';
import { previewRelativeReference, resolvePreviewFileReference } from './preview-resources';

describe('previewRelativeReference', () => {
  it('keeps document-local media relative while encoding URL segments', () => {
    expect(previewRelativeReference(
      '/notes',
      '/notes/My notes.assets/pasted image.png',
    )).toBe('My%20notes.assets/pasted%20image.png');
  });

  it('rejects files outside the document root', () => {
    expect(previewRelativeReference('/notes', '/private/image.png')).toBeNull();
  });

  it('decodes only the URL pathname and preserves reserved characters in the filesystem root', () => {
    const root = '/notes#%25';
    const render = (file: string) => previewRelativeReference(root, file)!;
    expect(resolvePreviewFileReference('note%23part%2525.md?q=a%26b#section', root, render))
      .toBe('note%23part%2525.md?q=a%26b#section');
    expect(resolvePreviewFileReference('/image%20one.png', root, render)).toBe('image%20one.png');
    expect(resolvePreviewFileReference('https://example.test/a%23b', root, render)).toBeNull();
    expect(resolvePreviewFileReference('#section', root, render)).toBeNull();
  });
});
