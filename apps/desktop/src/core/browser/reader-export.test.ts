import { describe, expect, it } from 'vitest';
import { readerMarkdown, sanitizedReaderHtml, readerFileName } from './reader-export';
const article = { title: 'An article', url: 'https://namu.wiki/w/Example', byline: 'A. Writer', siteName: 'Wiki', content: '' };
describe('reading view exports', () => {
  it('retains heading anchors, links, images, lists, tables and fenced code', () => {
    const markdown = readerMarkdown({ ...article, content: `<h2><a id="s-1"></a>Chapter</h2><p>A <a href="/w/Next">link</a>.</p>
      <ul><li>First</li><li>Second</li></ul><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha</td><td>1</td></tr></tbody></table>
      <pre><code class="language-js">const answer = 42;</code></pre><img src="//images.example/photo.png" alt="Photo">` });
    expect(markdown).toContain('# An article'); expect(markdown).toContain('Source: <https://namu.wiki/w/Example>');
    expect(markdown).toContain('<a id="s-1"></a>'); expect(markdown).toContain('## Chapter');
    expect(markdown).toContain('[link](https://namu.wiki/w/Next)'); expect(markdown).toMatch(/-\s+First/);
    expect(markdown).toContain('| Name | Value |'); expect(markdown).toContain('| Alpha | 1 |');
    expect(markdown).toContain('```js\nconst answer = 42;'); expect(markdown).toContain('![Photo](https://images.example/photo.png)');
  });
  it('removes active markup and local-resource URLs from untrusted snapshots', () => {
    const html = sanitizedReaderHtml({ ...article, content: '<script>bad()</script><iframe src="file:///secret"></iframe><img src="file:///secret" onerror="bad()"><a href="javascript:bad()">click</a><p style="color:red" onclick="bad()">safe</p>' });
    expect(html).not.toMatch(/bad\(|script|iframe|file:|onerror|onclick|style=/); expect(html).toContain('<p>safe</p>');
  });
  it('escapes a malicious plain-text title and metadata instead of emitting active Markdown HTML', () => {
    const markdown = readerMarkdown({ ...article, title: '<img src=x onerror=bad()>', byline: '<script>bad()</script>', content: '<p>safe</p>' });
    expect(markdown).not.toMatch(/<script>|<img /); expect(markdown).toContain('&lt;img'); expect(markdown).toContain('&lt;script');
  });
  it('keeps merged wiki table cells as safe HTML rather than corrupting their structure', () => {
    const markdown = readerMarkdown({ ...article, content: '<table><tr><th colspan="2">Title</th></tr><tr><td>A</td><td>B</td></tr></table>' });
    expect(markdown).toContain('<th colspan="2">Title</th>'); expect(markdown).toContain('<td>A</td><td>B</td>');
  });
  it('uses portable names that cannot escape the selected save directory', () => {
    expect(readerFileName('../../folder\\article:*?')).not.toMatch(/[/\\:*?]/); expect(readerFileName('CON')).toBe('article'); expect(readerFileName('')).toBe('article');
  });
});
