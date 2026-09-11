import { describe, expect, it } from 'vitest';
import { previewRelativeReference } from './preview-resources';

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
});
