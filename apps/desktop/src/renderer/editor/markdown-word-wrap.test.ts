import { afterEach, describe, expect, it, vi } from 'vitest';
import { onMarkdownWordWrap, setMarkdownWordWrap, sourceWordWrap } from './markdown-word-wrap';

afterEach(() => setMarkdownWordWrap(true));

describe('Markdown word wrap', () => {
  it('wraps only Markdown source by default', () => {
    for (const file of ['/notes/readme.md', '/notes/README.MARKDOWN', '/notes/paper.qmd', '/notes/page.mdx'])
      expect(sourceWordWrap(file)).toBe('on');
    for (const file of ['/src/main.py', '/notes/plain.txt', '/data/cells.ipynb', '/notes/md', '/notes/readme.md.bak'])
      expect(sourceWordWrap(file)).toBe('off');
  });
  it('leaves every source unwrapped when the setting is off', () => {
    setMarkdownWordWrap(false);
    expect(sourceWordWrap('/notes/readme.md')).toBe('off');
    expect(sourceWordWrap('/src/main.py')).toBe('off');
  });
  it('notifies mounted editors once per actual change', () => {
    const listener = vi.fn();
    const unsubscribe = onMarkdownWordWrap(listener);
    setMarkdownWordWrap(true);
    expect(listener).not.toHaveBeenCalled();
    setMarkdownWordWrap(false);
    setMarkdownWordWrap(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setMarkdownWordWrap(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
