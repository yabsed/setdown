import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownDestinationForFile } from './markdown-link';

describe('markdownDestinationForFile', () => {
  it('creates a portable path relative to the Markdown document', () => {
    const root = path.resolve('/tmp/setdown-link-test');
    const destination = markdownDestinationForFile(
      path.join(root, 'notes', 'document.md'),
      path.join(root, 'assets', 'reference.pdf'),
    );
    expect(destination).toBe('../assets/reference.pdf');
  });
});
