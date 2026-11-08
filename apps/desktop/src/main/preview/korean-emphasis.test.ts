import { expect, test } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installKoreanEmphasis } from './korean-emphasis';

function parser() {
  const md = new MarkdownIt({ html: true });
  installKoreanEmphasis(md as unknown as Parameters<typeof installKoreanEmphasis>[0]);
  return md;
}

test.each([
  ['**정책**이 중요하다', '<strong>정책</strong>이 중요하다'],
  ["**'정책'**이 중요하다", "<strong>'정책'</strong>이 중요하다"],
  ['**(정책)**이 중요하다', '<strong>(정책)</strong>이 중요하다'],
  ['**90%**가 증가했다', '<strong>90%</strong>가 증가했다'],
  ['**90%가** 증가했다', '<strong>90%가</strong> 증가했다'],
  ['**“중요한 정책”**은', '<strong>“중요한 정책”</strong>은'],
  ['이것은**(정책)**이다', '이것은<strong>(정책)</strong>이다'],
  ['**[정책](https://example.com)**은', '<strong><a href="https://example.com">정책</a></strong>은'],
  ['**(아주 *중요한* 정책)**은', '<strong>(아주 <em>중요한</em> 정책)</strong>은'],
  ['**(첫째)**와 **90%**를', '<strong>(첫째)</strong>와 <strong>90%</strong>를'],
])('renders Korean emphasis without rewriting %s', (source, expected) => {
  expect(parser().render(source)).toBe(`<p>${expected}</p>\n`);
});

test.each([
  '`**(정책)**이`', '```python\ntext = "**90%**가"\n```', '    **(정책)**이',
  '\\*\\*(정책)\\*\\*이', '**(unmatched)이', '(정책)**이', '**(word)**suffix',
  'a**b**c', '*emphasis* **strong** ***both***', '__정책__은', 'a_b_c',
  '<span title="**90%**가">plain</span>', '[literal](https://example.com/**90%**가)',
  '***90%***가', '****90%****가', '**✨**가', '** spaced **',
])('preserves the standard parser for %s', source => {
  expect(parser().render(source)).toBe(new MarkdownIt({ html: true }).render(source));
});
